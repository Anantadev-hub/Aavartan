import { useCallback, useEffect, useState } from "react";
import { LANGS, loadLang, saveLang, translate, type Lang } from "./i18n";

// ---------------------------------------------------------------------------
// App-wide client state: language, online status, offline sync queue, toasts.
// Everything offline lives in localStorage so weak connectivity never loses
// collector data (prototype persistence layer; backend mirrors /sync).
// ---------------------------------------------------------------------------

type QueuedDraft = {
  clientRef: string;
  materialCode: string;
  weight: number;
  condition: "good" | "mixed" | "damaged";
  pieces?: number;
  notes?: string;
  source?: string;
  photoDataUrl?: string;
  aiMaterialCode?: string;
  aiConfidence?: number;
  locationLabel: string;
  capturedAt: number;
  estimatedValue: number;
};

type Toast = { id: number; message: string; tone: "success" | "info" | "error" };

type SyncState = "idle" | "syncing" | "done";

type AppContextValue = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string) => string;
  online: boolean;
  queue: QueuedDraft[];
  enqueueDraft: (d: Omit<QueuedDraft, "clientRef">) => void;
  removeQueued: (clientRef: string) => void;
  clearQueue: () => void;
  syncState: SyncState;
  lastSyncMessage: string | null;
  toast: (message: string, tone?: Toast["tone"]) => void;
  toasts: Toast[];
  dismissToast: (id: number) => void;
};

const QUEUE_KEY = "kc.syncQueue";
const RECENT_KEY = "kc.recentPrices";

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full: retry without photo payloads rather than losing drafts.
    if (key === QUEUE_KEY && Array.isArray(value)) {
      try {
        const slim = (value as Array<Record<string, unknown>>).map(({ photoDataUrl: _drop, ...rest }) => rest);
        localStorage.setItem(key, JSON.stringify(slim));
        return;
      } catch {
        /* give up silently — newest writes still live in memory */
      }
    }
  }
}

// React context is provided in app-context.tsx; this module holds the logic.
let listeners: Array<() => void> = [];

const store = {
  lang: loadLang(),
  online: typeof navigator !== "undefined" ? navigator.onLine : true,
  queue: readJSON<QueuedDraft[]>(QUEUE_KEY, []),
  syncState: "idle" as SyncState,
  lastSyncMessage: null as string | null,
  toasts: [] as Toast[],
  // Sync reliability (data layer): cooldown between failed attempts so a bad
  // connection can't cause a hot retry loop, and per-draft attempt counts so
  // one un-syncable record can't poison the whole batch forever.
  syncCooldownUntil: 0,
  syncInProgress: false,
};

const ATTEMPTS_KEY = "kc.syncAttempts";
const MAX_ATTEMPTS = 4;
const SYNC_COOLDOWN_MS = 20_000;

function readAttempts(): Record<string, number> {
  return readJSON<Record<string, number>>(ATTEMPTS_KEY, {});
}

function writeAttempts(a: Record<string, number>) {
  writeJSON(ATTEMPTS_KEY, a);
}

function bumpAttempts(clientRef: string): number {
  const a = readAttempts();
  a[clientRef] = (a[clientRef] ?? 0) + 1;
  writeAttempts(a);
  return a[clientRef];
}

function clearAttempts(clientRef: string) {
  const a = readAttempts();
  if (a[clientRef] !== undefined) {
    delete a[clientRef];
    writeAttempts(a);
  }
}

function emit() {
  for (const fn of listeners) fn();
}

export function subscribe(fn: () => void) {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((f) => f !== fn);
  };
}

export function getSnapshot() {
  return store;
}

export function setLang(l: Lang) {
  store.lang = l;
  saveLang(l);
  emit();
}

export function setOnline(online: boolean) {
  if (store.online !== online) {
    store.online = online;
    emit();
  }
}

export function enqueueDraft(d: Omit<QueuedDraft, "clientRef">) {
  const draft: QueuedDraft = { ...d, clientRef: `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` };
  store.queue = [...store.queue, draft];
  writeJSON(QUEUE_KEY, store.queue);
  emit();
}

export function removeQueued(clientRef: string) {
  store.queue = store.queue.filter((q) => q.clientRef !== clientRef);
  writeJSON(QUEUE_KEY, store.queue);
  emit();
}

export function clearQueue() {
  store.queue = [];
  writeJSON(QUEUE_KEY, store.queue);
  emit();
}

export function setSyncState(state: SyncState, message?: string) {
  store.syncState = state;
  if (message !== undefined) store.lastSyncMessage = message;
  emit();
}

export function pushToast(message: string, tone: Toast["tone"] = "info") {
  const id = Date.now() + Math.random();
  store.toasts = [...store.toasts, { id, message, tone }];
  emit();
  setTimeout(() => dismissToast(id), 3800);
}

export function dismissToast(id: number) {
  store.toasts = store.toasts.filter((t) => t.id !== id);
  emit();
}

// ---- Cached reference data for offline reads (prices, recyclers, safety) ---

export function cacheRecentPrices(data: unknown) {
  writeJSON(RECENT_KEY, { at: Date.now(), data });
}

export function getRecentPrices<T>(): { at: number; data: T } | null {
  return readJSON<{ at: number; data: T } | null>(RECENT_KEY, null);
}

// ---- Voice (browser speech synthesis) --------------------------------------

export function speak(text: string, lang: Lang) {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = lang === "hi" ? "hi-IN" : lang === "mr" ? "mr-IN" : "en-IN";
    utter.rate = 0.92;
    synth.speak(utter);
  } catch {
    /* speech unsupported */
  }
}

// ---- useSyncExternalStore hook (the React binding) -------------------------

import { useSyncExternalStore } from "react";

export function useAppState(): AppContextValue {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const t = useCallback((key: string) => translate(snapshot.lang, key), [snapshot.lang]);

  return {
    lang: snapshot.lang,
    setLang,
    t,
    online: snapshot.online,
    queue: snapshot.queue,
    enqueueDraft,
    removeQueued,
    clearQueue,
    syncState: snapshot.syncState,
    lastSyncMessage: snapshot.lastSyncMessage,
    toast: pushToast,
    toasts: snapshot.toasts,
    dismissToast,
  };
}

// ---- Sync worker: flush the queue when we come back online -----------------
// Reliability rules (all data-layer; no UI impact):
//   1. One batch call first — keeps the happy path to a single mutation.
//   2. If the batch fails, retry draft-by-draft so a single oversized/bad
//      record can't block the rest of the queue.
//   3. Failing drafts accumulate attempts; after MAX_ATTEMPTS they stay saved
//      locally but are excluded from auto-sync (never silently destroyed).
//   4. A cooldown after any failure prevents a hot retry loop.

export function useSyncWorker(
  onSync: (drafts: QueuedDraft[]) => Promise<{ synced: number }>,
  enabled: boolean,
) {
  const { online, queue, syncState } = useAppState();

  useEffect(() => {
    if (!enabled || !online || queue.length === 0) return;
    if (store.syncInProgress) return;
    if (syncState === "syncing") return;

    // Cooldown after a failed round: wake ourselves when it expires.
    if (Date.now() < store.syncCooldownUntil) {
      const remaining = store.syncCooldownUntil - Date.now() + 50;
      const id = setTimeout(() => emit(), remaining);
      return () => clearTimeout(id);
    }

    // Syncable = not permanently excluded by repeated failures.
    const snapshot = queue.filter(
      (d) => (readAttempts()[d.clientRef] ?? 0) < MAX_ATTEMPTS,
    );
    if (snapshot.length === 0) return;

    store.syncInProgress = true;
    (async () => {
      setSyncState("syncing");
      const succeeded: string[] = [];
      let syncedTotal = 0;
      let hardFail = false;
      try {
        // Fast path: one batch.
        const res = await onSync(snapshot);
        syncedTotal = res.synced;
        for (const d of snapshot) succeeded.push(d.clientRef);
      } catch {
        // Fallback: draft-by-draft isolation.
        syncedTotal = 0;
        succeeded.length = 0;
        for (const d of snapshot) {
          try {
            const res = await onSync([d]);
            syncedTotal += res.synced;
            succeeded.push(d.clientRef);
            clearAttempts(d.clientRef);
          } catch {
            const attempts = bumpAttempts(d.clientRef);
            if (attempts >= MAX_ATTEMPTS) hardFail = true;
          }
        }
      }

      for (const ref of succeeded) {
        removeQueued(ref);
        clearAttempts(ref);
      }
      store.syncInProgress = false;

      const remaining = store.queue.length;
      if (remaining === 0 && !hardFail) {
        setSyncState("done", `${syncedTotal} records synced successfully.`);
        setTimeout(() => setSyncState("idle"), 2600);
      } else {
        store.syncCooldownUntil = Date.now() + SYNC_COOLDOWN_MS;
        setSyncState("idle");
        if (hardFail) {
          pushToast(
            "Some records couldn't sync — they stay saved on this device.",
            "error",
          );
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, online, queue.length, syncState]);
}
