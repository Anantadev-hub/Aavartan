import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";

// Phone normalization mirrors the client (lib/auth-service.ts): strip +91 / 91
// / 0 prefixes and all non-digits, validate as an Indian mobile. Identity
// matching MUST compare canonical forms — "+91 98765 43210", "919876543210"
// and "9876543210" are the SAME account.
function normalizePhoneBackend(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let d = raw.replace(/\D/g, "");
  if (d.length > 10 && d.startsWith("91")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : undefined;
}

function normalizeNameBackend(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const n = raw.trim().replace(/\s+/g, " ").toLowerCase();
  return n || undefined;
}

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
    // (new anonymous user id) must rebind to their EXISTING account instead of
    // creating a second profile — otherwise the returning Kabadiwala's session
    // resolves a NEW collectorId and never sees the lots/quotes written
    // against their original one.
    //
    // PRIMARY KEY: canonical phone. The by_phone index stores normalized
    // digits; legacy rows may hold formatted strings ("+91 XXXXX XXXXX"), so
    // fall back to a role-scoped canonical comparison when the index misses.
    const normalizedPhone = normalizePhoneBackend(phone);
    if (normalizedPhone) {
      const byPhone = await ctx.db
        .query("profiles")
        .withIndex("by_phone", (q) => q.eq("phone", normalizedPhone))
        .collect();
      let prior = byPhone.find((p) => p.role === role);
      if (!prior) {
        // Legacy-format phones never match the normalized index — compare
        // canonically across the (small) role cohort. Never fuzzy: exact
        // normalized equality only.
        const cohort = await ctx.db.query("profiles").collect();
        prior = cohort.find(
          (p) => p.role === role && normalizePhoneBackend(p.phone) === normalizedPhone,
        );
      }
      if (prior) {
        await ctx.db.patch(prior._id, {
          userId, // rebind to the current session's user row
          name: name.trim() || prior.name,
          phone: normalizedPhone, // canonicalize legacy formatting
          preferredLanguage: preferredLanguage ?? prior.preferredLanguage,
          collectionArea: collectionArea ?? prior.collectionArea,
          updatedAt: Date.now(),
        });
        return (await ctx.db.get(prior._id))!;
      }
    } else if (name.trim()) {
      // NO phone in the payload (e.g. "Continue offline" path): resolve the
      // existing account by EXACT normalized name + role. Conservative by
      // design — never fuzzy, never cross-role, never used when a phone is
      // available (different people can share a name).
      const wanted = normalizeNameBackend(name);
      const cohort = await ctx.db.query("profiles").collect();
      // Safety: a name-only match may only claim a profile that has NO usable
      // phone of its own. A profile carrying a real phone is identified by
      // that phone — a name collision must never merge two different people.
      const prior = cohort.find(
        (p) =>
          p.role === role &&
          !normalizePhoneBackend(p.phone) &&
          normalizeNameBackend(p.name) === wanted,
      );
      if (prior) {
        await ctx.db.patch(prior._id, {
          userId,
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
  args: { recyclerName: v.optional(v.string()) },
  handler: async (ctx, { recyclerName }): Promise<Doc<"profiles"> | null> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!profile || profile.role !== "recycler" || profile.recyclerId) return profile;
    const target = recyclerName
      ? await ctx.db
          .query("recyclers")
          .withIndex("by_name", (q) => q.eq("name", recyclerName))
          .unique()
      : null;
    const green =
      target ??
      (await ctx.db
        .query("recyclers")
        .withIndex("by_name", (q) => q.eq("name", "GreenCycle Recycling"))
        .unique());
    if (!green) return profile;
    await ctx.db.patch(profile._id, { recyclerId: green._id, updatedAt: Date.now() });
    return ctx.db.get(profile._id);
  },
});
