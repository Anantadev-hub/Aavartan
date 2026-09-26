import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useEffect, useMemo } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { cacheRecentPrices, getRecentPrices } from "@/lib/app-state";
import { cachedOrUndefined, writeCache } from "@/lib/offline-cache";
import {
  loadPendingProfile,
  markPendingProfileSynced,
  type PendingProfile,
} from "@/lib/auth-service";

// ---------------------------------------------------------------------------
// Data hooks. Online behaviour is unchanged — the same Convex queries run and
// resolve exactly as before. The offline cache is only consulted when a query
// cannot resolve (weak connectivity), so previously loaded data keeps working
// instead of leaving screens on a loading spinner. Pure data-layer extension.
// ---------------------------------------------------------------------------

export type MaterialRow = Doc<"materials">;

/**
 * Profile result: either the live backend profile or a locally-synthesized
 * "Pending Sync" profile created during offline onboarding. Local profiles
 * have no `_id`, so all dependent queries naturally skip (no invalid-id calls).
 * Collector onboarding synthesizes a local profile; recycler onboarding ALSO
 * synthesizes one locally (role gates navigation) — facility-bound data
 * (dashboard stats, lots) simply stays empty until the backend is reachable.
 */
export type AppProfile =
  | Doc<"profiles">
  | (Omit<PendingProfile, "role"> & {
      role: "collector" | "recycler";
      isLocalProfile: true;
      _id?: undefined;
      recyclerId?: undefined;
    });

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
export function useProfile(): AppProfile | Doc<"profiles"> | null | undefined {
  const live = useQuery(api.profiles.myProfile, {});
  // Read once per mount; live data always takes precedence when it exists.
  const pending = useMemo(() => loadPendingProfile(), []);
  useEffect(() => {
    if (live) writeCache("profile", live);
  }, [live]);
  if (live) return live;
  const cached = cachedOrUndefined<Doc<"profiles">>("profile");
  if (cached) return cached;
  if (pending) {
    // Offline onboarding (either role): render the app from the locally saved
    // profile. For recyclers the portal renders with empty facility data
    // (recyclerId stays undefined) instead of bouncing to sign-in.
    return { ...pending, isLocalProfile: true };
  }
  return live; // undefined = resolving; null = none (existing redirect behavior)
}

/** True when the profile is a real backend profile with a usable _id. */
export function hasBackendId(
  p: AppProfile | Doc<"profiles"> | null | undefined,
): p is Doc<"profiles"> {
  return !!p && "_id" in p && typeof (p as { _id?: unknown })._id === "string";
}

/**
 * Opportunistic background sync for a locally onboarded profile. Called once
 * by the app shells; when the backend is reachable the pending profile is
 * created and marked synced — otherwise it silently stays "Pending Sync".
 */
export function usePendingProfileSync() {
  const { signIn, signOut } = useAuthActions();
  const createProfile = useMutation(api.profiles.createProfile);
  useEffect(() => {
    const p = loadPendingProfile();
    if (!p || p.synced || !navigator.onLine) return;
    void (async () => {
      try {
        try {
          await signOut();
        } catch {
          /* no existing session — fine */
        }
        await signIn("anonymous");
        await createProfile({ role: p.role, name: p.name });
        markPendingProfileSynced();
      } catch {
        /* backend unreachable — profile stays pending; never blocks the UI */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * Repairs a signed-in backend recycler profile that is missing its facility
 * binding (created before the demo facility was seeded). Runs once per shell
 * mount; the reactive profile query re-renders the portal when it succeeds.
 * Recyclers onboarded fully offline stay on their local profile (Pending Sync)
 * — no blocking, no error, matching the collector behaviour.
 */
export function useRecyclerBindingRepair() {
  const ensure = useMutation(api.profiles.ensureRecyclerBinding);
  useEffect(() => {
    if (!navigator.onLine) return;
    void ensure({}).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
  return live !== undefined ? live : cachedOrUndefined<LotWithCollector[]>("lots.available");
}

/** Lot rows as returned by listLots — includes the attached collector name. */
export type LotWithCollector = Doc<"lots"> & { collectorName?: string | null };

/** Recycler purchases summary (§16): the BUY-side ledger of the portal. */
export function usePurchasesSummary(recyclerId: Id<"recyclers"> | undefined) {
  const live = useQuery(api.lots.purchasesSummary, recyclerId ? { recyclerId } : "skip");
  const key = `purchases.${recyclerId ?? "none"}`;
  useEffect(() => {
    if (live) writeCache(key, live);
  }, [live, key]);
  return live !== undefined
    ? live
    : cachedOrUndefined<{
        totalPaid: number;
        totalKg: number;
        monthPaid: number;
        monthCount: number;
        purchaseCount: number;
        byMaterial: Array<{ code: string; weightKg: number; amount: number }>;
      }>(key);
}

export function useRecyclerStats(recyclerId: Id<"recyclers"> | undefined) {
  const live = useQuery(api.lots.recyclerStats, recyclerId ? { recyclerId } : "skip");
  const key = `stats.${recyclerId ?? "none"}`;
  useEffect(() => {
    if (live) writeCache(key, live);
  }, [live, key]);
  return live !== undefined ? live : cachedOrUndefined<RecyclerStats>(key);
}

/** True when the profile is a locally-synthesized "Pending Sync" profile. */
export function isLocalProfile(
  p: AppProfile | Doc<"profiles"> | null | undefined,
): p is NonNullable<PendingProfile> & { isLocalProfile: true; role: "collector" | "recycler" } {
  return !!p && "isLocalProfile" in p && p.isLocalProfile === true;
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
  matchReasons: string[]; // visible transparency reasons (§26)
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

export function useFacility(recyclerId: Id<"recyclers"> | undefined) {
  // Skip while the facility binding is pending (never call the query with a
  // null id — Convex validates arguments client-side and would throw).
  const live = useQuery(api.recyclers.getRecycler, recyclerId ? { recyclerId } : "skip");
  const key = `facility.${recyclerId ?? "none"}`;
  useEffect(() => {
    if (live) writeCache(key, live);
  }, [live, key]);
  return live !== undefined ? live : cachedOrUndefined<Doc<"recyclers">>(key);
}

export function useSendSync() {
  return useMutation(api.sync.syncQueue);
}

// ---- §5/§6/§8/§9/§11 image IDs, price snapshots, weekly report hooks -------

/** Register an uploaded image and get its persistent IMG-KC-2026-XXXXXX ref. */
export function useRegisterImage() {
  return useMutation(api.images.registerImage);
}

/** Latest applicable daily price snapshot for a material (§8). */
export function useLatestDailyPrice(materialCode: string | undefined) {
  const live = useQuery(
    api.materials.latestDailyPrice,
    materialCode ? { materialCode } : "skip",
  );
  const key = `dailyPrice.${materialCode ?? "x"}`;
  useEffect(() => {
    if (live) writeCache(key, live);
  }, [live, key]);
  return live !== undefined
    ? live
    : cachedOrUndefined<{ _id: string; materialCode: string; day: string; pricePerKg: number; source: string; recordedAt: number }>(key);
}

/** §11 weekly net earnings report (completed + paid lots only). */
export function useWeeklyReport(collectorId: Id<"profiles"> | undefined) {
  const live = useQuery(api.lots.weeklyReport, collectorId ? { collectorId } : "skip");
  const key = `weekly.${collectorId ?? "none"}`;
  useEffect(() => {
    if (live) writeCache(key, live);
  }, [live, key]);
  return live !== undefined
    ? live
    : cachedOrUndefined<{
        weekStart: number;
        weekEnd: number;
        gross: number;
        net: number;
        completedSales: number;
        materialSoldKg: number;
        avgSale: number;
        prevGross: number;
        prevCompletedSales: number;
        change: number;
        changePct: number | null;
        daily: Array<{ day: string; amount: number }>;
        note: string;
      }>(key);
}

// ---- Spec §24/§32/§33/§35/§40 insight hooks (same offline-cache pattern) ----

type FairMeter = {
  currentMarket: number;
  quotedPrice: number;
  range: { low: number; high: number };
  wording: string;
  pctVsMarket: number;
  differencePerKg: number;
  isReviewSignal: boolean;
};

export function useFairPriceMeter(
  materialCode: string | undefined,
  quotedPrice: number | undefined,
) {
  const live = useQuery(
    api.insights.fairPriceMeter,
    materialCode && quotedPrice && quotedPrice > 0 ? { materialCode, quotedPrice } : "skip",
  );
  const key = `fairMeter.${materialCode ?? "x"}.${quotedPrice ?? "x"}`;
  useEffect(() => {
    if (live) writeCache(key, live);
  }, [live, key]);
  return live !== undefined ? live : cachedOrUndefined<FairMeter>(key);
}

type Simulator = {
  totalWeightKg: number;
  mixedSale: number;
  sortedSale: number;
  mixedRate: number;
  potentialDifference: number;
  split: Array<{ code: string; share: number; pricePerKg: number; weightKg: number; value: number }>;
  note: string;
};

export function useEarningsSimulator(weightKg: number) {
  const live = useQuery(
    api.insights.earningsSimulator,
    weightKg > 0 ? { totalWeightKg: weightKg } : "skip",
  );
  const key = `simulator.${weightKg}`;
  useEffect(() => {
    if (live) writeCache(key, live);
  }, [live, key]);
  return live !== undefined ? live : cachedOrUndefined<Simulator>(key);
}

type LedgerRow = {
  _id: string;
  amount: number;
  createdAt: number;
  referenceId: string | null;
  materialCode: string | null;
  paymentMethod: string | null;
};

export function useEarningsLedger(collectorId: Id<"profiles"> | undefined) {
  const live = useQuery(api.insights.earningsLedger, collectorId ? { collectorId } : "skip");
  const key = `ledger.${collectorId ?? "none"}`;
  useEffect(() => {
    if (live) writeCache(key, live);
  }, [live, key]);
  return live !== undefined ? live : cachedOrUndefined<LedgerRow[]>(key);
}

type HeatmapData = {
  areas: Array<{
    _id: string;
    area: string;
    city: string;
    lots: number;
    weightKg: number;
    lat: number;
    lng: number;
    intensity: number;
  }>;
  disclaimer: string;
};

export function useCollectionAreasHeatmap() {
  const live = useQuery(api.insights.collectionAreasHeatmap, {});
  useEffect(() => {
    if (live) writeCache("heatmap", live);
  }, [live]);
  return live !== undefined ? live : cachedOrUndefined<HeatmapData>("heatmap");
}

type AdminSummary = {
  totalCollectors: number;
  totalRecyclers: number;
  totalLots: number;
  completedTransactions: number;
  pendingTransactions: number;
  totalCollectedKg: number;
  totalEarnings: number;
  avgMaterialPrice: number;
  materialDistribution: Array<{ code: string; weightKg: number }>;
  transactionStatus: Array<{ status: string; count: number }>;
  priceTrend: Array<{ day: string; avgPrice: number }>;
  collectionAreas: Array<{ _id: string; area: string; lots: number; weightKg: number; intensity: number }>;
  note: string;
};

export function useAdminSummary() {
  const live = useQuery(api.insights.adminSummary, {});
  useEffect(() => {
    if (live) writeCache("adminSummary", live);
  }, [live]);
  return live !== undefined ? live : cachedOrUndefined<AdminSummary>("adminSummary");
}
