import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// ---------------------------------------------------------------------------
// §5 Persistent image records. Every uploaded/captured e-waste photo gets a
// globally unique ID (IMG-KC-2026-000001 style) that is written to the
// database at upload time — never only held in frontend memory. The compressed
// JPEG rides inline as the demo storage payload; swapping `storageUrl` to a
// real object-storage reference (Supabase/S3) needs no other changes.
// ---------------------------------------------------------------------------

function nextImageRef(existing: string[]): string {
  let max = 0;
  for (const ref of existing) {
    const num = Number(ref.split("-").pop());
    if (Number.isFinite(num) && num > max) max = num;
  }
  return `IMG-KC-2026-${String(max + 1).padStart(6, "0")}`;
}

/**
 * Persist an image at upload time and return its unique reference.
 * Called by the Add Flow BEFORE the lot is created; the returned imageRef is
 * then attached to the lot (the record's lotId is linked right after).
 */
export const registerImage = mutation({
  args: {
    uploaderId: v.id("profiles"),
    photoDataUrl: v.optional(v.string()),
    aiDetectedClass: v.optional(v.string()),
    aiConfidence: v.optional(v.number()), // 0-100 integer
    aiSource: v.optional(v.union(v.literal("roboflow"), v.literal("demo"))),
  },
  handler: async (ctx, { uploaderId, photoDataUrl, aiDetectedClass, aiConfidence, aiSource }) => {
    const rows = await ctx.db.query("images").collect();
    const imageRef = nextImageRef(rows.map((r) => r.imageRef));
    const id = await ctx.db.insert("images", {
      imageRef,
      uploaderId,
      storageUrl: photoDataUrl, // demo storage: inline data URL
      photoDataUrl,
      aiDetectedClass,
      aiConfidence:
        aiConfidence !== undefined
          ? aiConfidence > 1
            ? Math.round(aiConfidence)
            : Math.round(aiConfidence * 100)
          : undefined,
      aiSource,
      uploadTimestamp: Date.now(),
    });
    return { imageId: id, imageRef };
  },
});

/** Link an image record to its lot once the lot exists. */
export const attachImageToLot = mutation({
  args: { imageId: v.id("images"), lotId: v.id("lots") },
  handler: async (ctx, { imageId, lotId }) => {
    await ctx.db.patch(imageId, { lotId });
    return { ok: true as const };
  },
});

/** Full image record (recycler + collector passport views). */
export const getImage = query({
  args: { imageId: v.id("images") },
  handler: async (ctx, { imageId }) => ctx.db.get(imageId),
});

/** Resolve by unique reference string. */
export const getByRef = query({
  args: { imageRef: v.string() },
  handler: async (ctx, { imageRef }) => {
    return await ctx.db
      .query("images")
      .withIndex("by_ref", (q) => q.eq("imageRef", imageRef))
      .unique();
  },
});

