import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useEffect } from "react";
import { cacheRecentPrices, getRecentPrices } from "@/lib/app-state";

export type MaterialRow = Doc<"materials">;

/** Signed-in user's profile (collector or recycler role). */
export function useProfile() {
  return useQuery(api.profiles.myProfile, {});
}

/** Material catalogue; caches the latest copy for offline reads. */
export function useMaterials(opts: { cache?: boolean } = {}) {
  const materials = useQuery(api.materials.listMaterials, {});
  useEffect(() => {
    if (materials && materials.length > 0 && opts.cache !== false) {
      cacheRecentPrices(materials);
    }
  }, [materials, opts.cache]);
  const cached = getRecentPrices<MaterialRow[]>();
  return { materials, cached };
}

export function usePriceTrends(materialCode: string, days: 7 | 30 | 90) {
  return useQuery(api.materials.priceTrends, { materialCode, days });
}

export function useSafetyGuides() {
  return useQuery(api.materials.listSafetyGuides, {});
}

export function useEarnings(collectorId: Id<"profiles"> | undefined) {
  const summary = useQuery(api.lots.earningsSummary, collectorId ? { collectorId } : "skip");
  const monthly = useQuery(api.lots.monthlyEarnings, collectorId ? { collectorId } : "skip");
  return { summary, monthly };
}

export function useMyLots(collectorId: Id<"profiles"> | undefined) {
  return useQuery(api.lots.listLots, collectorId ? { collectorId } : "skip");
}

export function useRecyclerLots(recyclerId: Id<"recyclers"> | undefined) {
  return useQuery(api.lots.listLots, recyclerId ? { recyclerId } : "skip");
}

export function useAvailableLots() {
  return useQuery(api.lots.listAvailableLots, {});
}

export function useRecyclerStats(recyclerId: Id<"recyclers"> | undefined) {
  return useQuery(api.lots.recyclerStats, recyclerId ? { recyclerId } : "skip");
}

export function useSendSync() {
  return useMutation(api.sync.syncQueue);
}
