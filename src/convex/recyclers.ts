import { v } from "convex/values";
import { query } from "./_generated/server";

// ---------------------------------------------------------------------------
// Recycler discovery + transparent matching (GET /recyclers, POST /recyclers/match)
//
// Matching uses a fully transparent scoring function — explicitly NOT "AI
// matching" — and now returns VISIBLE match reasons (§26): material fit,
// authorization, pickup, service area and distance each contribute explainable
// points with a human-readable reason string. The % match is presented as a
// transparency aid, not scientific truth.
// ---------------------------------------------------------------------------

export const listRecyclers = query({
  args: { materialCode: v.optional(v.string()) },
  handler: async (ctx, { materialCode }) => {
    const rows = await ctx.db.query("recyclers").collect();
    const sorted = rows.sort((a, b) => a.distanceKm - b.distanceKm);
    return sorted.map((r) => ({
      ...r,
      acceptsMaterial: materialCode ? r.materialsAccepted.includes(materialCode) : true,
    }));
  },
});

export const getRecycler = query({
  args: { recyclerId: v.id("recyclers") },
  handler: async (ctx, { recyclerId }) => ctx.db.get(recyclerId),
});

export const matchRecyclers = query({
  args: {
    materialCode: v.string(),
    weightKg: v.optional(v.number()),
    verifiedOnly: v.boolean(),
    pickupOnly: v.boolean(),
    sortBy: v.union(v.literal("match"), v.literal("distance"), v.literal("rate")),
  },
  handler: async (ctx, { materialCode, weightKg, verifiedOnly, pickupOnly, sortBy }) => {
    const all = await ctx.db.query("recyclers").collect();

    const scored = all
      .filter((r) => (verifiedOnly ? r.verified : true))
      .filter((r) => (pickupOnly ? r.pickupAvailable : true))
      .map((r) => {
        const accepts = r.materialsAccepted.includes(materialCode);
        const rate = r.rates[materialCode] ?? 0;
        const reasons: string[] = [];
        let match = 0;

        if (accepts) {
          match += 40; // material compatibility
          reasons.push(`Accepts ${materialCode.toUpperCase()}`);
        }
        if (r.verified) {
          match += 20; // authorization
          reasons.push("Authorized recycler");
        }
        // distance: up to 15 pts, closer is better (25 km cap)
        match += Math.round(Math.max(0, 1 - r.distanceKm / 25) * 15);
        if (r.distanceKm <= 5) reasons.push(`Nearby — ${r.distanceKm} km away`);
        // pickup availability + service area
        if (r.pickupAvailable) {
          match += 10;
          reasons.push("Pickup available");
        }
        // rate competitiveness: up to 10 pts vs 400 ₹/kg ceiling
        if (accepts) {
          match += Math.round(Math.min(1, rate / 400) * 10);
          if (rate > 0) reasons.push(`Offers ₹${rate}/kg`);
        }
        // rating: up to 5 pts
        match += Math.round((r.rating / 5) * 5);

        const estValue = accepts && rate > 0 && weightKg ? Math.round(weightKg * rate) : null;
        return {
          ...r,
          acceptsMaterial: accepts,
          rate,
          matchScore: match,
          matchReasons: reasons,
          estimatedValue: estValue,
        };
      });

    scored.sort((a, b) => {
      if (sortBy === "distance") return a.distanceKm - b.distanceKm;
      if (sortBy === "rate") return b.rate - a.rate;
      return b.matchScore - a.matchScore || a.distanceKm - b.distanceKm;
    });
    return scored;
  },
});
