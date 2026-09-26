import { v } from "convex/values";
import { query } from "./_generated/server";

// ---------------------------------------------------------------------------
// Cross-cutting analytics & decision support (spec §24, §32, §33, §35, §40).
// Everything here is rule-based over seeded demo data — no ML claims anywhere.
// ---------------------------------------------------------------------------

const pad2 = (n: number) => n.toString().padStart(2, "0");

// ---- §24 Fair Price Meter --------------------------------------------------
// Compare a recycler quote against the recent historical price range for the
// material. Neutral wording only — never accuses anyone of wrongdoing.

export const fairPriceMeter = query({
  args: { materialCode: v.string(), quotedPrice: v.number() },
  handler: async (ctx, { materialCode, quotedPrice }) => {
    const m = await ctx.db
      .query("materials")
      .withIndex("by_code", (q) => q.eq("code", materialCode))
      .unique();
    if (!m) return null;

    const history = await ctx.db
      .query("priceHistory")
      .withIndex("by_material", (q) => q.eq("materialCode", materialCode))
      .collect();
    history.sort((a, b) => (a.day < b.day ? -1 : 1));
    const recent = history.slice(-30).map((h) => h.price);
    const low = recent.length ? Math.round(Math.min(...recent)) : m.currentPrice;
    const high = recent.length ? Math.round(Math.max(...recent)) : m.currentPrice;

    // Neutral wording (§24): no accusations, purely descriptive.
    const wording =
      quotedPrice >= low && quotedPrice <= high
        ? "Within typical range"
        : quotedPrice < low
          ? "Below recent range"
          : "Above recent range";

    const pctVsMarket =
      m.currentPrice > 0
        ? Math.round(((quotedPrice - m.currentPrice) / m.currentPrice) * 100)
        : 0;

    return {
      currentMarket: m.currentPrice,
      quotedPrice,
      range: { low, high },
      wording,
      pctVsMarket,
      differencePerKg: Math.round(quotedPrice - m.currentPrice),
      // Rule-based review signal (§34) — informational, never blocking.
      isReviewSignal: quotedPrice < low * 0.85 || quotedPrice > high * 1.5,
    };
  },
});

// ---- §33 Sell Smarter simulator ---------------------------------------------
// Mixed sale vs sorted sale, computed from current demo board rates. The
// result is always labelled an estimate by the UI.

export const earningsSimulator = query({
  args: { totalWeightKg: v.number() },
  handler: async (ctx, { totalWeightKg }) => {
    if (!Number.isFinite(totalWeightKg) || totalWeightKg <= 0) {
      return null;
    }
    const materials = await ctx.db.query("materials").collect();
    const priceOf = (code: string) =>
      materials.find((m) => m.code === code)?.currentPrice ?? 0;

    // Sorted sale: a typical mixed e-waste basket split across board rates.
    const split = [
      { code: "pcb", share: 0.15 },
      { code: "cable", share: 0.2 },
      { code: "battery", share: 0.15 },
      { code: "lcd", share: 0.15 },
      { code: "motor", share: 0.1 },
      { code: "plastic", share: 0.25 },
    ] as const;

    // Mixed sale: an unsorted load is valued at the basket's average rate less
    // a 30% unsorted-handling discount (the buyer must sort it) — a simple,
    // explainable rule, not a market truth.
    const avgRate =
      materials.length > 0
        ? materials.reduce((s, m) => s + m.currentPrice, 0) / materials.length
        : 0;
    const mixedRate = Math.round(avgRate * 0.7);
    const mixedSale = Math.round(mixedRate * totalWeightKg);

    const rows = split.map((s) => ({
      code: s.code,
      share: s.share,
      pricePerKg: priceOf(s.code),
      weightKg: Math.round(totalWeightKg * s.share * 10) / 10,
      value: Math.round(priceOf(s.code) * totalWeightKg * s.share),
    }));
    const sortedSale = rows.reduce((sum, r) => sum + r.value, 0);

    return {
      totalWeightKg,
      mixedSale,
      sortedSale,
      mixedRate,
      potentialDifference: Math.max(0, sortedSale - mixedSale),
      split: rows,
      note: "Estimate based on demo prices — actual value depends on quality and the recycler's own rates.",
    };
  },
});

// ---- §10/§29 transaction list (join with lot + recycler for display) -------

export const transactionsList = query({
  args: {
    collectorId: v.optional(v.id("profiles")),
    recyclerId: v.optional(v.id("recyclers")),
  },
  handler: async (ctx, { collectorId, recyclerId }) => {
    let rows;
    if (collectorId) {
      rows = await ctx.db
        .query("transactions")
        .withIndex("by_collector", (q) => q.eq("collectorId", collectorId))
        .collect();
    } else if (recyclerId) {
      rows = await ctx.db
        .query("transactions")
        .withIndex("by_recycler", (q) => q.eq("recyclerId", recyclerId))
        .collect();
    } else {
      rows = await ctx.db.query("transactions").collect();
    }
    const out = [];
    for (const tx of rows.sort((a, b) => b.createdAt - a.createdAt)) {
      const recycler = await ctx.db.get(tx.recyclerId);
      out.push({
        _id: tx._id,
        lotId: tx.lotId,
        referenceId: tx.referenceId,
        materialCode: tx.materialCode,
        weight: tx.weight,
        quotedPrice: tx.quotedPrice,
        finalPrice: tx.finalPrice,
        paymentStatus: tx.paymentStatus,
        paymentMethod: tx.paymentMethod ?? null,
        transactionStatus: tx.transactionStatus,
        createdAt: tx.createdAt,
        recyclerName: recycler?.name ?? null,
      });
    }
    return out;
  },
});

// ---- §32 earnings ledger (row-level history with transaction join) ---------

export const earningsLedger = query({
  args: { collectorId: v.optional(v.id("profiles")) },
  handler: async (ctx, { collectorId }) => {
    const rows = collectorId
      ? await ctx.db
          .query("earnings")
          .withIndex("by_user", (q) => q.eq("userId", collectorId))
          .collect()
      : await ctx.db.query("earnings").collect();
    const out = [];
    for (const row of rows.sort((a, b) => b.createdAt - a.createdAt)) {
      const tx = await ctx.db.get(row.transactionId);
      out.push({
        _id: row._id,
        amount: row.amount,
        createdAt: row.createdAt,
        referenceId: tx?.referenceId ?? null,
        materialCode: tx?.materialCode ?? null,
        paymentMethod: tx?.paymentMethod ?? null,
      });
    }
    return out;
  },
});

// ---- §35 collection-area heatmap (fictional demo data) ----------------------

export const collectionAreasHeatmap = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("collectionAreas").collect();
    return {
      areas: rows.sort((a, b) => b.intensity - a.intensity),
      disclaimer: "Demo data — fictional collection density for illustration, not live GPS.",
    };
  },
});

// ---- §40 admin analytics summary --------------------------------------------
// Prototype note: admin summary is demo-open (no admin gate) because auth is
// demo OTP; a production build would check the caller's admin role here.

export const adminSummary = query({
  args: {},
  handler: async (ctx) => {
    const [profiles, recyclers, lots, transactions, materials, earnings, areas] =
      await Promise.all([
        ctx.db.query("profiles").collect(),
        ctx.db.query("recyclers").collect(),
        ctx.db.query("lots").collect(),
        ctx.db.query("transactions").collect(),
        ctx.db.query("materials").collect(),
        ctx.db.query("earnings").collect(),
        ctx.db.query("collectionAreas").collect(),
      ]);

    const collectors = profiles.filter((p) => p.role === "collector").length;
    const totalCollectedKg =
      Math.round(lots.reduce((s, l) => s + l.weight, 0) * 10) / 10;
    const totalEarnings = earnings.reduce((s, e) => s + e.amount, 0);
    const avgMaterialPrice =
      materials.length > 0
        ? Math.round(
            materials.reduce((s, m) => s + m.currentPrice, 0) / materials.length,
          )
        : 0;

    // Material distribution (by weight) for the admin chart.
    const byMaterial = new Map<string, number>();
    for (const l of lots) {
      byMaterial.set(l.materialCode, (byMaterial.get(l.materialCode) ?? 0) + l.weight);
    }
    const materialDistribution = [...byMaterial.entries()]
      .map(([code, weightKg]) => ({ code, weightKg: Math.round(weightKg * 10) / 10 }))
      .sort((a, b) => b.weightKg - a.weightKg);

    // Transaction status distribution.
    const byStatus = new Map<string, number>();
    for (const t of transactions) {
      byStatus.set(t.transactionStatus, (byStatus.get(t.transactionStatus) ?? 0) + 1);
    }
    const transactionStatus = [...byStatus.entries()].map(([status, count]) => ({
      status,
      count,
    }));

    // Price trend (last 30 days, averaged across materials) for the admin chart.
    const allHistory = await ctx.db.query("priceHistory").collect();
    const byDay = new Map<string, { sum: number; n: number }>();
    for (const h of allHistory) {
      const cur = byDay.get(h.day) ?? { sum: 0, n: 0 };
      cur.sum += h.price;
      cur.n += 1;
      byDay.set(h.day, cur);
    }
    const priceTrend = [...byDay.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .slice(-30)
      .map(([day, { sum, n }]) => ({ day, avgPrice: Math.round((sum / n) * 10) / 10 }));

    return {
      totalCollectors: collectors,
      totalRecyclers: recyclers.length,
      totalLots: lots.length,
      completedTransactions: transactions.filter((t) => t.transactionStatus === "COMPLETED").length,
      pendingTransactions: transactions.filter((t) => t.transactionStatus !== "COMPLETED").length,
      totalCollectedKg,
      totalEarnings,
      avgMaterialPrice,
      materialDistribution,
      transactionStatus,
      priceTrend,
      collectionAreas: areas.sort((a, b) => b.intensity - a.intensity),
      generatedAt: Date.now(),
      note: "Demo analytics over seeded data.",
    };
  },
});

// Current month key helper (exported for tests/consistency).
export const monthKey = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
};
