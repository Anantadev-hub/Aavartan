import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// ---------------------------------------------------------------------------
// Materials + price board + trends (GET /materials, GET /prices, /prices/trends)
// Reference data is seeded once at app bootstrap via seed.seedIfEmpty().
// ---------------------------------------------------------------------------

export const listMaterials = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("materials").collect();
    return rows.sort((a, b) => a.sort - b.sort);
  },
});

export const listSafetyGuides = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("safetyGuides").collect();
    // stable order: batteries first (highest risk), then the rest
    const order = ["battery", "crt", "lcd", "pcb", "cable", "motor", "other"];
    return rows.sort(
      (a, b) =>
        (order.indexOf(a.materialCode) + 1 || 99) - (order.indexOf(b.materialCode) + 1 || 99),
    );
  },
});

// Price trends for one material over 7/30/90 days.
export const priceTrends = query({
  args: {
    materialCode: v.string(),
    days: v.union(v.literal(7), v.literal(30), v.literal(90)),
  },
  handler: async (ctx, { materialCode, days }) => {
    const rows = await ctx.db
      .query("priceHistory")
      .withIndex("by_material", (q) => q.eq("materialCode", materialCode))
      .collect();
    rows.sort((a, b) => (a.day < b.day ? -1 : 1));
    return rows.slice(Math.max(0, rows.length - (days + 1)));
  },
});

// ---- §8/§9/§10 Daily price snapshot system ---------------------------------
// The dailyPrices table is the valuation source of truth for NEW lots. Every
// row is one material's recorded rate for one day, always source-labelled
// ("demo"/"manual" — never claimed as live market data). Lots freeze the
// exact row they were created against; later price moves never rewrite them.

function utcDayKey(ts = Date.now()): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/**
 * The latest applicable price for a material: today's snapshot if one exists,
 * else the most recent earlier day. Used by lots.createLot for NEW lots only.
 */
export const latestDailyPrice = query({
  args: { materialCode: v.string() },
  handler: async (ctx, { materialCode }) => {
    const rows = await ctx.db
      .query("dailyPrices")
      .withIndex("by_material", (q) => q.eq("materialCode", materialCode))
      .collect();
    if (rows.length === 0) return null;
    rows.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : b.recordedAt - a.recordedAt));
    const latest = rows[0];
    return {
      _id: latest._id,
      materialCode: latest.materialCode,
      day: latest.day,
      pricePerKg: latest.pricePerKg,
      source: latest.source,
      recordedAt: latest.recordedAt,
    };
  },
});

/** Recent daily snapshots for one material (price-system inspection). */
export const dailyPriceHistory = query({
  args: { materialCode: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { materialCode, limit }) => {
    const rows = await ctx.db
      .query("dailyPrices")
      .withIndex("by_material", (q) => q.eq("materialCode", materialCode))
      .collect();
    rows.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : b.recordedAt - a.recordedAt));
    return rows.slice(0, Math.max(1, Math.min(60, limit ?? 14)));
  },
});

/**
 * Record today's price for a material (§10). Upserts the day's row; NEW lots
 * immediately value against it while existing lots keep their frozen snapshot.
 * In production this is the seam a real market-data feed would call.
 */
export const setDailyPrice = mutation({
  args: {
    materialCode: v.string(),
    pricePerKg: v.number(),
    source: v.optional(v.string()),
  },
  handler: async (ctx, { materialCode, pricePerKg, source }) => {
    if (!Number.isFinite(pricePerKg) || pricePerKg <= 0) {
      throw new Error("pricePerKg must be a positive number");
    }
    const day = utcDayKey();
    const existing = await ctx.db
      .query("dailyPrices")
      .withIndex("by_material_day", (q) => q.eq("materialCode", materialCode).eq("day", day))
      .unique();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { pricePerKg, source: source ?? "manual", recordedAt: now });
      return { day, pricePerKg, updated: true, priceRecordId: existing._id };
    }
    const id = await ctx.db.insert("dailyPrices", {
      materialCode,
      day,
      pricePerKg,
      source: source ?? "manual",
      recordedAt: now,
    });
    return { day, pricePerKg, updated: false, priceRecordId: id };
  },
});
