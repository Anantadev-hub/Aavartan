import { v } from "convex/values";
import { query } from "./_generated/server";

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
