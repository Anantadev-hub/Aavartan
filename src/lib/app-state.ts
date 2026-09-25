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
};

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

export function useSyncWorker(
  onSync: (drafts: QueuedDraft[]) => Promise<{ synced: number }>,
  enabled: boolean,
) {
  const { online, queue, syncState } = useAppState();

  useEffect(() => {
    if (!enabled || !online || queue.length === 0 || syncState === "syncing") return;
    let cancelled = false;
    (async () => {
      setSyncState("syncing");
      try {
        const res = await onSync(queue);
        if (cancelled) return;
        for (const d of queue) removeQueued(d.clientRef);
        setSyncState("done", `${res.synced} records synced successfully.`);
        setTimeout(() => setSyncState("idle"), 2600);
      } catch {
        if (!cancelled) {
          setSyncState("idle");
          pushToast("Sync failed — will retry when online.", "error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, online, queue.length, syncState]);
}
