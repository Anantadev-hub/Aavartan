import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/** Signed-in profile via the Convex Auth session (established app pattern). */
async function requireProfile(ctx: { db: unknown } extends never ? never : Parameters<typeof getAuthUserId>[0] extends never ? never : { db: import("./_generated/server").QueryCtx["db"] }) {
  const userId = await getAuthUserId(ctx as never);
  if (userId === null) throw new Error("Sign in required");
  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  return profile;
}

// ---------------------------------------------------------------------------
// PART 1 — Recycler-quote price discovery.
//
// Three price strata that must NEVER be conflated in the UI:
//   A. commodity/reference — external benchmark (future provider; not live yet)
//   B. recycler_quote      — what an authorized recycler will actually pay
//   C. demo/reference      — clearly-labelled simulated fallback
//
// The discovery engine computes the market reference for a material:
//   valid recycler quotes → { low, median, high, count } (pricingMethod
//   "recycler_quote_median") — else the existing demo feed, labelled
//   "Reference price — demo data" (pricingMethod "demo_fallback").
// It NEVER invents quotes and NEVER claims a benchmark is live.
// ---------------------------------------------------------------------------

export const QUOTE_STATUS = {
  ACTIVE: "ACTIVE",
  PAUSED: "PAUSED",
  EXPIRED: "EXPIRED",
  WITHDRAWN: "WITHDRAWN",
} as const;

const SUPPORTED_MATERIALS = new Set([
  "pcb", "lcd", "crt", "cable", "battery", "motor", "plastic",
]);

function utcDayKey(ts = Date.now()): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/** Safe validation for a submitted quote (§12-style, server-side). */
function validateQuoteInput(input: {
  pricePerKg: number;
  minimumQuantityKg: number;
  maximumQuantityKg?: number;
  validFrom: number;
  validUntil: number;
}): string | null {
  if (!Number.isFinite(input.pricePerKg) || input.pricePerKg <= 0 || input.pricePerKg > 100_000) {
    return "Price must be a positive ₹/kg value";
  }
  if (!Number.isFinite(input.minimumQuantityKg) || input.minimumQuantityKg < 0) {
    return "Minimum quantity must be zero or more";
  }
  if (
    input.maximumQuantityKg !== undefined &&
    (!Number.isFinite(input.maximumQuantityKg) || input.maximumQuantityKg < input.minimumQuantityKg)
  ) {
    return "Maximum quantity must be ≥ minimum quantity";
  }
  if (!Number.isFinite(input.validFrom) || !Number.isFinite(input.validUntil) || input.validUntil <= input.validFrom) {
    return "Validity window is invalid";
  }
  if (input.validUntil - input.validFrom > 92 * 86_400_000) {
    return "Validity window cannot exceed 92 days";
  }
  return null;
}

/**
 * Submit (or replace) a recycler's buying quote for one material.
 * Authorization: the caller must own a RECYCLER profile bound to a facility,
 * and that facility must accept the material (server-enforced, §23).
 * Re-submitting for the same material replaces the recycler's previous
 * ACTIVE quote (one live quote per recycler × material).
 */
export const submitQuote = mutation({
  args: {
    materialCode: v.string(),
    pricePerKg: v.number(),
    grade: v.optional(v.string()),
    minimumQuantityKg: v.number(),
    maximumQuantityKg: v.optional(v.number()),
    pickupAvailable: v.boolean(),
    serviceArea: v.string(),
    validDays: v.optional(v.number()), // default 7
  },
  handler: async (ctx, args) => {
    // Server-side identity + role (§23: never trust client-provided identity).
    const profile = await requireProfile(ctx);
    if (!profile) throw new Error("Profile not found");
    if (profile.role !== "recycler" || !profile.recyclerId) {
      throw new Error("Only authorized recyclers can submit buying quotes");
    }
    const recycler = await ctx.db.get(profile.recyclerId);
    if (!recycler) throw new Error("Facility not found");
    if (!recycler.materialsAccepted.includes(args.materialCode)) {
      throw new Error(`Facility does not accept ${args.materialCode.toUpperCase()}`);
    }
    const err = validateQuoteInput({
      pricePerKg: args.pricePerKg,
      minimumQuantityKg: args.minimumQuantityKg,
      maximumQuantityKg: args.maximumQuantityKg,
      validFrom: Date.now(),
      validUntil: Date.now() + 86_400_000,
    });
    if (err) throw new Error(err);

    const now = Date.now();
    const validFrom = now;
    const validUntil = now + Math.max(1, args.validDays ?? 7) * 86_400_000;

    // Retire any previous active quote for this recycler × material.
    const previous = await ctx.db
      .query("recyclerQuotes")
      .withIndex("by_recycler", (q) => q.eq("recyclerId", profile.recyclerId!))
      .collect();
    for (const q of previous) {
      if (q.materialCode === args.materialCode && q.quoteStatus === "ACTIVE") {
        await ctx.db.patch(q._id, { quoteStatus: "WITHDRAWN", updatedAt: now });
      }
    }

    const id = await ctx.db.insert("recyclerQuotes", {
      recyclerId: profile.recyclerId,
      materialCode: args.materialCode,
      pricePerKg: Math.round(args.pricePerKg * 10) / 10,
      grade: (args.grade ?? "Standard").trim(),
      minimumQuantityKg: args.minimumQuantityKg,
      maximumQuantityKg: args.maximumQuantityKg,
      pickupAvailable: args.pickupAvailable,
      serviceArea: args.serviceArea.trim() || recycler.serviceArea,
      quoteStatus: "ACTIVE",
      validFrom,
      validUntil,
      createdAt: now,
      updatedAt: now,
    });

    // Refresh the discovery snapshot for this material right away.
    await ctx.runMutation(internal.discovery.recomputeSnapshot, { materialCode: args.materialCode });
    return { quoteId: id, validUntil };
  },
});

/** List a recycler's own quotes (facility view). */
export const myQuotes = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    if (!profile?.recyclerId) return [];
    const rows = await ctx.db
      .query("recyclerQuotes")
      .withIndex("by_recycler", (q) => q.eq("recyclerId", profile.recyclerId as Id<"recyclers">))
      .collect();
    return rows.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

/** Public board view: active quotes per material (with facility display name). */
export const activeQuotesForMaterial = query({
  args: { materialCode: v.string() },
  handler: async (ctx, { materialCode }) => {
    const now = Date.now();
    const rows = await ctx.db
      .query("recyclerQuotes")
      .withIndex("by_material_status", (q) =>
        q.eq("materialCode", materialCode).eq("quoteStatus", "ACTIVE"),
      )
      .collect();
    const valid = rows.filter((r) => r.validFrom <= now && r.validUntil > now);
    const withFacility = [];
    for (const r of valid) {
      const facility = await ctx.db.get(r.recyclerId as Id<"recyclers">);
      withFacility.push({
        quoteId: r._id,
        recyclerId: r.recyclerId,
        recyclerName: facility?.name ?? "Authorized recycler",
        pricePerKg: r.pricePerKg,
        grade: r.grade,
        minimumQuantityKg: r.minimumQuantityKg,
        maximumQuantityKg: r.maximumQuantityKg ?? null,
        pickupAvailable: r.pickupAvailable,
        serviceArea: r.serviceArea,
        validUntil: r.validUntil,
      });
    }
    return withFacility.sort((a, b) => b.pricePerKg - a.pricePerKg);
  },
});

// ---- The discovery engine ---------------------------------------------------

type QuoteRow = { pricePerKg: number };

/**
 * Median (not mean) — an outlier quote must not drag the reference. Even
 * count averages the two middle values.
 */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const m = s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  return Math.round(m * 10) / 10;
}

/** Core computation over already-filtered rows (unit-testable). */
export function computeDiscovery(quotes: QuoteRow[]) {
  const prices = quotes.map((q) => q.pricePerKg);
  const count = prices.length;
  if (count === 0) {
    return { count: 0, low: null, median: null, high: null, pricingMethod: "demo_fallback" as const };
  }
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  return {
    count,
    low: Math.round(low * 10) / 10,
    median: median(prices),
    high: Math.round(high * 10) / 10,
    pricingMethod: "recycler_quote_median" as const,
  };
}

/**
 * Recompute + store today's discovery snapshot for one material. Returns the
 * snapshot shape used by the board. Fallback labels are explicit (§3/§4):
 * no real quotes → "Reference price — demo data".
 */
export const recomputeSnapshot = internalMutation({
  args: { materialCode: v.string() },
  handler: async (ctx, { materialCode }) => {
    const now = Date.now();
    const day = utcDayKey(now);
    const rows = await ctx.db
      .query("recyclerQuotes")
      .withIndex("by_material_status", (q) =>
        q.eq("materialCode", materialCode).eq("quoteStatus", "ACTIVE"),
      )
      .collect();
    const valid = rows.filter((r) => r.validFrom <= now && r.validUntil > now);
    const disc = computeDiscovery(valid);

    let pricePerKg: number;
    let sourceKind: "demo" | "recycler_quote";
    let sourceName: string;
    let sourceReference: string | undefined;
    if (disc.count > 0 && disc.median !== null) {
      pricePerKg = disc.median;
      sourceKind = "recycler_quote";
      sourceName = `${disc.count} recycler quote${disc.count > 1 ? "s" : ""} (median)`;
      sourceReference = "kabadiwala-connect://price-discovery";
    } else {
      // Fallback: the existing demo/reference feed value (already bridged into
      // dailyPrices by the pricing pipeline). Never presented as live.
      const demo = await ctx.db
        .query("dailyPrices")
        .withIndex("by_material", (q) => q.eq("materialCode", materialCode))
        .collect();
      const todayRow = demo
        .filter((r) => r.day <= day)
        .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : b.recordedAt - a.recordedAt))[0];
      pricePerKg = todayRow?.pricePerKg ?? 0;
      sourceKind = "demo";
      sourceName = "Demo Reference Feed";
      sourceReference = "internal://demo-reference-feed";
    }

    const existing = await ctx.db
      .query("priceSnapshots")
      .withIndex("by_material_day", (q) =>
        q.eq("materialCode", materialCode).eq("day", day),
      )
      .unique();
    const doc = {
      materialCode,
      day,
      pricePerKg,
      pricingMethod: disc.count > 0 ? ("recycler_quote_median" as const) : ("demo_fallback" as const),
      low: disc.low ?? undefined,
      high: disc.high ?? undefined,
      median: disc.median ?? undefined,
      recyclerQuoteCount: disc.count,
      sourceKind,
      sourceName,
      sourceReference,
      location: "Delhi/NCR",
      recordedAt: now,
      fetchedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, doc);
      return { ...doc, _id: existing._id };
    }
    const id = await ctx.db.insert("priceSnapshots", doc);
    return { ...doc, _id: id };
  },
});

/**
 * Discovery read model for the Price Board: today's snapshot (recomputed on
 * read so fresh quotes are reflected), plus the recycler quote range when
 * present and the honest source labels (§4/§8).
 */
export const getDiscovery = query({
  args: { materialCode: v.string() },
  handler: async (ctx, { materialCode }) => {
    const snap = await ctx.db
      .query("priceSnapshots")
      .withIndex("by_material_day", (q) =>
        q.eq("materialCode", materialCode).eq("day", utcDayKey()),
      )
      .unique();
    if (!snap) return null;
    const now = Date.now();
    const quotes = await ctx.db
      .query("recyclerQuotes")
      .withIndex("by_material_status", (q) =>
        q.eq("materialCode", materialCode).eq("quoteStatus", "ACTIVE"),
      )
      .collect();
    const valid = quotes.filter((r) => r.validFrom <= now && r.validUntil > now);
    const prices = valid.map((r) => r.pricePerKg);
    return {
      materialCode: snap.materialCode,
      day: snap.day,
      pricePerKg: snap.pricePerKg,
      pricingMethod: snap.pricingMethod,
      recyclerQuoteCount: snap.recyclerQuoteCount,
      quoteRange: prices.length > 0
        ? {
            low: Math.round(Math.min(...prices) * 10) / 10,
            high: Math.round(Math.max(...prices) * 10) / 10,
            median: median(prices) ?? undefined,
          }
        : null,
      sourceKind: snap.sourceKind,
      sourceName: snap.sourceName,
      sourceReference: snap.sourceReference ?? null,
      location: snap.location,
      recordedAt: snap.recordedAt,
      // Honest display strings derived from the REAL source kind (§8):
      label:
        snap.pricingMethod === "recycler_quote_median"
          ? "Recycler quote reference"
          : "Reference price — demo data",
      isLiveMarketClaim: false, // never true in this prototype — §8/§26
    };
  },
});

/** Discovery for every material (board rows). */
export const getDiscoveryBoard = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("priceSnapshots").collect();
    const latestByMaterial = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      const cur = latestByMaterial.get(r.materialCode);
      if (!cur || r.day > cur.day || (r.day === cur.day && r.recordedAt > cur.recordedAt)) {
        latestByMaterial.set(r.materialCode, r);
      }
    }
    const now = Date.now();
    const out = [];
    for (const snap of latestByMaterial.values()) {
      const quotes = await ctx.db
        .query("recyclerQuotes")
        .withIndex("by_material_status", (q) =>
          q.eq("materialCode", snap.materialCode).eq("quoteStatus", "ACTIVE"),
        )
        .collect();
      const valid = quotes.filter((r) => r.validFrom <= now && r.validUntil > now);
      const prices = valid.map((r) => r.pricePerKg);
      out.push({
        materialCode: snap.materialCode,
        day: snap.day,
        pricePerKg: snap.pricePerKg,
        pricingMethod: snap.pricingMethod,
        recyclerQuoteCount: snap.recyclerQuoteCount,
        quoteRange:
          prices.length > 0
            ? {
                low: Math.round(Math.min(...prices) * 10) / 10,
                high: Math.round(Math.max(...prices) * 10) / 10,
                median: median(prices) ?? undefined,
              }
            : null,
        sourceKind: snap.sourceKind,
        sourceName: snap.sourceName,
        sourceReference: snap.sourceReference ?? null,
        location: snap.location,
        recordedAt: snap.recordedAt,
        label:
          snap.pricingMethod === "recycler_quote_median"
            ? "Recycler quote reference"
            : "Reference price — demo data",
        isLiveMarketClaim: false,
      });
    }
    return out;
  },
});

/** Daily recompute for all materials (cron; quotes age out over time). */
export const recomputeAllSnapshots = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const materialCode of SUPPORTED_MATERIALS) {
      await ctx.runMutation(internal.discovery.recomputeSnapshot, { materialCode });
    }
    return { ok: true };
  },
});

/**
 * TEST SEAM (P7 companion): advance the validity clock — expire quotes older
 * than a cutoff so the expiry path can be demonstrated without waiting days.
 */
export const expireQuotesForTest = mutation({
  args: { beforeTs: v.number(), materialCode: v.optional(v.string()) },
  handler: async (ctx, { beforeTs, materialCode }) => {
    const rows = await ctx.db.query("recyclerQuotes").collect();
    let n = 0;
    for (const r of rows) {
      if (r.quoteStatus === "ACTIVE" && r.validUntil <= beforeTs) {
        if (materialCode && r.materialCode !== materialCode) continue;
        await ctx.db.patch(r._id, { quoteStatus: "EXPIRED", updatedAt: Date.now() });
        n += 1;
      }
    }
    if (materialCode) {
      await ctx.runMutation(internal.discovery.recomputeSnapshot, { materialCode });
    } else {
      await ctx.runMutation(internal.discovery.recomputeAllSnapshots, {});
    }
    return { expired: n };
  },
});
