// ---------------------------------------------------------------------------
// Offline read cache — a thin, namespaced localStorage layer used by the data
// hooks (src/hooks/use-kc-data.ts) so screens can render previously loaded
// data when the network is unavailable. Pure data layer: no UI, no styling,
// no visual impact when online.
// ---------------------------------------------------------------------------

const PREFIX = "kc.cache.";

/** Ignore cached entries older than this (stale data beats a blank screen,
 *  but ancient data is treated as absent). */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type CacheEntry<T> = { at: number; data: T };

export function readCache<T>(key: string): CacheEntry<T> | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry<T>;
    if (!parsed || typeof parsed.at !== "number") return null;
    if (Date.now() - parsed.at > MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeCache(key: string, data: unknown) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ at: Date.now(), data }));
  } catch {
    // Storage full: retry once without heavy photo payloads rather than failing.
    try {
      if (Array.isArray(data)) {
        const slim = (data as Array<Record<string, unknown>>).map((row) =>
          row && typeof row === "object" ? { ...row, photoDataUrl: undefined } : row,
        );
        localStorage.setItem(PREFIX + key, JSON.stringify({ at: Date.now(), data: slim }));
      }
    } catch {
      /* give up silently — cache is best-effort */
    }
  }
}

/** Cached value as `data`, or undefined when absent/stale (never null). */
export function cachedOrUndefined<T>(key: string): T | undefined {
  return readCache<T>(key)?.data;
}
