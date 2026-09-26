import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation } from "./_generated/server";

// ---------------------------------------------------------------------------
// POST /sync — accepts queued offline actions from the collector device (§36).
// Each draft lot is applied with its original client capture timestamp so
// nothing is lost or double-counted when connectivity returns. Idempotent per
// device-generated clientRef. Every accepted operation is also persisted to the
// syncQueue table (§13) as a server-side audit trail with sync_status.
// ---------------------------------------------------------------------------

const OfflineDraft = v.object({
  clientRef: v.string(), // device-side UUID, used for idempotency
  materialCode: v.string(),
  weight: v.number(),
  condition: v.union(v.literal("good"), v.literal("mixed"), v.literal("damaged")),
  pieces: v.optional(v.number()),
  notes: v.optional(v.string()),
  source: v.optional(v.string()),
  photoDataUrl: v.optional(v.string()),
  aiMaterialCode: v.optional(v.string()),
  aiDetectedClass: v.optional(v.string()),
  aiConfidence: v.optional(v.number()), // 0..1 fraction
  aiSource: v.optional(v.union(v.literal("roboflow"), v.literal("demo"))),
  locationLabel: v.string(),
  capturedAt: v.number(),
  estimatedValue: v.number(),
});
export type OfflineDraft = import("convex/values").Infer<typeof OfflineDraft>;

// Internal: create a lot from a synced offline draft (idempotent per clientRef).
export const applyDraft = internalMutation({
  args: { collectorId: v.id("profiles"), draft: OfflineDraft },
  handler: async (ctx, { collectorId, draft }) => {
    // Idempotency first: a syncQueue row with this clientRef means already done.
    const prior = await ctx.db
      .query("syncQueue")
      .withIndex("by_client_ref", (q) => q.eq("clientRef", draft.clientRef))
      .collect();
    if (prior.length > 0) {
      return { deduped: true as const, referenceId: null as string | null };
    }

    const existing = await ctx.db
      .query("lots")
      .withIndex("by_collector", (q) => q.eq("collectorId", collectorId))
      .collect();
    if (existing.some((l) => (l.notes ?? "").includes(`clientRef:${draft.clientRef}`))) {
      // Legacy dedupe (pre-syncQueue rows); record the row for future runs.
      await recordQueueRow(ctx, collectorId, draft, "synced");
      return { deduped: true as const, referenceId: null as string | null };
    }

    const m = await ctx.db
      .query("materials")
      .withIndex("by_code", (q) => q.eq("code", draft.materialCode))
      .unique();
    if (!m) throw new Error("Unknown material");

    let maxNum = 0;
    for (const l of existing) {
      const num = Number(l.referenceId.split("-").pop());
      if (Number.isFinite(num) && num > maxNum) maxNum = num;
    }
    const referenceId = `KC-2026-${String(maxNum + 1).padStart(4, "0")}`;

    const lotId = await ctx.db.insert("lots", {
      referenceId,
      collectorId,
      materialCode: draft.materialCode,
      weight: draft.weight,
      condition: draft.condition,
      pieces: draft.pieces,
      notes: draft.notes
        ? `${draft.notes} [clientRef:${draft.clientRef}]`
        : `clientRef:${draft.clientRef}`,
      source: draft.source,
      photoDataUrl: draft.photoDataUrl,
      aiMaterialCode: draft.aiMaterialCode,
      aiDetectedClass: draft.aiDetectedClass,
      // Normalize to the 0-100 integer UI contract (tolerate 0-1 fractions).
      aiConfidence:
        draft.aiConfidence !== undefined
          ? draft.aiConfidence > 1
            ? Math.round(draft.aiConfidence)
            : Math.round(draft.aiConfidence * 100)
          : undefined,
      aiSource: draft.aiSource,
      estimatedValue: draft.estimatedValue,
      locationLabel: draft.locationLabel,
      status: "created",
      paymentStatus: "none",
      syncOrigin: "offline",
      createdAt: draft.capturedAt,
      updatedAt: Date.now(),
    });
    await recordQueueRow(ctx, collectorId, draft, "synced");
    return { deduped: false as const, referenceId, lotId };
  },
});

// Persist the §13 sync queue row (audit trail + idempotency guard).
async function recordQueueRow(
  ctx: { db: import("./_generated/server").MutationCtx["db"] },
  userId: import("./_generated/dataModel").Id<"profiles">,
  draft: { clientRef: string; materialCode: string },
  status: "pending" | "synced" | "failed",
) {
  await ctx.db.insert("syncQueue", {
    userId,
    operationType: "create_lot",
    entityType: "lot",
    clientRef: draft.clientRef,
    payload: JSON.stringify({ materialCode: draft.materialCode }),
    syncStatus: status,
    createdAt: Date.now(),
    syncedAt: status === "synced" ? Date.now() : undefined,
  });
}

// Public entrypoint used by the client sync worker.
export const syncQueue = mutation({
  args: { collectorId: v.id("profiles"), drafts: v.array(OfflineDraft) },
  handler: async (ctx, { collectorId, drafts }) => {
    let synced = 0;
    let deduped = 0;
    for (const draft of drafts) {
      const result = await ctx.runMutation(internal.sync.applyDraft, { collectorId, draft });
      if (result.deduped) deduped++;
      else synced++;
    }
    return { synced, deduped };
  },
});
