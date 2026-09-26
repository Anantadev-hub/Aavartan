import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";

// ---------------------------------------------------------------------------
// Profiles — role selection lives here, clearly separate from auth. The demo
// onboarding creates a profile with clearly-marked demo data (mock phone).
// Spec §14/15/16 fields: phone, preferred_language, collection_area; recycler
// onboarding also records facility material preferences + pickup availability.
// ---------------------------------------------------------------------------

export const myProfile = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    return await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
  },
});

// Demo onboarding: creates (or returns) the profile for the signed-in user.
// Phone numbers are demo placeholders — real OTP auth is out of prototype scope.
export const createProfile = mutation({
  args: {
    role: v.union(v.literal("collector"), v.literal("recycler")),
    name: v.string(),
    phone: v.optional(v.string()),
    preferredLanguage: v.optional(v.union(v.literal("en"), v.literal("hi"), v.literal("mr"))),
    collectionArea: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { role, name, phone, preferredLanguage, collectionArea },
  ): Promise<Doc<"profiles">> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first");

    const existing = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (existing) {
      // Cloud-persistent onboarding (§4): refresh/re-login must refresh the
      // entered details onto the SAME account, never create a duplicate.
      await ctx.db.patch(existing._id, {
        name: name.trim() || existing.name,
        phone: phone && phone.trim() !== "" ? phone : existing.phone,
        preferredLanguage: preferredLanguage ?? existing.preferredLanguage,
        collectionArea: collectionArea ?? existing.collectionArea,
        updatedAt: Date.now(),
      });
      return (await ctx.db.get(existing._id))!;
    }

    // §2 account dedupe: a returning user logging in from a fresh session
    // (new anonymous user id) must rebind to their EXISTING account by phone
    // instead of creating a second profile.
    const normalizedPhone = phone && /^[6-9]\d{9}$/.test(phone.trim()) ? phone.trim() : undefined;
    if (normalizedPhone) {
      const byPhone = await ctx.db
        .query("profiles")
        .withIndex("by_phone", (q) => q.eq("phone", normalizedPhone))
        .collect();
      const prior = byPhone.find((p) => p.role === role);
      if (prior) {
        await ctx.db.patch(prior._id, {
          userId, // rebind to the current session's user row
          name: name.trim() || prior.name,
          preferredLanguage: preferredLanguage ?? prior.preferredLanguage,
          collectionArea: collectionArea ?? prior.collectionArea,
          updatedAt: Date.now(),
        });
        return (await ctx.db.get(prior._id))!;
      }
    }

    let recyclerId: Id<"recyclers"> | undefined;
    if (role === "recycler") {
      // Demo recycler account is bound to the first seeded facility (GreenCycle).
      // Self-heals: profiles created before the facility existed get bound here.
      const green = await ctx.db
        .query("recyclers")
        .withIndex("by_name", (q) => q.eq("name", "GreenCycle Recycling"))
        .unique();
      if (green) recyclerId = green._id;
    }

    const profileId = await ctx.db.insert("profiles", {
      userId,
      role,
      name: name.trim() || (role === "collector" ? "Rahul Kumar" : "GreenCycle Recycling"),
      phone:
        phone && phone.trim() !== ""
          ? phone
          : role === "collector"
            ? "+91 98••• ••210 (demo)"
            : "+91 98100 12345 (demo)",
      preferredLanguage,
      collectionArea,
      recyclerId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const profile = await ctx.db.get(profileId);
    if (!profile) throw new Error("Profile creation failed");
    return profile;
  },
});

export const updateProfileName = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first");
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!profile) throw new Error("No profile");
    await ctx.db.patch(profile._id, { name: name.trim() || profile.name });
    return { ok: true };
  },
});

/**
 * Self-heal a recycler profile whose facility binding is missing (e.g. the
 * profile was created before the demo facility was seeded). Binds the first
 * seeded facility and returns the updated profile — never creates duplicates.
 */
export const ensureRecyclerBinding = mutation({
  args: {},
  handler: async (ctx): Promise<Doc<"profiles"> | null> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!profile || profile.role !== "recycler" || profile.recyclerId) return profile;
    const green = await ctx.db
      .query("recyclers")
      .withIndex("by_name", (q) => q.eq("name", "GreenCycle Recycling"))
      .unique();
    if (!green) return profile;
    await ctx.db.patch(profile._id, { recyclerId: green._id, updatedAt: Date.now() });
    return ctx.db.get(profile._id);
  },
});
