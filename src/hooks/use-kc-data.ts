import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useEffect } from "react";
import { cacheRecentPrices, getRecentPrices } from "@/lib/app-state";
import { cachedOrUndefined, writeCache } from "@/lib/offline-cache";

// ---------------------------------------------------------------------------
// Data hooks. Online behaviour is unchanged — the same Convex queries run and
// resolve exactly as before. The offline cache is only consulted when a query
// cannot resolve (weak connectivity), so previously loaded data keeps working
// instead of leaving screens on a loading spinner. Pure data-layer extension.
// ---------------------------------------------------------------------------

export type MaterialRow = Doc<"materials">;

// Shapes mirrored from the Convex query results so cached fallbacks are
// type-identical to the live data (UI code needs no changes).
type EarningsSummary = {
  totalEarnings: number;
  thisMonth: number;
  lotsSold: number;
  avgLotValue: number;
  pendingLots: number;
  transactionCount: number;
};
type MonthlyRow = { month: string; amount: number };
type RecyclerStats = {
  newLots: number;
  active: number;
  completed: number;
  todayValue: number;
};

/** Signed-in user's profile (collector or recycler role). */
export function useProfile() {
  const live = useQuery(api.profiles.myProfile, {});
  const cached = cachedOrUndefined<Doc<"profiles">>("profile");
  useEffect(() => {
    if (live) writeCache("profile", live);
  }, [live]);
  // undefined = still resolving; cached value is used only if live stays undefined.
  return live !== undefined ? live : cached;
}

/** Material catalogue; caches the latest copy for offline reads. */
export function useMaterials(opts: { cache?: boolean } = {}) {
  const live = useQuery(api.materials.listMaterials, {});
  useEffect(() => {
    if (live && live.length > 0 && opts.cache !== false) {
      cacheRecentPrices(live);
      writeCache("materials", live);
    }
  }, [live, opts.cache]);
  const cached = getRecentPrices<MaterialRow[]>();
  const materials =
    live !== undefined
      ? live
      : cachedOrUndefined<MaterialRow[]>("materials") ?? cached?.data;
  return { materials, cached };
}

export function usePriceTrends(materialCode: string, days: 7 | 30 | 90) {
  const live = useQuery(api.materials.priceTrends, { materialCode, days });
  const key = `trends.${materialCode}.${days}`;
  useEffect(() => {
    if (live) writeCache(key, live);
  }, [live, key]);
  return live !== undefined ? live : cachedOrUndefined<Doc<"priceHistory">[]>(key);
}

export function useSafetyGuides() {
  const live = useQuery(api.materials.listSafetyGuides, {});
  useEffect(() => {
    if (live && live.length > 0) writeCache("safetyGuides", live);
  }, [live]);
  const cached = cachedOrUndefined<Doc<"safetyGuides">[]>("safetyGuides");
  return live !== undefined ? live : cached;
}

export function useEarnings(collectorId: Id<"profiles"> | undefined) {
  const summary = useQuery(api.lots.earningsSummary, collectorId ? { collectorId } : "skip");
  const monthly = useQuery(api.lots.monthlyEarnings, collectorId ? { collectorId } : "skip");
  const summaryKey = `earnings.${collectorId ?? "none"}`;
  const monthlyKey = `earningsMonthly.${collectorId ?? "none"}`;
  useEffect(() => {
    if (summary) writeCache(summaryKey, summary);
    if (monthly) writeCache(monthlyKey, monthly);
  }, [summary, monthly, summaryKey, monthlyKey]);
  return {
    summary:
      summary !== undefined ? summary : cachedOrUndefined<EarningsSummary>(summaryKey),
    monthly:
      monthly !== undefined ? monthly : cachedOrUndefined<MonthlyRow[]>(monthlyKey),
  };
}

export function useMyLots(collectorId: Id<"profiles"> | undefined) {
  const live = useQuery(api.lots.listLots, collectorId ? { collectorId } : "skip");
  const key = `lots.collector.${collectorId ?? "none"}`;
  useEffect(() => {
    if (live) writeCache(key, live);
  }, [live, key]);
  const rows = live !== undefined ? live : cachedOrUndefined<Doc<"lots">[]>(key);
  return rows;
}

export function useRecyclerLots(recyclerId: Id<"recyclers"> | undefined) {
  const live = useQuery(api.lots.listLots, recyclerId ? { recyclerId } : "skip");
  const key = `lots.recycler.${recyclerId ?? "none"}`;
  useEffect(() => {
    if (live) writeCache(key, live);
  }, [live, key]);
  return live !== undefined ? live : cachedOrUndefined<Doc<"lots">[]>(key);
}

export function useAvailableLots() {
  const live = useQuery(api.lots.listAvailableLots, {});
  useEffect(() => {
    if (live) writeCache("lots.available", live);
  }, [live]);
  return live !== undefined ? live : cachedOrUndefined<Doc<"lots">[]>("lots.available");
}

export function useRecyclerStats(recyclerId: Id<"recyclers"> | undefined) {
  const live = useQuery(api.lots.recyclerStats, recyclerId ? { recyclerId } : "skip");
  const key = `stats.${recyclerId ?? "none"}`;
  useEffect(() => {
    if (live) writeCache(key, live);
  }, [live, key]);
  return live !== undefined ? live : cachedOrUndefined<RecyclerStats>(key);
}

// ---- Cached variants for screens that query inline -------------------------
// Same signature/return as the underlying useQuery calls they replace, so the
// calling screens need only a one-line hook swap (no visual change).

type MatchArgs = {
  materialCode: string;
  weightKg?: number;
  verifiedOnly: boolean;
  pickupOnly: boolean;
  sortBy: "match" | "distance" | "rate";
};

type MatchedRecycler = Doc<"recyclers"> & {
  acceptsMaterial: boolean;
  rate: number;
  matchScore: number;
  estimatedValue: number | null;
};

export function useMatchedRecyclers(args: MatchArgs) {
  const live = useQuery(api.recyclers.matchRecyclers, args);
  const key = `match.${args.materialCode}.${args.sortBy}.${args.verifiedOnly ? 1 : 0}.${
    args.pickupOnly ? 1 : 0
  }.${args.weightKg ?? "x"}`;
  useEffect(() => {
    if (live) writeCache(key, live);
  }, [live, key]);
  return live !== undefined ? live : cachedOrUndefined<MatchedRecycler[]>(key);
}

type LotDetailData = {
  lot: Doc<"lots">;
  recycler: Doc<"recyclers"> | null;
  collector: Doc<"profiles"> | null;
  anomalyFlags: Doc<"anomalyFlags">[];
};

type TimelineData = {
  events: Array<{
    code: string;
    label: string;
    timestamp: number | null;
    description: string;
    state: "done" | "pending" | "todo";
  }>;
};

export function useLotDetail(lotId: Id<"lots"> | string) {
  const live = useQuery(api.lots.getLot, { lotId: lotId as Id<"lots"> });
  const key = `lot.${lotId}`;
  useEffect(() => {
    if (live) writeCache(key, live);
  }, [live, key]);
  return live !== undefined ? live : cachedOrUndefined<LotDetailData>(key);
}

export function useLotTimeline(lotId: Id<"lots"> | string) {
  const live = useQuery(api.lots.lotTimeline, { lotId: lotId as Id<"lots"> });
  const key = `timeline.${lotId}`;
  useEffect(() => {
    if (live) writeCache(key, live);
  }, [live, key]);
  return live !== undefined ? live : cachedOrUndefined<TimelineData>(key);
}

export function useFacility(recyclerId: Id<"recyclers">) {
  const live = useQuery(api.recyclers.getRecycler, { recyclerId });
  const key = `facility.${recyclerId}`;
  useEffect(() => {
    if (live) writeCache(key, live);
  }, [live, key]);
  return live !== undefined ? live : cachedOrUndefined<Doc<"recyclers">>(key);
}

export function useSendSync() {
  return useMutation(api.sync.syncQueue);
}
