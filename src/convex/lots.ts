import { v } from "convex/values";
import { type MutationCtx, mutation, query } from "./_generated/server";
import { conditionValidator, lotStatusValidator, paymentMethodValidator } from "./schema";

// ---------------------------------------------------------------------------
// Lots — full transactional lifecycle (POST /lots, GET /lots, quote, handover,
// payment, earnings). The tracking timeline is derived from the lot record.
// ---------------------------------------------------------------------------

const pad2 = (n: number) => n.toString().padStart(2, "0");
const pad4 = (n: number) => n.toString().padStart(4, "0");

// Reference IDs continue from the highest existing number.
async function nextReferenceId(ctx: MutationCtx): Promise<string> {
  const rows = await ctx.db.query("lots").collect();
  let maxNum = 0;
  for (const r of rows) {
    const num = Number(r.referenceId.split("-").pop());
    if (Number.isFinite(num) && num > maxNum) maxNum = num;
  }
  return `KC-2026-${pad4(maxNum + 1)}`;
}

// Simple synchronous string hash — demo tamper-evidence for handover records.
function demoHash(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 + c * (i + 7), 2654435761) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

const CONDITION_MULTIPLIER: Record<string, number> = { good: 1, mixed: 0.9, damaged: 0.7 };

// Rules-based anomaly detection. Returns flags; never blocks, never accuses.
function detectAnomalies(lot: {
  materialCode: string;
  weight: number;
  estimatedValue: number;
  condition: string;
  quotedPrice?: number;
  finalSaleValue?: number;
}): Array<{ type: string; message: string; severity: "low" | "medium" | "high" }> {
  const flags: Array<{ type: string; message: string; severity: "low" | "medium" | "high" }> = [];
  if (!Number.isFinite(lot.weight) || lot.weight <= 0) {
    flags.push({ type: "invalid_weight", message: "Weight is zero or invalid — review recommended", severity: "high" });
  }
  if (lot.weight > 500) {
    flags.push({ type: "unusual_weight", message: "Unusual weight for a single collection — review recommended", severity: "medium" });
  }
  if (lot.quotedPrice && lot.estimatedValue > 0 && lot.weight > 0) {
    const estRate = lot.estimatedValue / lot.weight;
    if (lot.quotedPrice > estRate * 2.5) {
      flags.push({ type: "extreme_price", message: "Quoted price far above indicative market rate — review recommended", severity: "medium" });
    }
    if (lot.condition === "damaged" && lot.quotedPrice > estRate * 1.2) {
      flags.push({ type: "condition_price_mismatch", message: "Damaged condition priced above estimate — review recommended", severity: "low" });
    }
  }
  if (lot.finalSaleValue && lot.estimatedValue > 0 && lot.finalSaleValue > lot.estimatedValue * 2) {
    flags.push({ type: "extreme_price", message: "Final value far above the AI estimate — review recommended", severity: "medium" });
  }
  return flags;
}

async function storeAnomalies(
  ctx: MutationCtx,
  lotId: import("./_generated/dataModel").Id<"lots">,
  lot: Parameters<typeof detectAnomalies>[0],
) {
  for (const flag of detectAnomalies(lot)) {
    await ctx.db.insert("anomalyFlags", { lotId, ...flag, reviewed: false, createdAt: Date.now() });
  }
}

export const estimateValue = query({
  args: { materialCode: v.string(), weight: v.number(), condition: conditionValidator },
  handler: async (ctx, { materialCode, weight, condition }) => {
    const m = await ctx.db
      .query("materials")
      .withIndex("by_code", (q) => q.eq("code", materialCode))
      .unique();
    if (!m) return null;
    const rate = m.currentPrice * (CONDITION_MULTIPLIER[condition] ?? 1);
    return { ratePerKg: Math.round(rate), estimatedValue: Math.round(weight * rate) };
  },
});

export const createLot = mutation({
  args: {
    collectorId: v.id("profiles"),
    recyclerId: v.optional(v.id("recyclers")),
    materialCode: v.string(),
    weight: v.number(),
    condition: conditionValidator,
    pieces: v.optional(v.number()),
    notes: v.optional(v.string()),
    source: v.optional(v.string()),
    photoDataUrl: v.optional(v.string()),
    aiMaterialCode: v.optional(v.string()),
    aiConfidence: v.optional(v.number()),
    locationLabel: v.string(),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    syncOrigin: v.union(v.literal("online"), v.literal("offline")),
    sendNow: v.boolean(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const m = await ctx.db
      .query("materials")
      .withIndex("by_code", (q) => q.eq("code", args.materialCode))
      .unique();
    if (!m) throw new Error("Unknown material");
    const rate = m.currentPrice * (CONDITION_MULTIPLIER[args.condition] ?? 1);
    const estimatedValue = Math.round(args.weight * rate);
    const referenceId = await nextReferenceId(ctx);
    const lotId = await ctx.db.insert("lots", {
      referenceId,
      collectorId: args.collectorId,
      recyclerId: args.recyclerId,
      materialCode: args.materialCode,
      weight: args.weight,
      condition: args.condition,
      pieces: args.pieces,
      notes: args.notes,
      source: args.source,
      photoDataUrl: args.photoDataUrl,
      aiMaterialCode: args.aiMaterialCode,
      aiConfidence: args.aiConfidence,
      estimatedValue,
      locationLabel: args.locationLabel,
      lat: args.lat,
      lng: args.lng,
      status: args.sendNow ? "sent" : "created",
      paymentStatus: "none",
      syncOrigin: args.syncOrigin,
      createdAt: now,
      updatedAt: now,
    });
    await storeAnomalies(ctx, lotId, {
      materialCode: args.materialCode,
      weight: args.weight,
      estimatedValue,
      condition: args.condition,
    });
    return { lotId, referenceId, estimatedValue };
  },
});

export const sendLot = mutation({
  args: { lotId: v.id("lots") },
  handler: async (ctx, { lotId }) => {
    const lot = await ctx.db.get(lotId);
    if (!lot) throw new Error("Lot not found");
    if (lot.status !== "created") throw new Error("Lot already sent");
    await ctx.db.patch(lotId, { status: "sent", updatedAt: Date.now() });
    return { ok: true };
  },
});

export const quoteLot = mutation({
  args: {
    lotId: v.id("lots"),
    recyclerId: v.id("recyclers"),
    quotedPrice: v.optional(v.number()),
    reject: v.optional(v.boolean()),
    rejectionReason: v.optional(v.string()),
  },
  handler: async (ctx, { lotId, recyclerId, quotedPrice, reject, rejectionReason }) => {
    const lot = await ctx.db.get(lotId);
    if (!lot) throw new Error("Lot not found");
    if (lot.status !== "sent") throw new Error("Lot is not awaiting review");
    const now = Date.now();

    if (reject) {
      await ctx.db.patch(lotId, {
        status: "rejected",
        recyclerId,
        rejectionReason: rejectionReason || "No reason provided",
        updatedAt: now,
      });
      return { status: "rejected" as const };
    }
    if (!quotedPrice || quotedPrice <= 0) throw new Error("Quote must be positive");
    const finalSaleValue = Math.round(quotedPrice * lot.weight);
    await ctx.db.patch(lotId, {
      status: "accepted",
      recyclerId,
      quotedPrice,
      quotedAt: now,
      finalSaleValue,
      updatedAt: now,
    });
    await storeAnomalies(ctx, lotId, {
      materialCode: lot.materialCode,
      weight: lot.weight,
      estimatedValue: lot.estimatedValue,
      condition: lot.condition,
      quotedPrice,
      finalSaleValue,
    });
    return { status: "accepted" as const, finalSaleValue };
  },
});

// ---- Handover: two-sided confirmation, then a digital record ---------------

export const confirmHandover = mutation({
  args: { lotId: v.id("lots"), by: v.union(v.literal("collector"), v.literal("recycler")) },
  handler: async (ctx, { lotId, by }) => {
    const lot = await ctx.db.get(lotId);
    if (!lot) throw new Error("Lot not found");
    if (lot.status !== "accepted") throw new Error("Handover only after acceptance");
    const now = Date.now();
    const collectorConfirmed =
      by === "collector" ? true : (lot.handoverConfirmedByCollector ?? false);
    const recyclerConfirmed =
      by === "recycler" ? true : (lot.handoverConfirmedByRecycler ?? false);
    const both = collectorConfirmed && recyclerConfirmed;
    const handoverRef =
      lot.handoverRef ?? `DH-${lot.referenceId}-${now.toString(36).toUpperCase()}`;
    const handoverHash =
      lot.handoverHash ??
      demoHash(`${lot.referenceId}|${lot.weight}|${collectorConfirmed}|${recyclerConfirmed}|${now}`);
    await ctx.db.patch(lotId, {
      handoverConfirmedByCollector: collectorConfirmed,
      handoverConfirmedByRecycler: recyclerConfirmed,
      handoverRef,
      handoverHash,
      handoverAt: both ? now : lot.handoverAt,
      status: both ? "handed_over" : lot.status,
      paymentStatus: both ? "pending" : lot.paymentStatus,
      updatedAt: now,
    });
    return { both, handoverRef, handoverHash };
  },
});

export const markPaymentCompleted = mutation({
  args: { lotId: v.id("lots"), method: paymentMethodValidator },
  handler: async (ctx, { lotId, method }) => {
    const lot = await ctx.db.get(lotId);
    if (!lot) throw new Error("Lot not found");
    if (lot.status !== "handed_over") throw new Error("Payment only after handover");
    const now = Date.now();
    await ctx.db.patch(lotId, {
      paymentMethod: method,
      paymentStatus: "completed",
      paymentAt: now,
      status: "completed",
      updatedAt: now,
    });
    return { ok: true, finalSaleValue: lot.finalSaleValue ?? null };
  },
});

// ---- Queries ---------------------------------------------------------------

export const listLots = query({
  args: {
    collectorId: v.optional(v.id("profiles")),
    recyclerId: v.optional(v.id("recyclers")),
    status: v.optional(lotStatusValidator),
  },
  handler: async (ctx, { collectorId, recyclerId, status }) => {
    let rows;
    if (collectorId) {
      rows = await ctx.db
        .query("lots")
        .withIndex("by_collector", (q) => q.eq("collectorId", collectorId))
        .collect();
    } else if (recyclerId) {
      rows = await ctx.db
        .query("lots")
        .withIndex("by_recycler", (q) => q.eq("recyclerId", recyclerId))
        .collect();
    } else {
      rows = await ctx.db.query("lots").collect();
    }
    const filtered = status ? rows.filter((r) => r.status === status) : rows;
    return filtered.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const getLot = query({
  args: { lotId: v.id("lots") },
  handler: async (ctx, { lotId }) => {
    const lot = await ctx.db.get(lotId);
    if (!lot) return null;
    const recycler = lot.recyclerId ? await ctx.db.get(lot.recyclerId) : null;
    const collector = await ctx.db.get(lot.collectorId);
    const flags = (
      await ctx.db.query("anomalyFlags").withIndex("by_lot", (q) => q.eq("lotId", lotId)).collect()
    ).sort((a, b) => b.createdAt - a.createdAt);
    return { lot, recycler, collector, anomalyFlags: flags };
  },
});

export const listAvailableLots = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("lots")
      .withIndex("by_status", (q) => q.eq("status", "sent"))
      .collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },
});

// ---- Tracking timeline ------------------------------------------------------

export type TimelineEvent = {
  code: "created" | "sent" | "quoted" | "handed_over" | "payment";
  label: string;
  timestamp: number | null;
  description: string;
  state: "done" | "pending" | "todo";
};

export const lotTimeline = query({
  args: { lotId: v.id("lots") },
  handler: async (ctx, { lotId }) => {
    const lot = await ctx.db.get(lotId);
    if (!lot) return null;
    const events: TimelineEvent[] = [
      {
        code: "created",
        label: "Lot created",
        timestamp: lot.createdAt,
        state: "done",
        description:
          lot.syncOrigin === "offline"
            ? "Captured offline, synced to the platform"
            : "Registered with a unique reference ID",
      },
      {
        code: "sent",
        label: "Sent to recycler",
        timestamp: lot.status === "created" ? null : (lot.quotedAt ?? lot.updatedAt),
        state: lot.status === "created" ? "todo" : "done",
        description: "Waiting for the recycler to review",
      },
      {
        code: "quoted",
        label: lot.status === "rejected" ? "Rejected by recycler" : "Recycler quoted",
        timestamp: lot.quotedAt ?? null,
        state:
          lot.status === "rejected"
            ? "done"
            : lot.quotedAt !== null
              ? "done"
              : lot.status === "sent"
                ? "pending"
                : "todo",
        description:
          lot.status === "rejected"
            ? (lot.rejectionReason ?? "Lot was rejected")
            : lot.quotedPrice
              ? `₹${lot.quotedPrice}/kg agreed`
              : "Review pending",
      },
      {
        code: "handed_over",
        label: "Handover completed",
        timestamp: lot.handoverAt ?? null,
        state:
          lot.handoverAt !== null ? "done" : lot.status === "accepted" ? "pending" : "todo",
        description: lot.handoverRef
          ? `Digital record ${lot.handoverRef}`
          : "Both sides must confirm",
      },
      {
        code: "payment",
        label: "Payment completed",
        timestamp: lot.paymentAt ?? null,
        state:
          lot.paymentAt !== null ? "done" : lot.status === "handed_over" ? "pending" : "todo",
        description: lot.paymentMethod
          ? `${lot.paymentMethod.toUpperCase()} — ₹${lot.finalSaleValue ?? 0}`
          : "Cash or UPI after handover",
      },
    ];
    return { events };
  },
});

// ---- Earnings ledger (GET /earnings/summary, /earnings/monthly) ------------

export const earningsSummary = query({
  args: { collectorId: v.id("profiles") },
  handler: async (ctx, { collectorId }) => {
    const rows = await ctx.db
      .query("lots")
      .withIndex("by_collector", (q) => q.eq("collectorId", collectorId))
      .collect();
    const sold = rows.filter((r) => r.paymentStatus === "completed" && r.finalSaleValue);
    const total = sold.reduce((s, r) => s + (r.finalSaleValue ?? 0), 0);
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const thisMonth = sold
      .filter((r) => r.paymentAt && r.paymentAt >= startOfMonth.getTime())
      .reduce((s, r) => s + (r.finalSaleValue ?? 0), 0);
    const pending = rows.filter((r) =>
      ["created", "sent", "accepted", "handed_over"].includes(r.status),
    ).length;
    return {
      totalEarnings: total,
      thisMonth,
      lotsSold: sold.length,
      avgLotValue: sold.length ? Math.round(total / sold.length) : 0,
      pendingLots: pending,
      transactionCount: rows.length,
    };
  },
});

export const monthlyEarnings = query({
  args: { collectorId: v.id("profiles") },
  handler: async (ctx, { collectorId }) => {
    const rows = await ctx.db
      .query("lots")
      .withIndex("by_collector", (q) => q.eq("collectorId", collectorId))
      .collect();
    const byMonth = new Map<string, number>();
    for (const r of rows) {
      if (r.paymentStatus !== "completed" || !r.paymentAt) continue;
      const d = new Date(r.paymentAt);
      const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
      byMonth.set(key, (byMonth.get(key) ?? 0) + (r.finalSaleValue ?? 0));
    }
    return [...byMonth.entries()].sort().map(([month, amount]) => ({ month, amount }));
  },
});

// ---- Recycler portal stats --------------------------------------------------

export const recyclerStats = query({
  args: { recyclerId: v.id("recyclers") },
  handler: async (ctx, { recyclerId }) => {
    const mine = await ctx.db
      .query("lots")
      .withIndex("by_recycler", (q) => q.eq("recyclerId", recyclerId))
      .collect();
    const incoming = await ctx.db
      .query("lots")
      .withIndex("by_status", (q) => q.eq("status", "sent"))
      .collect();
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const todayValue = mine
      .filter((r) => r.updatedAt >= startOfDay.getTime())
      .reduce((s, r) => s + (r.finalSaleValue ?? 0), 0);
    return {
      newLots: incoming.length,
      active: mine.filter((r) => ["accepted", "handed_over"].includes(r.status)).length,
      completed: mine.filter((r) => r.status === "completed").length,
      todayValue,
    };
  },
});
