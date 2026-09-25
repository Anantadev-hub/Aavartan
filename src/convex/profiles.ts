import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";

// ---------------------------------------------------------------------------
// Profiles — role selection lives here, clearly separate from auth. The demo
// onboarding creates a profile with clearly-marked demo data (mock phone).
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
  },
  handler: async (ctx, { role, name }): Promise<Doc<"profiles">> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first");

    const existing = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (existing) return existing;

    let recyclerId: Id<"recyclers"> | undefined;
    if (role === "recycler") {
      // Demo recycler account is bound to the first seeded facility (GreenCycle).
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
      phone: role === "collector" ? "+91 98••• ••210 (demo)" : "+91 98100 12345 (demo)",
      recyclerId,
      createdAt: Date.now(),
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
