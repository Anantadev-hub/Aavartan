import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { type QueryCtx, mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

// ---------------------------------------------------------------------------
// Facility management — the signed-in recycler reads and edits THEIR OWN
// facility record. This is the SAME `recyclers` row every other subsystem
// already reads (discovery matching, pooling recycler options, lot quoting),
// so edits immediately change matching + quoting behaviour. No parallel data
// store is introduced: profile.recyclerId → recyclers._id is the single
// source of truth for facility identity.
// ---------------------------------------------------------------------------

async function requireMyRecycler(ctx: { db: QueryCtx["db"] }): Promise<Doc<"recyclers"> | null> {
  const userId = await getAuthUserId(ctx as never);
  if (userId === null) return null;
  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (!profile || profile.role !== "recycler" || !profile.recyclerId) return null;
  const recycler = await ctx.db.get(profile.recyclerId);
  return recycler ?? null;
}

/** The signed-in recycler's facility (non-throwing: null when not resolvable). */
export const myFacility = query({
  args: {},
  handler: async (ctx) => {
    return await requireMyRecycler(ctx);
  },
});

const facilityPatch = {
  name: v.optional(v.string()),
  address: v.optional(v.string()),
  area: v.optional(v.string()),
  city: v.optional(v.string()),
  contact: v.optional(v.string()),
  serviceArea: v.optional(v.string()),
  timingNote: v.optional(v.string()),
  pickupAvailable: v.optional(v.boolean()),
  pickupRadiusKm: v.optional(v.number()),
  // Materials are edited through the same mutation: the canonical list lives
  // on the recyclers row (all matching reads it); recyclerMaterials mirrors
  // it for consistency.
  materialsAccepted: v.optional(v.array(v.string())),
};

/**
 * Update the signed-in recycler's facility. Role + ownership are enforced
 * server-side: only a signed-in recycler whose profile carries a recyclerId
 * can write, and only to that one row. Throws specific, accurate errors —
 * never a misleading "sign in" for a missing-facility problem.
 */
export const updateMyFacility = mutation({
  args: facilityPatch,
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in required");

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!profile) {
      throw new Error("Profile not found — complete onboarding before editing facility details");
    }
    if (profile.role !== "recycler") {
      throw new Error("Only recycler accounts can edit facility details");
    }
    if (!profile.recyclerId) {
      throw new Error(
        "No facility linked to your account — link a facility before editing its details",
      );
    }

    const recycler = await ctx.db.get(profile.recyclerId);
    if (!recycler) {
      throw new Error("Facility record not found — the binding points to a missing row");
    }

    // Whitelist patch: only provided fields are written.
    const patch: Partial<Doc<"recyclers">> = {};
    if (args.name !== undefined && args.name.trim() !== "") patch.name = args.name.trim();
    if (args.address !== undefined) patch.address = args.address;
    if (args.area !== undefined) patch.area = args.area;
    if (args.city !== undefined) patch.city = args.city;
    if (args.contact !== undefined) patch.contact = args.contact;
    if (args.serviceArea !== undefined) patch.serviceArea = args.serviceArea;
    if (args.timingNote !== undefined) patch.timingNote = args.timingNote;
    if (args.pickupAvailable !== undefined) patch.pickupAvailable = args.pickupAvailable;
    if (args.pickupRadiusKm !== undefined && args.pickupRadiusKm > 0) {
      patch.pickupRadiusKm = Math.round(args.pickupRadiusKm);
    }
    if (args.materialsAccepted !== undefined) {
      const cleaned = [...new Set(args.materialsAccepted.map((m) => m.trim()).filter(Boolean))];
      patch.materialsAccepted = cleaned;
    }

    if (Object.keys(patch).length === 0) return { ok: true, updated: 0 };

    await ctx.db.patch(recycler._id, patch);

    // Mirror the accepted-materials change into recyclerMaterials so the
    // mirror table stays consistent with the canonical row.
    if (patch.materialsAccepted) {
      const existing = await ctx.db
        .query("recyclerMaterials")
        .withIndex("by_recycler", (q) => q.eq("recyclerId", recycler._id))
        .collect();
      const current = new Set(existing.map((m) => m.materialCode));
      for (const m of existing) {
        if (!patch.materialsAccepted.includes(m.materialCode)) {
          await ctx.db.delete(m._id);
        }
      }
      for (const code of patch.materialsAccepted) {
        if (!current.has(code)) {
          await ctx.db.insert("recyclerMaterials", { recyclerId: recycler._id, materialCode: code });
        }
      }
    }

    return { ok: true, updated: Object.keys(patch).length };
  },
});
