import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { poolStatusValidator } from "./schema";
import type { Doc, Id } from "./_generated/dataModel";

// ---------------------------------------------------------------------------
// PART 2 — Smart Scrap Pooling.
//
// Privacy-preserving local aggregation: small collectors combine compatible
// e-waste so shared transport becomes viable. Privacy rules are enforced in
// THIS module, not the UI:
//   - exact coordinates are a backend matching input only; every read model
//     returns masked data (approximate distance, area label — never lat/lng
//     or another collector's geohash),
//   - contact details are never exposed before a pickup stage,
//   - the caller's identity is resolved server-side from the auth session
//     (never trusted from the client, §23).
// Nearby search uses coarse geohash buckets (§21) — no full-table scans.
// ---------------------------------------------------------------------------

const GEOHASH_PRECISION = 5; // ≈4.9 km × 4.9 km buckets
const NEARBY_BUCKET_RADIUS = 1; // search own + adjacent ring (≈ up to ~10 km)

const SUPPORTED_MATERIALS = new Set([
  "pcb", "lcd", "crt", "cable", "battery", "motor", "plastic",
]);

// ---- Geohash (standard base-32 algorithm, ~40 lines, no dependency) --------

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

export function geohashEncode(lat: number, lng: number, precision: number): string {
  const latRange = [-90.0, 90.0];
  const lngRange = [-180.0, 180.0];
  let hash = "";
  let bits = [16, 8, 4, 2, 1];
  let bit = 0;
  let ch = 0;
  let even = true;
  while (hash.length < precision) {
    if (even) {
      const mid = (lngRange[0] + lngRange[1]) / 2;
      if (lng >= mid) {
        ch |= bits[bit];
        lngRange[0] = mid;
      } else {
        lngRange[1] = mid;
      }
    } else {
      const mid = (latRange[0] + latRange[1]) / 2;
      if (lat >= mid) {
        ch |= bits[bit];
        latRange[0] = mid;
      } else {
        latRange[1] = mid;
      }
    }
    even = !even;
    if (bit < 4) {
      bit += 1;
    } else {
      hash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return hash;
}

/** Great-circle distance in km (haversine). Backend matching input only. */
export function distanceKm(
  aLat: number, aLng: number, bLat: number, bLng: number,
): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)) * 10) / 10;
}

/** All neighbouring buckets at the ring radius (including own). */
function neighboringHashes(hash: string, radius: number): string[] {
  // Adjacency is approximated by prefix fan-out at a lower precision, which
  // keeps the query to a small, index-friendly set of buckets (§21).
  const lower = hash.slice(0, Math.max(1, hash.length - 1));
  const neighbors = [lower];
  const idx = BASE32.indexOf(lower[lower.length - 1]);
  for (let d = 1; d <= radius * 8; d++) {
    neighbors.push(`${lower.slice(0, -1)}${BASE32[(idx + d) % 32]}`);
    neighbors.push(`${lower.slice(0, -1)}${BASE32[(idx - d + 32) % 32]}`);
  }
  return [...new Set(neighbors)];
}

// ---- Location (§7/§8) -------------------------------------------------------

/**
 * Upsert the signed-in collector's coarse location. Accepts GPS (from the
 * one-time permission flow) OR a manual area (approximate coordinates). The
 * exact values are stored for matching; reads are always masked.
 */
export const updateMyLocation = mutation({
  args: {
    latitude: v.number(),
    longitude: v.number(),
    locality: v.string(),
    pincode: v.optional(v.string()),
    poolingOptIn: v.boolean(),
  },
  handler: async (ctx, args) => {
    const profile = await requireCollector(ctx);
    if (profile.role !== "collector") throw new Error("Collectors only");
    // Validate GPS coordinates (§23).
    if (
      !Number.isFinite(args.latitude) || args.latitude < -90 || args.latitude > 90 ||
      !Number.isFinite(args.longitude) || args.longitude < -180 || args.longitude > 180
    ) {
      throw new Error("Invalid coordinates");
    }
    const hash = geohashEncode(args.latitude, args.longitude, GEOHASH_PRECISION);
    const existing = await ctx.db
      .query("collectorLocations")
      .withIndex("by_collector", (q) => q.eq("collectorId", profile._id))
      .unique();
    const doc = {
      collectorId: profile._id,
      approximateLatitude: args.latitude,
      approximateLongitude: args.longitude,
      geohash: hash,
      geohashPrecision: GEOHASH_PRECISION,
      locality: args.locality.trim() || "Area not set",
      pincode: args.pincode?.trim(),
      locationUpdatedAt: Date.now(),
      poolingOptIn: args.poolingOptIn,
    };
    if (existing) {
      await ctx.db.patch(existing._id, doc);
      return { locationId: existing._id, geohash: hash };
    }
    const id = await ctx.db.insert("collectorLocations", doc);
    return { locationId: id, geohash: hash };
  },
});

/** My own location (full detail is fine — it's the caller's own). */
export const myLocation = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireCollector(ctx);
    if (!profile) return null;
    return (
      (await ctx.db
        .query("collectorLocations")
        .withIndex("by_collector", (q) => q.eq("collectorId", profile._id))
        .unique()) ?? null
    );
  },
});

/** Nearby POOLS read model — masked (no coordinates of other collectors). */
export const nearbyPools = query({
  args: { materialCode: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const me = await requireCollector(ctx);
    if (!me) return [];
    const mine = await ctx.db
      .query("collectorLocations")
      .withIndex("by_collector", (q) => q.eq("collectorId", me._id))
      .unique();

    const joinable = new Set(["OPEN", "FILLING"]);
    let candidates;
    if (mine) {
      // Bucketed search (§21): own + adjacent coarse buckets, no full scan.
      const buckets = neighboringHashes(mine.geohash, NEARBY_BUCKET_RADIUS);
      const rows = [];
      for (const b of buckets) {
        for (const p of await ctx.db
          .query("pools")
          .withIndex("by_geohash", (q) => q.eq("geohash", b))
          .collect()) {
          rows.push(p);
        }
      }
      candidates = rows;
    } else {
      // No location yet: show open pools city-wide (join still allowed).
      candidates = await ctx.db.query("pools").collect();
    }

    const visible = candidates.filter(
      (p) => joinable.has(p.status) && p.creatorCollectorId !== me._id,
    );
    const masked = [];
    for (const p of visible) {
      if (args.materialCode && p.materialCode !== args.materialCode) continue;
      const joined = await ctx.db
        .query("poolContributions")
        .withIndex("by_pool", (q) => q.eq("poolId", p._id))
        .collect();
      // Approximate distance only (§13) — computed server-side, coordinate-
      // free in the response. "area" label comes from the pool's stored label.
      const distKm =
        mine && p.geohash === mine.geohash ? 0 : distanceKm(mine?.approximateLatitude ?? 0, mine?.approximateLongitude ?? 0, 0, 0) >= 0 && mine
          ? approxBucketDistance(mine.geohash, p.geohash)
          : null;
      masked.push({
        poolId: p._id,
        poolRef: p.poolRef,
        materialCode: p.materialCode,
        grade: p.grade,
        currentQuantityKg: p.currentQuantityKg,
        targetQuantityKg: p.targetQuantityKg,
        contributors: new Set(joined.map((c) => c.collectorId)).size,
        preferredRecyclerId: p.preferredRecyclerId ?? null,
        pickupWindow: p.pickupWindow,
        approximateArea: p.approximateArea,
        approxDistanceKm: distKm, // masked, bucket-level, or null
        status: p.status,
        expiresAt: p.expiresAt,
      });
    }
    masked.sort((a, b) =>
      a.approxDistanceKm === null ? 1 : b.approxDistanceKm === null ? -1 : a.approxDistanceKm - b.approxDistanceKm,
    );
    return masked.slice(0, args.limit ?? 20);
  },
});

/**
 * Coarse inter-bucket distance proxy (km) from geohash cells — deliberately
 * approximate ("~2 km away" style), never a precise position.
 */
function approxBucketDistance(a: string, b: string): number {
  if (a === b) return 0;
  const cellKm = 4.9;
  const common = [...a].findIndex((ch, i) => ch !== b[i]);
  const shared = common === -1 ? a.length : common;
  // Each differing trailing character ≈ one cell dimension of separation.
  return Math.round((a.length - shared) * cellKm * 10) / 10;
}

// ---- Nearby collectors (§10) ------------------------------------------------

/** Ranked compatible nearby collectors for a material — fully masked. */
export const nearbyCollectors = query({
  args: { materialCode: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const me = await requireCollector(ctx);
    if (!me) return [];
    const mine = await ctx.db
      .query("collectorLocations")
      .withIndex("by_collector", (q) => q.eq("collectorId", me._id))
      .unique();

    const buckets = mine
      ? neighboringHashes(mine.geohash, NEARBY_BUCKET_RADIUS)
      : [];
    const rows = [];
    for (const b of buckets) {
      for (const loc of await ctx.db
        .query("collectorLocations")
        .withIndex("by_geohash", (q) => q.eq("geohash", b))
        .collect()) {
        rows.push(loc);
      }
    }
    const out = [];
    for (const loc of rows) {
      if (loc.collectorId === me._id) continue;
      if (!loc.poolingOptIn) continue;
      // Which of their OPEN pools match the material?
      const pools = await ctx.db
        .query("pools")
        .withIndex("by_creator", (q) => q.eq("creatorCollectorId", loc.collectorId))
        .collect();
      const matching = pools.filter(
        (p) =>
          p.materialCode === args.materialCode &&
          ["OPEN", "FILLING"].includes(p.status),
      );
      if (matching.length === 0) continue;
      // §10 ranking inputs; ONLY masked outputs are returned (S3/G4).
      const dist = mine ? approxBucketDistance(mine.geohash, loc.geohash) : null;
      out.push({
        displayName: loc.locality ? `Collector (${loc.locality})` : "Nearby collector",
        area: loc.locality,
        approxDistanceKm: dist,
        openPools: matching.map((p) => ({
          poolId: p._id,
          poolRef: p.poolRef,
          materialCode: p.materialCode,
          currentQuantityKg: p.currentQuantityKg,
          targetQuantityKg: p.targetQuantityKg,
          pickupWindow: p.pickupWindow,
          approximateArea: p.approximateArea,
          status: p.status,
        })),
      });
    }
    out.sort((a, b) => (a.approxDistanceKm ?? 99) - (b.approxDistanceKm ?? 99));
    return out.slice(0, args.limit ?? 15);
  },
});

// ---- Pool lifecycle (§11/§12) ------------------------------------------------

async function nextPoolRef(ctx: MutationCtx): Promise<string> {
  const rows = await ctx.db.query("pools").collect();
  let max = 0;
  for (const r of rows) {
    const n = Number(r.poolRef.split("-").pop());
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `POOL-KC-${String(max + 1).padStart(6, "0")}`;
}

/** Resolve the signed-in profile via the Convex Auth session (established
 *  app pattern). Accepts both query and mutation contexts. */
async function requireCollector(ctx: { db: QueryCtx["db"] }) {
  const userId = await getAuthUserId(ctx as never);
  if (userId === null) throw new Error("Sign in required");
  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (!profile) throw new Error("Profile not found");
  return profile;
}

/** Create a pool from one of the creator's own lots (G5; ownership §23). */
export const createPool = mutation({
  args: {
    lotId: v.id("lots"),
    targetQuantityKg: v.number(),
    pickupWindow: v.string(),
    preferredRecyclerId: v.optional(v.id("recyclers")),
    transportCostEstimate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const profile = await requireCollector(ctx);
    if (profile.role !== "collector") throw new Error("Collectors only");
    const lot = await ctx.db.get(args.lotId);
    if (!lot) throw new Error("Lot not found");
    if (lot.collectorId !== profile._id) {
      throw new Error("You can only pool lots you own");
    }
    if (!["created", "sent", "rejected"].includes(lot.status)) {
      throw new Error("This lot is already in a transaction");
    }
    if (!SUPPORTED_MATERIALS.has(args ? lot.materialCode : "")) {
      throw new Error("Unsupported material");
    }
    if (!Number.isFinite(args.targetQuantityKg) || args.targetQuantityKg < lot.weight) {
      throw new Error("Target quantity must be at least the lot weight");
    }
    // Creator's location anchors the pool's coarse area (never exposed raw).
    const loc = await ctx.db
      .query("collectorLocations")
      .withIndex("by_collector", (q) => q.eq("collectorId", profile._id))
      .unique();
    const now = Date.now();
    const poolRef = await nextPoolRef(ctx as never);
    const id = await ctx.db.insert("pools", {
      poolRef,
      creatorCollectorId: profile._id,
      materialCode: lot.materialCode,
      grade: "Standard",
      targetQuantityKg: args.targetQuantityKg,
      currentQuantityKg: lot.weight,
      status: "OPEN",
      preferredRecyclerId: args.preferredRecyclerId,
      pickupWindow: args.pickupWindow.trim() || "Flexible",
      approximateArea: loc?.locality ?? "Delhi/NCR",
      transportCostEstimate: args.transportCostEstimate,
      geohash: loc?.geohash ?? geohashEncode(28.6139, 77.209, GEOHASH_PRECISION),
      createdAt: now,
      updatedAt: now,
      expiresAt: now + 7 * 86_400_000,
    });
    // The creator's first contribution (own lot — traceable ownership §12).
    await ctx.db.insert("poolContributions", {
      poolId: id,
      collectorId: profile._id,
      lotId: args.lotId,
      quantityKg: lot.weight,
      contributionStatus: "CONFIRMED",
      joinedAt: now,
    });
    await notifyPoolMembers(ctx as never, id, "pool_created", "Pool created", `Pool ${poolRef} is open for contributions.`);
    return { poolId: id, poolRef };
  },
});

/** In-app notification writer (§18). */
async function notifyPoolMembers(ctx: MutationCtx, poolId: Id<"pools">, type: string, title: string, body: string) {
  const contribs = await ctx.db
    .query("poolContributions")
    .withIndex("by_pool", (q) => q.eq("poolId", poolId))
    .collect();
  const recipients = new Set<Id<"profiles">>();
  for (const c of contribs) recipients.add(c.collectorId);
  const pool = await ctx.db.get(poolId);
  if (pool) recipients.add(pool.creatorCollectorId);
  for (const collectorId of recipients) {
    await ctx.db.insert("poolNotifications", {
      collectorId,
      poolId,
      type,
      title,
      body,
      createdAt: Date.now(),
    });
  }
}

/** Join a pool by contributing one of YOUR lots (G6/G8; S2 enforcement). */
export const joinPool = mutation({
  args: { poolId: v.id("pools"), lotId: v.id("lots") },
  handler: async (ctx, { poolId, lotId }) => {
    const profile = await requireCollector(ctx);
    const pool = await ctx.db.get(poolId);
    if (!pool) throw new Error("Pool not found");
    // S4/G7 guards: only joinable, material-compatible pools.
    if (!["OPEN", "FILLING"].includes(pool.status)) {
      throw new Error("This pool is no longer accepting contributions");
    }
    if (pool.expiresAt <= Date.now()) throw new Error("This pool has expired");
    const lot = await ctx.db.get(lotId);
    if (!lot) throw new Error("Lot not found");
    if (lot.collectorId !== profile._id) {
      throw new Error("You can only contribute lots you own");
    }
    if (lot.materialCode !== pool.materialCode) {
      throw new Error(`This pool accepts ${pool.materialCode.toUpperCase()} only`);
    }
    if (!["created", "sent", "rejected"].includes(lot.status)) {
      throw new Error("This lot is already in a transaction");
    }
    const existing = await ctx.db
      .query("poolContributions")
      .withIndex("by_lot", (q) => q.eq("lotId", lotId))
      .collect();
    if (existing.some((c) => c.contributionStatus !== "WITHDRAWN" && c.poolId === poolId)) {
      throw new Error("You already joined this pool with that lot");
    }
    const now = Date.now();
    await ctx.db.insert("poolContributions", {
      poolId,
      collectorId: profile._id,
      lotId,
      quantityKg: lot.weight,
      contributionStatus: "CONFIRMED",
      joinedAt: now,
    });
    const contribs = await ctx.db
      .query("poolContributions")
      .withIndex("by_pool", (q) => q.eq("poolId", poolId))
      .collect();
    const total = Math.round(
      contribs.filter((c) => c.contributionStatus !== "WITHDRAWN").reduce((s, c) => s + c.quantityKg, 0) * 10,
    ) / 10;
    const targetReached = total >= pool.targetQuantityKg;
    await ctx.db.patch(poolId, {
      currentQuantityKg: total,
      status: targetReached ? "TARGET_REACHED" : "FILLING",
      updatedAt: now,
    });
    await notifyPoolMembers(ctx as never, poolId, "member_joined", "New contributor", `A collector joined ${pool.poolRef}. Pooled: ${total} kg.`);
    if (targetReached) {
      await notifyPoolMembers(ctx as never, poolId, "target_reached", "Target reached", `${pool.poolRef} reached its ${pool.targetQuantityKg} kg target.`);
    }
    return { ok: true, pooledKg: total, targetReached };
  },
});

/** Leave a pool — the collector's own contribution only (S1). */
export const leavePool = mutation({
  args: { poolId: v.id("pools") },
  handler: async (ctx, { poolId }) => {
    const profile = await requireCollector(ctx);
    const pool = await ctx.db.get(poolId);
    if (!pool) throw new Error("Pool not found");
    if (["COMPLETED", "CANCELLED", "EXPIRED", "PICKUP_SCHEDULED"].includes(pool.status)) {
      throw new Error("This pool can no longer be left");
    }
    const mine = await ctx.db
      .query("poolContributions")
      .withIndex("by_pool", (q) => q.eq("poolId", poolId))
      .collect();
    const myRows = mine.filter((c) => c.collectorId === profile._id && c.contributionStatus !== "WITHDRAWN");
    if (myRows.length === 0) throw new Error("You have no contribution in this pool");
    if (profile._id === pool.creatorCollectorId) {
      // Creator leaving cancels the pool entirely (it's their aggregation).
      for (const c of mine) await ctx.db.patch(c._id, { contributionStatus: "WITHDRAWN" });
      await ctx.db.patch(poolId, { status: "CANCELLED", updatedAt: Date.now() });
      await notifyPoolMembers(ctx as never, poolId, "pool_completed", "Pool cancelled", `${pool.poolRef} was cancelled by its creator.`);
      return { ok: true, poolCancelled: true };
    }
    for (const c of myRows) await ctx.db.patch(c._id, { contributionStatus: "WITHDRAWN" });
    const contribs = await ctx.db
      .query("poolContributions")
      .withIndex("by_pool", (q) => q.eq("poolId", poolId))
      .collect();
    const total =
      Math.round(
        contribs.filter((c) => c.contributionStatus !== "WITHDRAWN").reduce((s, c) => s + c.quantityKg, 0) * 10,
      ) / 10;
    await ctx.db.patch(poolId, {
      currentQuantityKg: total,
      status: total > 0 ? "FILLING" : "OPEN",
      updatedAt: Date.now(),
    });
    return { ok: true, pooledKg: total, poolCancelled: false };
  },
});

/** §14 transport-economics calculator — pure math over user-entered cost. */
export function computeTransport(pooledKg: number, cost: number, participants: number, individualKg?: number) {
  const pooledPerKg = pooledKg > 0 && cost >= 0 ? Math.round((cost / pooledKg) * 10) / 10 : null;
  const individualPerKg =
    individualKg && individualKg > 0 && cost > 0 ? Math.round((cost / individualKg) * 10) / 10 : null;
  return {
    pooledQuantityKg: pooledKg,
    transportCost: cost,
    participants,
    costPerKgPooled: pooledPerKg,
    individualCostPerKg: individualPerKg,
    note: "Estimated transportation economics — calculations, not guaranteed savings.",
  };
}

/** Save a transport estimate for a pool (cost entered by user/recycler §14). */
export const saveTransportEstimate = mutation({
  args: {
    poolId: v.id("pools"),
    transportCost: v.number(),
    individualKg: v.optional(v.number()),
  },
  handler: async (ctx, { poolId, transportCost, individualKg }) => {
    const profile = await requireCollector(ctx);
    const pool = await ctx.db.get(poolId);
    if (!pool) throw new Error("Pool not found");
    if (transportCost < 0 || !Number.isFinite(transportCost)) {
      throw new Error("Transport cost must be zero or more");
    }
    const contribs = await ctx.db
      .query("poolContributions")
      .withIndex("by_pool", (q) => q.eq("poolId", poolId))
      .collect();
    const active = contribs.filter((c) => c.contributionStatus !== "WITHDRAWN");
    const calc = computeTransport(pool.currentQuantityKg, transportCost, new Set(active.map((c) => c.collectorId)).size, individualKg);
    await ctx.db.patch(poolId, { transportCostEstimate: transportCost, updatedAt: Date.now() });
    const id = await ctx.db.insert("transportEstimates", {
      poolId,
      pooledQuantityKg: calc.pooledQuantityKg,
      transportCost: calc.transportCost,
      participants: calc.participants,
      costPerKgPooled: calc.costPerKgPooled ?? 0,
      individualCostPerKg: calc.individualCostPerKg ?? undefined,
      note: calc.note,
      createdAt: Date.now(),
    });
    return { estimateId: id, ...calc };
  },
});

/**
 * §15 recycler matching for a filled pool: quantity now meets minimums, so
 * re-rank the EXISTING matching engine's criteria (material, rate, pickup,
 * service area, distance) over the pool's material + weight.
 */
export const matchRecyclersForPool = query({
  args: { poolId: v.id("pools") },
  handler: async (ctx, { poolId }) => {
    const pool = await ctx.db.get(poolId);
    if (!pool) return null;
    const recyclers = await ctx.db.query("recyclers").collect();
    const quotes = await ctx.db
      .query("recyclerQuotes")
      .withIndex("by_material_status", (q) =>
        q.eq("materialCode", pool.materialCode).eq("quoteStatus", "ACTIVE"),
      )
      .collect();
    const now = Date.now();
    const options = [];
    for (const r of recyclers) {
      if (!r.materialsAccepted.includes(pool.materialCode)) continue;
      const quote = quotes.find(
        (q) => q.recyclerId === r._id && q.validFrom <= now && q.validUntil > now,
      );
      // Min-quantity check: the POOLED quantity must satisfy the recycler.
      const meetsMin = pool.currentQuantityKg >= (quote?.minimumQuantityKg ?? 0);
      const rate = quote?.pricePerKg ?? r.rates[pool.materialCode] ?? 0;
      if (!meetsMin && quote) continue; // a real quote exists but pool is too small for it
      options.push({
        recyclerId: r._id,
        recyclerName: r.name,
        quotePerKg: rate,
        quoteIsLive: Boolean(quote),
        minimumQuantityKg: quote?.minimumQuantityKg ?? null,
        pickupAvailable: r.pickupAvailable,
        serviceArea: r.serviceArea,
        distanceKm: r.distanceKm, // facility's public service distance (masked proxy)
        validUntil: quote?.validUntil ?? null,
        estimatedValue: Math.round(rate * pool.currentQuantityKg),
        meetsMinimum: meetsMin,
      });
    }
    options.sort((a, b) => b.quotePerKg - a.quotePerKg);
    return {
      pool: {
        poolId: pool._id,
        poolRef: pool.poolRef,
        materialCode: pool.materialCode,
        currentQuantityKg: pool.currentQuantityKg,
        targetQuantityKg: pool.targetQuantityKg,
        status: pool.status,
      },
      options,
    };
  },
});

/**
 * Commit the pool to a recycler (converts the aggregation into the normal
 * transaction workflow): each contribution's lot is sent to the chosen
 * recycler, the pool transitions to MATCHED_TO_RECYCLER.
 */
export const matchPoolToRecycler = mutation({
  args: { poolId: v.id("pools"), recyclerId: v.id("recyclers") },
  handler: async (ctx, { poolId, recyclerId }) => {
    const profile = await requireCollector(ctx);
    const pool = await ctx.db.get(poolId);
    if (!pool) throw new Error("Pool not found");
    if (pool.creatorCollectorId !== profile._id) {
      throw new Error("Only the pool creator can match a recycler");
    }
    if (!["OPEN", "FILLING", "TARGET_REACHED"].includes(pool.status)) {
      throw new Error("Pool is not in a matchable state");
    }
    const recycler = await ctx.db.get(recyclerId);
    if (!recycler || !recycler.materialsAccepted.includes(pool.materialCode)) {
      throw new Error("Recycler does not accept this material");
    }
    const contribs = await ctx.db
      .query("poolContributions")
      .withIndex("by_pool", (q) => q.eq("poolId", poolId))
      .collect();
    for (const c of contribs.filter((x) => x.contributionStatus !== "WITHDRAWN")) {
      const lot = await ctx.db.get(c.lotId);
      if (lot && lot.status === "created") {
        await ctx.db.patch(lot._id, { status: "sent", recyclerId, updatedAt: Date.now() });
      } else if (lot && lot.status === "sent") {
        await ctx.db.patch(lot._id, { recyclerId, updatedAt: Date.now() });
      }
      await ctx.db.patch(c._id, { contributionStatus: "DELIVERED" });
    }
    await ctx.db.patch(poolId, {
      status: "MATCHED_TO_RECYCLER",
      matchedRecyclerId: recyclerId,
      updatedAt: Date.now(),
    });
    await notifyPoolMembers(ctx as never, poolId, "recycler_matched", "Recycler matched", `${pool.poolRef} matched to ${recycler.name}. Individual lots proceed through the normal handover + payment flow.`);
    return { ok: true, status: "MATCHED_TO_RECYCLER" };
  },
});

/** Mark pickup scheduled (creator; §11 status machine). */
export const schedulePickup = mutation({
  args: { poolId: v.id("pools"), pickupWindow: v.string() },
  handler: async (ctx, { poolId, pickupWindow }) => {
    const profile = await requireCollector(ctx);
    const pool = await ctx.db.get(poolId);
    if (!pool) throw new Error("Pool not found");
    if (pool.creatorCollectorId !== profile._id) throw new Error("Only the pool creator can schedule pickup");
    if (pool.status !== "MATCHED_TO_RECYCLER") throw new Error("Match a recycler first");
    await ctx.db.patch(poolId, {
      status: "PICKUP_SCHEDULED",
      pickupWindow: pickupWindow.trim() || pool.pickupWindow,
      updatedAt: Date.now(),
    });
    await notifyPoolMembers(ctx as never, poolId, "pickup_scheduled", "Pickup scheduled", `${pool.poolRef}: pickup arranged (${pickupWindow}).`);
    return { ok: true };
  },
});

/**
 * Complete the pool. Individual earnings remain per-collector: each lot goes
 * through the EXISTING confirmHandover + markPaymentCompleted path, so the
 * ledger stays traceable to the original owner (§25).
 */
export const completePool = mutation({
  args: { poolId: v.id("pools") },
  handler: async (ctx, { poolId }) => {
    const profile = await requireCollector(ctx);
    const pool = await ctx.db.get(poolId);
    if (!pool) throw new Error("Pool not found");
    if (!["MATCHED_TO_RECYCLER", "PICKUP_SCHEDULED"].includes(pool.status)) {
      throw new Error("Pool must be matched/scheduled before completion");
    }
    const contribs = await ctx.db
      .query("poolContributions")
      .withIndex("by_pool", (q) => q.eq("poolId", poolId))
      .collect();
    for (const c of contribs.filter((x) => x.contributionStatus === "DELIVERED")) {
      await ctx.db.patch(c._id, { contributionStatus: "CONFIRMED" });
    }
    await ctx.db.patch(poolId, {
      status: "COMPLETED",
      completedAt: Date.now(),
      updatedAt: Date.now(),
    });
    await notifyPoolMembers(ctx as never, poolId, "pool_completed", "Pool completed", `${pool.poolRef} completed. Individual earnings update per collector as each lot is paid.`);
    return { ok: true };
  },
});

// ---- Read models -------------------------------------------------------------

export type PoolWithDetail = {
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

async function poolWithDetail(
  ctx: { db: QueryCtx["db"] },
  pool: Doc<"pools">,
  viewerId: string | null,
): Promise<PoolWithDetail> {
  const contribs = await ctx.db
    .query("poolContributions")
    .withIndex("by_pool", (q) => q.eq("poolId", pool._id))
    .collect();
  const active = contribs.filter((c) => c.contributionStatus !== "WITHDRAWN");
  let matchedName: string | null = null;
  if (pool.matchedRecyclerId) {
    const r = await ctx.db.get(pool.matchedRecyclerId);
    matchedName = r?.name ?? null;
  }
  return {
    _id: pool._id,
    poolRef: pool.poolRef,
    materialCode: pool.materialCode,
    grade: pool.grade,
    status: pool.status,
    currentQuantityKg: pool.currentQuantityKg,
    targetQuantityKg: pool.targetQuantityKg,
    approximateArea: pool.approximateArea,
    pickupWindow: pool.pickupWindow,
    transportCostEstimate: pool.transportCostEstimate ?? null,
    contributors: new Set(active.map((c) => c.collectorId)).size,
    myContributionKg:
      active.filter((c) => c.collectorId === viewerId).reduce((s, c) => s + c.quantityKg, 0),
    isCreator: viewerId === pool.creatorCollectorId,
    matchedRecyclerName: matchedName,
    createdAt: pool.createdAt,
    expiresAt: pool.expiresAt,
  };
}

/** My pools (creator or contributor) — masked, per-collector view. */
export const myPools = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireCollector(ctx);
    const all = await ctx.db.query("pools").collect();
    const mine = [];
    for (const p of all) {
      const contribs = await ctx.db
        .query("poolContributions")
        .withIndex("by_pool", (q) => q.eq("poolId", p._id))
        .collect();
      const isContributor = contribs.some((c) => c.collectorId === profile._id && c.contributionStatus !== "WITHDRAWN");
      if (p.creatorCollectorId !== profile._id && !isContributor) continue;
      mine.push(await poolWithDetail(ctx, p, profile._id));
    }
    return mine.sort((a, b) => b.createdAt - a.createdAt);
  },
});

/** Pool detail (participant or open-pool viewer) — masked. */
export const getPool = query({
  args: { poolId: v.id("pools") },
  handler: async (ctx, { poolId }) => {
    const profile = await requireCollector(ctx);
    const pool = await ctx.db.get(poolId);
    if (!pool) return null;
    return poolWithDetail(ctx, pool, profile._id);
  },
});

/** My contributions across pools. */
export const myContributions = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireCollector(ctx);
    const rows = await ctx.db
      .query("poolContributions")
      .withIndex("by_collector", (q) => q.eq("collectorId", profile._id))
      .collect();
    const out = [];
    for (const c of rows.sort((a, b) => b.joinedAt - a.joinedAt)) {
      const pool = await ctx.db.get(c.poolId);
      const lot = await ctx.db.get(c.lotId);
      out.push({
        contributionId: c._id,
        poolId: c.poolId,
        poolRef: pool?.poolRef ?? "?",
        poolStatus: pool?.status ?? "?",
        materialCode: pool?.materialCode ?? lot?.materialCode ?? "?",
        lotReferenceId: lot?.referenceId ?? "?",
        quantityKg: c.quantityKg,
        contributionStatus: c.contributionStatus,
        joinedAt: c.joinedAt,
      });
    }
    return out;
  },
});

/** My in-app notifications (§18). */
export const myNotifications = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const profile = await requireCollector(ctx);
    const rows = await ctx.db
      .query("poolNotifications")
      .withIndex("by_collector", (q) => q.eq("collectorId", profile._id))
      .collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, args.limit ?? 20);
  },
});

export const markNotificationsRead = mutation({
  args: {},
  handler: async (ctx) => {
    const profile = await requireCollector(ctx);
    const rows = await ctx.db
      .query("poolNotifications")
      .withIndex("by_collector", (q) => q.eq("collectorId", profile._id))
      .collect();
    for (const r of rows.filter((x) => !x.readAt)) {
      await ctx.db.patch(r._id, { readAt: Date.now() });
    }
    return { ok: true };
  },
});

// ---- Analytics (§20) — aggregate only, no individual locations ---------------

export const poolingStats = query({
  args: {},
  handler: async (ctx) => {
    const [pools, contribs, transports] = await Promise.all([
      ctx.db.query("pools").collect(),
      ctx.db.query("poolContributions").collect(),
      ctx.db.query("transportEstimates").collect(),
    ]);
    const completed = pools.filter((p) => p.status === "COMPLETED");
    const active = pools.filter((p) => ["OPEN", "FILLING", "TARGET_REACHED", "MATCHED_TO_RECYCLER", "PICKUP_SCHEDULED"].includes(p.status));
    const byMaterial = new Map<string, number>();
    for (const p of pools) {
      byMaterial.set(p.materialCode, (byMaterial.get(p.materialCode) ?? 0) + p.currentQuantityKg);
    }
    const byArea = new Map<string, { pools: number; kg: number }>();
    for (const p of pools) {
      const cur = byArea.get(p.approximateArea) ?? { pools: 0, kg: 0 };
      byArea.set(p.approximateArea, { pools: cur.pools + 1, kg: cur.kg + p.currentQuantityKg });
    }
    const avgSize = pools.length
      ? Math.round((pools.reduce((s, p) => s + p.currentQuantityKg, 0) / pools.length) * 10) / 10
      : 0;
    const avgParticipants = pools.length
      ? Math.round((contribs.length / pools.length) * 10) / 10
      : 0;
    const est = transports[transports.length - 1];
    return {
      activePools: active.length,
      completedPools: completed.length,
      totalPooledKg: Math.round(pools.reduce((s, p) => s + p.currentQuantityKg, 0) * 10) / 10,
      avgPoolSizeKg: avgSize,
      avgParticipants,
      latestCostPerKgPooled: est?.costPerKgPooled ?? null,
      latestIndividualCostPerKg: est?.individualCostPerKg ?? null,
      estimatedReductionPerKg:
        est?.individualCostPerKg != null && est.costPerKgPooled != null
          ? Math.round((est.individualCostPerKg - est.costPerKgPooled) * 10) / 10
          : null,
      mostPooledMaterials: [...byMaterial.entries()].sort((a, b) => b[1] - a[1]).map(([materialCode, kg]) => ({ materialCode, kg })),
      activityByArea: [...byArea.entries()].map(([area, v]) => ({ area, ...v })),
      note: "Aggregate demo analytics — no individual collector locations are exposed.",
    };
  },
});

// ---- Expiry (cron) -------------------------------------------------------------

/** Daily expiry of stale pools (§11 EXPIRED status). */
export const expireStalePools = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db
      .query("pools")
      .withIndex("by_status", (q) => q.eq("status", "OPEN"))
      .collect();
    let n = 0;
    for (const p of rows.filter((x) => x.expiresAt <= now)) {
      await ctx.db.patch(p._id, { status: "EXPIRED", updatedAt: now });
      await notifyPoolMembers(ctx as never, p._id, "pool_completed", "Pool expired", `${p.poolRef} expired without reaching its target.`);
      n += 1;
    }
    const filling = await ctx.db
      .query("pools")
      .withIndex("by_status", (q) => q.eq("status", "FILLING"))
      .collect();
    for (const p of filling.filter((x) => x.expiresAt <= now)) {
      await ctx.db.patch(p._id, { status: "EXPIRED", updatedAt: now });
      n += 1;
    }
    return { expired: n };
  },
});
