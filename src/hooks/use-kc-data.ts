import { useQuery, useMutation, useAction, useConvexAuth } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { cacheRecentPrices, getRecentPrices, useAppState } from "@/lib/app-state";
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

/**
 * True once the Convex Auth session is hydrated. Auth-dependent backend
 * queries MUST be gated on this flag: the server throws "Sign in required"
 * for an unauthenticated session and the Convex React client re-throws that
 * error during render, which previously crashed the Pooling screen (black
 * screen via the root error boundary). Profile reads stay ungated —
 * myProfile returns null (not a throw) for an unauthenticated session.
 */
export function useAuthReady(): boolean {
  const { isAuthenticated } = useConvexAuth();
  return isAuthenticated;
}

/** Signed-in user's profile (collector or recycler role). */
export function useProfile(): AppProfile | Doc<"profiles"> | null | undefined {
  const state = useProfileState();
  switch (state.phase) {
    case "loading":
      return undefined; // resolving
    case "anonymous":
    case "missing":
      return null; // shells redirect to /auth
    case "pending-sync":
    case "ready":
      return state.profile;
  }
}

/**
 * Explicit auth/profile state machine. Distinguishes:
 *   loading      — Convex Auth session still hydrating (no queries act, no
 *                  redirects fire, cached profiles are NOT trusted as auth)
 *   anonymous    — unauthenticated user (render/redirect to login)
 *   pending-sync — locally onboarded profile whose backend record does not
 *                  exist yet (offline-first bootstrap; background sync fills it)
 *   missing      — authenticated but the backend has NO profile for this
 *                  session (stale identity → shells clear cache + re-onboard)
 *   ready        — real backend profile resolved
 * A localStorage-cached *backend* profile is only ever used for display while
 * the session is verified AND the profile query cannot resolve (offline) —
 * never as proof of authentication.
 */
export type ProfileState =
  | { phase: "loading" }
  | { phase: "anonymous" }
  | { phase: "pending-sync"; profile: AppProfile }
  | { phase: "missing" }
  | { phase: "ready"; profile: Doc<"profiles"> };

export function useProfileState(): ProfileState {
  const { isLoading, isAuthenticated } = useConvexAuth();
  // myProfile is a non-throwing read: null when unauthenticated, undefined
  // while resolving, profile document when the session has one.
  const live = useQuery(api.profiles.myProfile, {});
  const pending = useMemo(() => loadPendingProfile(), []);
  useEffect(() => {
    if (live) writeCache("profile", live);
  }, [live]);

  // 1) Auth still hydrating — never trust cache as proof of authentication.
  if (isLoading) return { phase: "loading" };

  const pendingLocal =
    pending && !pending.synced
      ? ({ ...pending, isLocalProfile: true } as AppProfile)
      : null;

  // 2) Unauthenticated: only an unsynced LOCAL onboarding may render (the
  //    offline-first path); cached backend profiles do NOT authenticate.
  if (!isAuthenticated) {
    return pendingLocal
      ? { phase: "pending-sync", profile: pendingLocal }
      : { phase: "anonymous" };
  }

  // 3) Authenticated — resolve the real backend profile.
  if (live) return { phase: "ready", profile: live };
  if (live === undefined) {
    // Profile query still in flight (or unreachable offline). A pending local
    // onboarding renders immediately; a verified session may display its
    // cached profile while the query resolves.
    if (pendingLocal) return { phase: "pending-sync", profile: pendingLocal };
    const cached = cachedOrUndefined<Doc<"profiles">>("profile");
    if (cached) return { phase: "ready", profile: cached };
    return { phase: "loading" };
  }
  // 4) live === null — authenticated but no backend profile for this session
  //    (fresh sign-in before onboarding sync, or a stale identity).
  if (pendingLocal) return { phase: "pending-sync", profile: pendingLocal };
  return { phase: "missing" };
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
  const { isAuthenticated } = useConvexAuth();
  const createProfile = useMutation(api.profiles.createProfile);
  useEffect(() => {
    const p = loadPendingProfile();
    if (!p || p.synced || !navigator.onLine) return;
    void (async () => {
      try {
        // Already signed in? Never destroy the live session — the backend
        // createProfile dedupes onto the current user's account directly.
        if (!isAuthenticated) {
          try {
            await signOut();
          } catch {
            /* no existing session — fine */
          }
          await signIn("anonymous");
        }
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
/**
 * Repair a recycler profile whose facility binding is missing. Auth-timing
 * safe: waits for the Convex session to hydrate (a mount-time run while auth
 * was still resolving returned null on the server and silently no-oped — the
 * root cause of the eternal "Facility binding still syncing" state), retries
 * on network/seed races, and stops once bound. Pass `enabled: false` when no
 * repair is needed so the hook stays idle.
 */
const MAX_BINDING_REPAIR_ATTEMPTS = 5;

export function useRecyclerBindingRepair(options: { enabled?: boolean } = {}) {
  const { isAuthenticated } = useConvexAuth();
  const { online } = useAppState();
  const ensure = useMutation(api.profiles.ensureRecyclerBinding);
  const [attempts, setAttempts] = useState(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (options.enabled === false) return;
    if (!isAuthenticated || !online) return;
    if (attempts >= MAX_BINDING_REPAIR_ATTEMPTS) return;
    let cancelled = false;
    const timer = window.setTimeout(
      () => {
        void (async () => {
          try {
            const p = await ensure({});
            if (!cancelled && p && !p.recyclerId) {
              // Profile still unbound (facility seed may not have landed yet):
              // retry with backoff instead of giving up silently.
              setAttempts((a) => a + 1);
              setTick((t) => t + 1);
            }
          } catch {
            if (!cancelled) {
              setAttempts((a) => a + 1);
              setTick((t) => t + 1);
            }
          }
        })();
      },
      attempts === 0 ? 0 : 3000,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.enabled, isAuthenticated, online, attempts, tick]);
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

// ---- Market-linked dynamic pricing (§13/§14) --------------------------------

export type MarketPriceRow = {
  materialCode: string;
  materialId: string | null;
  name: string;
  unit: string;
  pricePerKg: number;
  currency: string;
  location: string;
  grade: string;
  day: string;
  recordedAt: number;
  fetchedAt: number;
  sourceName: string;
  sourceKind: "api" | "reference-feed" | "demo";
  sourceReference: string | null;
  prevPricePerKg: number | null;
  changePerKg: number | null;
  changePct: number | null;
  terminology: { headline: string; note: string };
};

type MarketPricesPayload = {
  prices: MarketPriceRow[];
  provider: {
    name: string;
    displayName: string;
    sourceKind: "api" | "reference-feed" | "demo";
    lastAttemptAt: number;
    lastSuccessAt: number | null;
    lastError: string | null;
  } | null;
};

/**
 * Backend market price board (§7): reads ONLY stored records — the React app
 * never calls an external market source. Cached for offline reads.
 */
export function useCurrentMarketPrices() {
  const live = useQuery(api.pricing.currentMarketPrices, {});
  useEffect(() => {
    if (live) writeCache("marketPrices.current", live);
  }, [live]);
  return live !== undefined
    ? live
    : cachedOrUndefined<MarketPricesPayload>("marketPrices.current");
}

/** One material's stored history for the trends chart (§15) — no fake data. */
export function useMarketPriceHistory(materialCode: string, days: 7 | 30 | 90) {
  const live = useQuery(api.pricing.marketPriceHistory, { materialCode, days });
  const key = `marketHistory.${materialCode}.${days}`;
  useEffect(() => {
    if (live) writeCache(key, live);
  }, [live, key]);
  return live !== undefined
    ? live
    : cachedOrUndefined<Array<{ day: string; pricePerKg: number; sourceName: string; sourceKind: string; recordedAt: number }>>(key);
}

/** §16 fair-price range computed from STORED records on the backend. */
export function useFairPriceRange(materialCode: string | undefined) {
  const live = useQuery(
    api.pricing.fairPriceRange,
    materialCode ? { materialCode } : "skip",
  );
  const key = `fairRange.${materialCode ?? "x"}`;
  useEffect(() => {
    if (live) writeCache(key, live);
  }, [live, key]);
  return live !== undefined
    ? live
    : cachedOrUndefined<{ low: number; high: number; records: number; earliestDay: string }>(key);
}

/**
 * Manual refresh trigger (§14). Calls the refresh API path through Convex
 * (same backend entrypoint the cron and REST endpoint use). Refreshes happen
 * on board open / app resume / explicit tap — never on every render.
 */
export function useRefreshPrices() {
  const refresh = useAction(api.pricing.refreshAllPricesAction);
  return useCallback(async () => {
    try {
      return await refresh({});
    } catch {
      return null; // backend unreachable — board falls back to last fetched
    }
  }, [refresh]);
}

// ---- Part 1: price discovery hooks ------------------------------------------

export type DiscoveryRow = {
  materialCode: string;
  day: string;
  pricePerKg: number;
  pricingMethod: "recycler_quote_median" | "demo_fallback";
  recyclerQuoteCount: number;
  quoteRange: { low: number; high: number; median?: number } | null;
  sourceKind: string;
  sourceName: string;
  sourceReference: string | null;
  location: string;
  recordedAt: number;
  label: string;
  isLiveMarketClaim: boolean;
};

/** Discovery board rows (median of valid recycler quotes or labelled demo). */
export function useDiscoveryBoard() {
  const live = useQuery(api.discovery.getDiscoveryBoard, {});
  useEffect(() => {
    if (live) writeCache("discovery.board", live);
  }, [live]);
  return live !== undefined
    ? live
    : cachedOrUndefined<DiscoveryRow[]>("discovery.board");
}

/** Active recycler quotes for one material (range + contributors). */
export function useRecyclerQuotes(materialCode: string | undefined) {
  const live = useQuery(
    api.discovery.activeQuotesForMaterial,
    materialCode ? { materialCode } : "skip",
  );
  const key = `quotes.${materialCode ?? "x"}`;
  useEffect(() => {
    if (live) writeCache(key, live);
  }, [live, key]);
  return live !== undefined
    ? live
    : cachedOrUndefined<Array<{
        quoteId: string;
        recyclerName: string;
        pricePerKg: number;
        grade: string;
        minimumQuantityKg: number;
        maximumQuantityKg: number | null;
        pickupAvailable: boolean;
        serviceArea: string;
        validUntil: number;
      }>>(key);
}

/** A recycler facility's own submitted quotes. */
export function useMyQuotes() {
  return useQuery(api.discovery.myQuotes, {});
}

// ---- Part 2: Smart Scrap Pooling hooks ---------------------------------------

export type MyPoolRow = {
  _id: string;
  poolRef: string;
  materialCode: string;
  grade: string;
  status: string;
  currentQuantityKg: number;
  targetQuantityKg: number;
  approximateArea: string;
  pickupWindow: string;
  transportCostEstimate: number | null;
  contributors: number;
  myContributionKg: number;
  isCreator: boolean;
  matchedRecyclerName: string | null;
  createdAt: number;
  expiresAt: number;
};

export function useMyPools(opts: { enabled?: boolean } = {}) {
  const live = useQuery(
    api.pooling.myPools,
    opts.enabled === false ? "skip" : {},
  );
  useEffect(() => {
    if (live) writeCache("pools.mine", live);
  }, [live]);
  return live !== undefined ? live : cachedOrUndefined<MyPoolRow[]>("pools.mine");
}

export type NearbyPoolRow = {
  poolId: string;
  poolRef: string;
  materialCode: string;
  grade: string;
  currentQuantityKg: number;
  targetQuantityKg: number;
  contributors: number;
  pickupWindow: string;
  approximateArea: string;
  approxDistanceKm: number | null;
  status: string;
  expiresAt: number;
};

export function useNearbyPools(
  materialCode?: string,
  opts: { enabled?: boolean } = {},
) {
  const live = useQuery(
    api.pooling.nearbyPools,
    opts.enabled === false ? "skip" : { materialCode },
  );
  const key = `pools.nearby.${materialCode ?? "all"}`;
  useEffect(() => {
    if (live) writeCache(key, live);
  }, [live, key]);
  return live !== undefined ? live : cachedOrUndefined<NearbyPoolRow[]>(key);
}

export type NearbyCollectorRow = {
  displayName: string;
  area: string;
  approxDistanceKm: number | null;
  openPools: Array<{
    poolId: string;
    poolRef: string;
    materialCode: string;
    currentQuantityKg: number;
    targetQuantityKg: number;
    pickupWindow: string;
    approximateArea: string;
    status: string;
  }>;
};

export function useNearbyCollectors(materialCode: string | undefined) {
  const live = useQuery(
    api.pooling.nearbyCollectors,
    materialCode ? { materialCode } : "skip",
  );
  const key = `collectors.nearby.${materialCode ?? "x"}`;
  useEffect(() => {
    if (live) writeCache(key, live);
  }, [live, key]);
  return live !== undefined ? live : cachedOrUndefined<NearbyCollectorRow[]>(key);
}

export function useMyContributions(opts: { enabled?: boolean } = {}) {
  const live = useQuery(
    api.pooling.myContributions,
    opts.enabled === false ? "skip" : {},
  );
  useEffect(() => {
    if (live) writeCache("pools.contributions", live);
  }, [live]);
  return live !== undefined
    ? live
    : cachedOrUndefined<Array<{
        contributionId: string;
        poolId: string;
        poolRef: string;
        poolStatus: string;
        materialCode: string;
        lotReferenceId: string;
        quantityKg: number;
        contributionStatus: string;
        joinedAt: number;
      }>>("pools.contributions");
}

export function usePoolDetail(
  poolId: string | undefined,
  opts: { enabled?: boolean } = {},
) {
  const live = useQuery(
    api.pooling.getPool,
    poolId && opts.enabled !== false ? { poolId: poolId as never } : "skip",
  );
  const key = `pool.${poolId ?? "x"}`;
  useEffect(() => {
    if (live) writeCache(key, live);
  }, [live, key]);
  return live !== undefined ? live : cachedOrUndefined<MyPoolRow>(key);
}

export function usePoolRecyclerOptions(
  poolId: string | undefined,
  opts: { enabled?: boolean } = {},
) {
  const live = useQuery(
    api.pooling.matchRecyclersForPool,
    poolId && opts.enabled !== false ? { poolId: poolId as never } : "skip",
  );
  const key = `poolOptions.${poolId ?? "x"}`;
  useEffect(() => {
    if (live) writeCache(key, live);
  }, [live, key]);
  return live !== undefined
    ? live
    : cachedOrUndefined<{
        pool: { poolId: string; poolRef: string; materialCode: string; currentQuantityKg: number; targetQuantityKg: number; status: string };
        options: Array<{
          recyclerId: string;
          recyclerName: string;
          quotePerKg: number;
          quoteIsLive: boolean;
          minimumQuantityKg: number | null;
          pickupAvailable: boolean;
          serviceArea: string;
          distanceKm: number;
          validUntil: number | null;
          estimatedValue: number;
          meetsMinimum: boolean;
        }>;
      }>(key);
}

export type PoolNotification = {
  _id: string;
  poolId?: string | null;
  type: string;
  title: string;
  body: string;
  readAt?: number | null;
  createdAt: number;
};

export function usePoolNotifications(opts: { enabled?: boolean } = {}) {
  const live = useQuery(
    api.pooling.myNotifications,
    opts.enabled === false ? "skip" : {},
  );
  useEffect(() => {
    if (live) writeCache("pools.notifications", live);
  }, [live]);
  return live !== undefined
    ? live
    : cachedOrUndefined<PoolNotification[]>("pools.notifications");
}

/** Submit a recycler buying quote (Part 1 §2; server-authorized). */
export function useSubmitQuote() {
  return useMutation(api.discovery.submitQuote);
}

// Pooling mutations (identity enforced server-side).
export function useUpdateMyLocation() {
  return useMutation(api.pooling.updateMyLocation);
}
export function useCreatePool() {
  return useMutation(api.pooling.createPool);
}
export function useJoinPool() {
  return useMutation(api.pooling.joinPool);
}
export function useLeavePool() {
  return useMutation(api.pooling.leavePool);
}
export function useSaveTransportEstimate() {
  return useMutation(api.pooling.saveTransportEstimate);
}
export function useMatchPoolToRecycler() {
  return useMutation(api.pooling.matchPoolToRecycler);
}
export function useSchedulePickup() {
  return useMutation(api.pooling.schedulePickup);
}
export function useCompletePool() {
  return useMutation(api.pooling.completePool);
}
export function useMarkNotificationsRead() {
  return useMutation(api.pooling.markNotificationsRead);
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
