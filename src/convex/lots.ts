import { v } from "convex/values";
import { type Doc, type Id } from "./_generated/dataModel";
import { type MutationCtx, type QueryCtx, mutation, query } from "./_generated/server";
import { conditionValidator, lotStatusValidator, paymentMethodValidator } from "./schema";

// ---------------------------------------------------------------------------
// Lots — full transactional lifecycle (POST /lots, GET /lots, quote, handover,
// payment, earnings). The tracking timeline is derived from the lot record.
// ---------------------------------------------------------------------------

const pad2 = (n: number) => n.toString().padStart(2, "0");
const pad4 = (n: number) => n.toString().padStart(4, "0");

/** UTC YYYY-MM-DD day key — matches dailyPrices.day and week keys. */
function utcDayKey(ts = Date.now()): string {
  return new Date(ts).toISOString().slice(0, 10);
}

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

// Verification reference (spec §30): HANDOVER-KC-8F42A1 style.
function nextHandoverRef(): string {
  const hex = Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .padStart(6, "0")
    .toUpperCase();
  return `HANDOVER-KC-${hex}`;
}

// Create (or fetch) the spec transaction row for a quoted/accepted lot (§28).
async function ensureTransaction(
  ctx: MutationCtx,
  lot: Doc<"lots">,
  recyclerId: Id<"recyclers">,
  quotedPrice: number,
): Promise<Id<"transactions">> {
  const existing = await ctx.db
    .query("transactions")
    .withIndex("by_lot", (q) => q.eq("lotId", lot._id))
    .collect();
  if (existing.length > 0) return existing[0]._id;
  const now = Date.now();
  return ctx.db.insert("transactions", {
    lotId: lot._id,
    referenceId: lot.referenceId,
    recyclerId,
    collectorId: lot.collectorId,
    materialCode: lot.materialCode,
    weight: lot.weight,
    quotedPrice,
    finalPrice: Math.round(quotedPrice * lot.weight),
    paymentStatus: "PENDING",
    transactionStatus: "ACCEPTED",
    createdAt: now,
    updatedAt: now,
  });
}

// Patch the transaction row for a lot through the status machine (§29).
async function patchTransaction(
  ctx: MutationCtx,
  lotId: Id<"lots">,
  patch: Partial<{
    paymentStatus: "PENDING" | "PAID";
    paymentMethod: "CASH" | "DIGITAL";
    transactionStatus:
      | "CREATED"
      | "ACCEPTED"
      | "HANDOVER_PENDING"
      | "HANDED_OVER"
      | "PAYMENT_PENDING"
      | "COMPLETED"
      | "CANCELLED";
  }>,
) {
  const txs = await ctx.db
    .query("transactions")
    .withIndex("by_lot", (q) => q.eq("lotId", lotId))
    .collect();
  for (const tx of txs) {
    await ctx.db.patch(tx._id, { ...patch, updatedAt: Date.now() });
  }
  return txs[0]?._id ?? null;
}

const CONDITION_MULTIPLIER: Record<string, number> = { good: 1, mixed: 0.9, damaged: 0.7 };

// Rules-based anomaly detection (§34). Returns review signals — never blocks,
// never accuses. Severity is always "review" per the spec's vocabulary.
function detectAnomalies(lot: {
  materialCode: string;
  weight: number;
  estimatedValue: number;
  condition: string;
  quotedPrice?: number;
  finalSaleValue?: number;
}): Array<{ type: string; message: string; severity: "review" }> {
  const flags: Array<{ type: string; message: string; severity: "review" }> = [];
  if (!Number.isFinite(lot.weight) || lot.weight <= 0) {
    flags.push({ type: "invalid_weight", message: "Weight is zero or invalid — review recommended", severity: "review" });
  }
  if (lot.weight > 500) {
    flags.push({ type: "unusual_weight", message: "Unusual weight for a single collection — review recommended", severity: "review" });
  }
  if (lot.quotedPrice && lot.estimatedValue > 0 && lot.weight > 0) {
    const estRate = lot.estimatedValue / lot.weight;
    if (lot.quotedPrice > estRate * 2.5) {
      flags.push({ type: "extreme_price", message: "Quoted price far above indicative market rate — review recommended", severity: "review" });
    }
    if (lot.condition === "damaged" && lot.quotedPrice > estRate * 1.2) {
      flags.push({ type: "condition_price_mismatch", message: "Damaged condition priced above estimate — review recommended", severity: "review" });
    }
  }
  if (lot.finalSaleValue && lot.estimatedValue > 0 && lot.finalSaleValue > lot.estimatedValue * 2) {
    flags.push({ type: "extreme_price", message: "Final value far above the AI estimate — review recommended", severity: "review" });
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
    // §8: the live estimate preview uses the LATEST applicable daily snapshot
    // (falling back to the material's board rate before the first snapshot).
    const snap = await latestRate(ctx, materialCode);
    const rate = (snap?.pricePerKg ?? m.currentPrice) * (CONDITION_MULTIPLIER[condition] ?? 1);
    return {
      ratePerKg: Math.round(rate),
      estimatedValue: Math.round(weight * rate),
      priceDay: snap?.day ?? null,
      priceSource: snap?.source ?? `Board default — ${m.name} (demo)`,
      priceSourceKind: snap?.sourceKind ?? "board-default",
    };
  },
});

/** Latest applicable daily snapshot for a material (today first, else most recent). */
async function latestRate(
  ctx: { db: QueryCtx["db"] | MutationCtx["db"] },
  materialCode: string,
): Promise<{
  _id: import("./_generated/dataModel").Id<"dailyPrices">;
  day: string;
  pricePerKg: number;
  source: string;
  sourceKind: "api" | "reference-feed" | "demo" | "manual" | undefined;
  marketPriceId: import("./_generated/dataModel").Id<"marketPrices"> | undefined;
  recordedAt: number;
} | null> {
  const rows = await ctx.db
    .query("dailyPrices")
    .withIndex("by_material", (q) => q.eq("materialCode", materialCode))
    .collect();
  if (rows.length === 0) return null;
  // A price dated in the future must never value a lot created today
  // (defensive: the demo "simulate next daily price" seam stays inert).
  const today = utcDayKey();
  const applicable = rows.filter((r) => r.day <= today);
  if (applicable.length === 0) return null;
  applicable.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : b.recordedAt - a.recordedAt));
  const s = applicable[0];
  return {
    _id: s._id,
    day: s.day,
    pricePerKg: s.pricePerKg,
    source: s.source,
    sourceKind: s.sourceKind,
    marketPriceId: s.marketPriceId,
    recordedAt: s.recordedAt,
  };
}

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
    imageId: v.optional(v.id("images")), // §5 persisted image record
    aiMaterialCode: v.optional(v.string()),
    aiDetectedClass: v.optional(v.string()),
    aiConfidence: v.optional(v.number()), // stored as 0-100 integer (UI contract)
    aiSource: v.optional(v.union(v.literal("roboflow"), v.literal("demo"))),
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
    // ---- §8/§9 price snapshot -------------------------------------------
    // NEW lots always value against the LATEST applicable daily snapshot
    // (today's row, else most recent earlier day). The exact row is frozen
    // onto the lot — later market moves never rewrite this valuation (§9).
    const snap = await latestRate(ctx, args.materialCode);
    const baseRate = snap?.pricePerKg ?? m.currentPrice;
    const rate = baseRate * (CONDITION_MULTIPLIER[args.condition] ?? 1);
    const estimatedValue = Math.round(args.weight * rate);
    const referenceId = await nextReferenceId(ctx);
    // §9 provenance: the exact source of the frozen price, from the market
    // provider when the snapshot was market-linked (never claimed live beyond
    // its real source kind), else the pre-market board default.
    const priceSource =
      snap?.source ?? `Board default — ${m.name} (demo)`;
    const priceSourceKind = snap?.sourceKind ?? ("board-default" as const);
    // Normalize AI confidence to the UI contract (0-100 integer) regardless of
    // what the client sent (§45: never trust client-provided AI values).
    const aiConfidenceNormalized =
      args.aiConfidence !== undefined
        ? args.aiConfidence > 1
          ? Math.round(args.aiConfidence)
          : Math.round(args.aiConfidence * 100)
        : undefined;
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
      imageId: args.imageId,
      photoDataUrl: args.photoDataUrl,
      aiMaterialCode: args.aiMaterialCode,
      aiDetectedClass: args.aiDetectedClass,
      aiConfidence: aiConfidenceNormalized,
      aiSource: args.aiSource,
      estimatedValue,
      pricePerKgAtCreation: Math.round(baseRate * 10) / 10,
      priceRecordId: snap?._id,
      priceTimestamp: snap?.recordedAt,
      priceSource,
      priceSourceKind,
      marketPriceId: snap?.marketPriceId,
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
    return { lotId, referenceId, estimatedValue, pricePerKg: Math.round(rate), priceDay: snap?.day ?? null, priceSource, priceSourceKind };
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
    await ensureTransaction(ctx, lot, recyclerId, quotedPrice);
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

// ---- Handover: two-sided confirmation, then a digital record (§30) --------
// The record is called a "Digital Handover Record" — explicitly not blockchain.

export const confirmHandover = mutation({
  args: {
    lotId: v.id("lots"),
    by: v.union(v.literal("collector"), v.literal("recycler")),
    photoDataUrl: v.optional(v.string()),
    weightVerified: v.optional(v.number()),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
  },
  handler: async (ctx, { lotId, by, photoDataUrl, weightVerified, latitude, longitude }) => {
    const lot = await ctx.db.get(lotId);
    if (!lot) throw new Error("Lot not found");
    if (lot.status !== "accepted") throw new Error("Handover only after acceptance");
    const now = Date.now();
    const collectorConfirmed =
      by === "collector" ? true : (lot.handoverConfirmedByCollector ?? false);
    const recyclerConfirmed =
      by === "recycler" ? true : (lot.handoverConfirmedByRecycler ?? false);
    const both = collectorConfirmed && recyclerConfirmed;
    const handoverRef = lot.handoverRef ?? nextHandoverRef();
    const handoverHash =
      lot.handoverHash ??
      demoHash(
        `${lot.referenceId}|${weightVerified ?? lot.weight}|${collectorConfirmed}|${recyclerConfirmed}|${now}`,
      );
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

    const transactionId = await patchTransaction(ctx, lotId, {
      transactionStatus: both ? "HANDED_OVER" : "HANDOVER_PENDING",
    });

    // First confirmation generates the record shell; the second (completing)
    // confirmation writes the verified-weight/photo row (§11).
    if (transactionId && both) {
      const existing = await ctx.db
        .query("handoverRecords")
        .withIndex("by_lot", (q) => q.eq("lotId", lotId))
        .collect();
      if (existing.length === 0) {
        await ctx.db.insert("handoverRecords", {
          transactionId,
          lotId,
          verificationReference: handoverRef,
          photoDataUrl: photoDataUrl ?? lot.photoDataUrl,
          weightVerified: weightVerified ?? lot.weight,
          latitude,
          longitude,
          verificationHash: handoverHash,
          handoverTime: now,
        });
      }
    }

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

    // Transaction mirrors payment (§31), then the collector's earnings ledger
    // row is written exactly once (§12).
    const txId = await patchTransaction(ctx, lotId, {
      paymentStatus: "PAID",
      paymentMethod: method === "upi" ? "DIGITAL" : "CASH",
      transactionStatus: "COMPLETED",
    });
    if (txId && lot.finalSaleValue) {
      const existing = await ctx.db
        .query("earnings")
        .withIndex("by_transaction", (q) => q.eq("transactionId", txId))
        .collect();
      if (existing.length === 0) {
        await ctx.db.insert("earnings", {
          userId: lot.collectorId,
          transactionId: txId,
          lotId,
          amount: lot.finalSaleValue,
          createdAt: now,
        });
      }
    }
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
    filtered.sort((a, b) => b.createdAt - a.createdAt);
    // Attach the collector display name for the recycler portal (§9/§10):
    // transactions must show who sold, not the signed-in recycler's own name.
    const nameById = new Map<string, string | null>();
    for (const id of new Set(filtered.map((r) => r.collectorId))) {
      const p = await ctx.db.get(id);
      nameById.set(id, p?.name ?? null);
    }
    return filtered.map((r) => ({
      ...r,
      collectorName: nameById.get(r.collectorId) ?? null,
    }));
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

// ---- §11/§12 Weekly net earnings report -------------------------------------
// COMPLETED + PAID lots only. The app tracks no expenses, so net = gross
// completed sales (stated honestly — nothing invented). Includes the previous
// week for the comparison row and a per-day series for the trend bars.
export const weeklyReport = query({
  args: { collectorId: v.id("profiles") },
  handler: async (ctx, { collectorId }) => {
    const rows = await ctx.db
      .query("lots")
      .withIndex("by_collector", (q) => q.eq("collectorId", collectorId))
      .collect();

    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setUTCHours(0, 0, 0, 0);
    const DAY = 86_400_000;
    const startOfThisWeek = startOfToday.getTime() - 6 * DAY;
    const startOfPrevWeek = startOfThisWeek - 7 * DAY;

    const inRange = (r: Doc<"lots">, from: number, to: number) =>
      r.paymentStatus === "completed" &&
      r.finalSaleValue != null &&
      r.paymentAt != null &&
      r.paymentAt >= from &&
      r.paymentAt < to;

    const current = rows.filter((r) => inRange(r, startOfThisWeek, startOfToday.getTime() + DAY));
    const previous = rows.filter((r) => inRange(r, startOfPrevWeek, startOfThisWeek));

    const sum = (rs: Doc<"lots">[]) => rs.reduce((s, r) => s + (r.finalSaleValue ?? 0), 0);
    const kg = (rs: Doc<"lots">[]) => Math.round(rs.reduce((s, r) => s + r.weight, 0) * 10) / 10;

    const gross = sum(current);
    const prevGross = sum(previous);

    // Per-day series for the trend visualization (this week, Mon–Sun style).
    const daily = [] as Array<{ day: string; amount: number }>;
    for (let i = 0; i < 7; i++) {
      const from = startOfThisWeek + i * DAY;
      const to = from + DAY;
      const dayRows = current.filter((r) => inRange(r, from, to));
      daily.push({ day: utcDayKey(from).slice(5), amount: sum(dayRows) });
    }

    return {
      weekStart: startOfThisWeek,
      weekEnd: startOfToday.getTime() + DAY,
      gross: gross, // net = gross: no expenses are tracked (§11 — not invented)
      net: gross,
      completedSales: current.length,
      materialSoldKg: kg(current),
      avgSale: current.length ? Math.round(gross / current.length) : 0,
      prevGross,
      prevCompletedSales: previous.length,
      change: gross - prevGross,
      changePct:
        prevGross > 0 ? Math.round(((gross - prevGross) / prevGross) * 1000) / 10 : null,
      daily,
      note: "Net = gross completed sales — no expenses are tracked in this prototype.",
    };
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

// Recycler purchases summary (§16): the BUY side of the ledger. Never shown
// as "earnings" — collectors earn, recyclers purchase.
export const purchasesSummary = query({
  args: { recyclerId: v.id("recyclers") },
  handler: async (ctx, { recyclerId }) => {
    const mine = await ctx.db
      .query("lots")
      .withIndex("by_recycler", (q) => q.eq("recyclerId", recyclerId))
      .collect();
    const purchased = mine.filter((r) => r.status === "completed" && r.finalSaleValue);

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const totalPaid = purchased.reduce((s, r) => s + (r.finalSaleValue ?? 0), 0);
    const totalKg = Math.round(purchased.reduce((s, r) => s + r.weight, 0) * 10) / 10;
    const monthRows = purchased.filter((r) => (r.paymentAt ?? 0) >= startOfMonth.getTime());

    const byMaterial = new Map<string, { weightKg: number; amount: number }>();
    for (const r of purchased) {
      const cur = byMaterial.get(r.materialCode) ?? { weightKg: 0, amount: 0 };
      byMaterial.set(r.materialCode, {
        weightKg: Math.round((cur.weightKg + r.weight) * 10) / 10,
        amount: cur.amount + (r.finalSaleValue ?? 0),
      });
    }

    return {
      totalPaid,
      totalKg,
      monthPaid: monthRows.reduce((s, r) => s + (r.finalSaleValue ?? 0), 0),
      monthCount: monthRows.length,
      purchaseCount: purchased.length,
      byMaterial: [...byMaterial.entries()]
        .map(([code, v]) => ({ code, ...v }))
        .sort((a, b) => b.amount - a.amount),
    };
  },
});
