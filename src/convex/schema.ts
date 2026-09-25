import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

// ---- Kabadiwala Connect domain --------------------------------------------

export const LOT_STATUSES = [
  "draft", // saved offline, not yet synced
  "created",
  "sent", // sent to recycler
  "accepted", // recycler quoted + accepted
  "rejected",
  "handed_over", // both sides confirmed handover
  "completed", // payment done
] as const;
export const lotStatusValidator = v.union(
  ...LOT_STATUSES.map((s) => v.literal(s)),
);
export type LotStatus = (typeof LOT_STATUSES)[number];

export const CONDITIONS = ["good", "mixed", "damaged"] as const;
export const conditionValidator = v.union(
  ...CONDITIONS.map((c) => v.literal(c)),
);
export type Condition = (typeof CONDITIONS)[number];

export const PAYMENT_METHODS = ["cash", "upi"] as const;
export const paymentMethodValidator = v.union(
  ...PAYMENT_METHODS.map((m) => v.literal(m)),
);

export const paymentStatusValidator = v.union(
  v.literal("none"),
  v.literal("pending"),
  v.literal("completed"),
);

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user. do not remove
    }).index("email", ["email"]), // index for the email. do not remove or modify

    // ---- domain tables -----------------------------------------------------

    // App profile linked to the auth user. Demo onboarding creates this with
    // clearly-marked demo defaults (no real phone/OTP auth in the prototype).
    profiles: defineTable({
      userId: v.id("users"),
      role: v.union(v.literal("collector"), v.literal("recycler")),
      name: v.string(),
      phone: v.optional(v.string()), // demo placeholder
      recyclerId: v.optional(v.id("recyclers")), // for recycler-role users
      createdAt: v.number(),
    }).index("by_user", ["userId"]),

    // Material catalogue with live indicative rates.
    materials: defineTable({
      code: v.string(), // pcb | lcd | crt | cable | battery | motor | plastic
      name: v.string(),
      nameHi: v.string(),
      nameMr: v.string(),
      description: v.string(),
      unit: v.string(), // "kg"
      currentPrice: v.number(), // ₹ per unit
      prevPrice: v.number(),
      updatedAt: v.number(),
      sort: v.number(),
    }).index("by_code", ["code"]),

    // Daily price history powering the trends charts (seeded demo series).
    priceHistory: defineTable({
      materialCode: v.string(),
      day: v.string(), // YYYY-MM-DD
      price: v.number(),
    })
      .index("by_material", ["materialCode"])
      .index("by_material_day", ["materialCode", "day"]),

    // Authorized recycler facilities. Distances are static demo coordinates —
    // labelled as such in the UI, no real GPS.
    recyclers: defineTable({
      name: v.string(),
      address: v.string(),
      area: v.string(),
      city: v.string(),
      lat: v.number(),
      lng: v.number(),
      contact: v.string(), // demo contact
      materialsAccepted: v.array(v.string()),
      rates: v.record(v.string(), v.number()), // materialCode -> ₹/kg
      rating: v.number(),
      pickupAvailable: v.boolean(),
      pickupRadiusKm: v.number(),
      serviceArea: v.string(),
      verified: v.boolean(),
      authorizationStatus: v.string(), // "authorized" (demo)
      distanceKm: v.number(), // static demo distance from collector area
      timingNote: v.string(),
      sort: v.number(),
    }).index("by_name", ["name"]),

    // A collected e-waste lot. Full transactional record incl. quote, handover
    // and payment fields per the SIH transaction dataset spec.
    lots: defineTable({
      referenceId: v.string(), // KC-2026-XXXX
      collectorId: v.id("profiles"),
      recyclerId: v.optional(v.id("recyclers")),
      materialCode: v.string(),
      weight: v.number(),
      condition: conditionValidator,
      pieces: v.optional(v.number()),
      notes: v.optional(v.string()),
      source: v.optional(v.string()),
      photoDataUrl: v.optional(v.string()), // demo: inline jpeg; prod: object storage
      aiMaterialCode: v.optional(v.string()),
      aiConfidence: v.optional(v.number()),
      estimatedValue: v.number(),
      quotedPrice: v.optional(v.number()), // ₹/kg quoted by recycler
      quotedAt: v.optional(v.number()),
      finalSaleValue: v.optional(v.number()),
      locationLabel: v.string(),
      lat: v.optional(v.number()), // static demo coords
      lng: v.optional(v.number()),
      status: lotStatusValidator,
      rejectionReason: v.optional(v.string()),
      handoverRef: v.optional(v.string()),
      handoverHash: v.optional(v.string()), // demo tamper-evidence checksum
      handoverAt: v.optional(v.number()),
      handoverConfirmedByCollector: v.optional(v.boolean()),
      handoverConfirmedByRecycler: v.optional(v.boolean()),
      paymentMethod: v.optional(paymentMethodValidator),
      paymentStatus: paymentStatusValidator,
      paymentAt: v.optional(v.number()),
      syncOrigin: v.union(v.literal("online"), v.literal("offline")),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_reference", ["referenceId"])
      .index("by_collector", ["collectorId"])
      .index("by_recycler", ["recyclerId"])
      .index("by_status", ["status"]),

    // Rules-based anomaly flags attached to lots ("Review recommended").
    anomalyFlags: defineTable({
      lotId: v.id("lots"),
      type: v.string(),
      message: v.string(),
      severity: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
      reviewed: v.boolean(),
      createdAt: v.number(),
    }).index("by_lot", ["lotId"]),

    // Safety guidance per material (English + Hindi + Marathi).
    safetyGuides: defineTable({
      materialCode: v.string(),
      title: v.string(),
      titleHi: v.string(),
      titleMr: v.string(),
      tips: v.array(v.string()),
      tipsHi: v.array(v.string()),
      tipsMr: v.array(v.string()),
    }).index("by_material", ["materialCode"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
