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

// UI-facing lot statuses (existing frontend contract — preserved).
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

// Spec §10/29 transaction statuses (uppercase spec vocabulary, mirrored from
// the lot lifecycle; stored alongside each transaction record).
export const TRANSACTION_STATUSES = [
  "CREATED",
  "ACCEPTED",
  "HANDOVER_PENDING",
  "HANDED_OVER",
  "PAYMENT_PENDING",
  "COMPLETED",
  "CANCELLED",
] as const;
export const transactionStatusValidator = v.union(
  ...TRANSACTION_STATUSES.map((s) => v.literal(s)),
);
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

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

// Spec §5 material categories (stored alongside materials for spec conformance).
export const MATERIAL_CATEGORIES = [
  "Display",
  "Electronic Component",
  "Wire",
  "Battery",
  "Motor",
  "Plastic",
] as const;

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
    // §14/15: role, phone, preferred_language, collection_area.
    profiles: defineTable({
      userId: v.id("users"),
      role: v.union(v.literal("collector"), v.literal("recycler"), v.literal("admin")),
      name: v.string(),
      phone: v.optional(v.string()), // demo placeholder
      preferredLanguage: v.optional(v.union(v.literal("en"), v.literal("hi"), v.literal("mr"))),
      collectionArea: v.optional(v.string()),
      recyclerId: v.optional(v.id("recyclers")), // for recycler-role users
      createdAt: v.number(),
      updatedAt: v.optional(v.number()),
    }).index("by_user", ["userId"]),

    // Material catalogue (§5) with live indicative rates.
    materials: defineTable({
      code: v.string(), // pcb | lcd | crt | cable | battery | motor | plastic
      name: v.string(),
      nameHi: v.string(),
      nameMr: v.string(),
      category: v.optional(v.string()), // Display / Electronic Component / Wire / Battery / Motor / Plastic
      description: v.string(),
      unit: v.string(), // "kg"
      currentPrice: v.number(), // ₹ per unit
      prevPrice: v.number(),
      updatedAt: v.number(),
      sort: v.number(),
    }).index("by_code", ["code"]),

    // Daily price history powering the trends charts (§7; seeded demo series,
    // clearly labelled as illustrative — never presented as live market data).
    priceHistory: defineTable({
      materialCode: v.string(),
      day: v.string(), // YYYY-MM-DD
      price: v.number(),
      source: v.optional(v.string()), // "demo" marker
    })
      .index("by_material", ["materialCode"])
      .index("by_material_day", ["materialCode", "day"]),

    // Authorized recycler facilities (§8). Distances are static demo coordinates —
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
      authorizationStatus: v.string(), // authorized (demo) | pending | rejected
      distanceKm: v.number(), // static demo distance from collector area
      timingNote: v.string(),
      sort: v.number(),
    }).index("by_name", ["name"]),

    // §9 recycler ↔ material acceptance relationship (mirrors the array above
    // for spec-conformant relational queries).
    recyclerMaterials: defineTable({
      recyclerId: v.id("recyclers"),
      materialCode: v.string(),
    })
      .index("by_recycler", ["recyclerId"])
      .index("by_material", ["materialCode"]),

    // A collected e-waste lot (§6). Full transactional record incl. quote,
    // handover and payment fields. referenceId format KC-2026-XXXXXX.
    lots: defineTable({
      referenceId: v.string(), // KC-2026-000001
      collectorId: v.id("profiles"),
      recyclerId: v.optional(v.id("recyclers")),
      materialCode: v.string(),
      weight: v.number(),
      condition: conditionValidator,
      pieces: v.optional(v.number()),
      notes: v.optional(v.string()),
      source: v.optional(v.string()),
      photoDataUrl: v.optional(v.string()), // demo: inline jpeg; prod: object storage
      aiMaterialCode: v.optional(v.string()), // final material after user confirmation
      aiDetectedClass: v.optional(v.string()), // raw model class (e.g. PCB)
      aiConfidence: v.optional(v.number()), // 0..1 fraction
      aiSource: v.optional(v.union(v.literal("roboflow"), v.literal("demo"))),
      estimatedValue: v.number(),
      quotedPrice: v.optional(v.number()), // ₹/kg quoted by recycler
      quotedAt: v.optional(v.number()),
      finalSaleValue: v.optional(v.number()),
      locationLabel: v.string(),
      lat: v.optional(v.number()), // static demo coords
      lng: v.optional(v.number()),
      status: lotStatusValidator,
      rejectionReason: v.optional(v.string()),
      handoverRef: v.optional(v.string()), // HANDOVER-KC-XXXXXX
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

    // §10 transactions — one per accepted/quoted lot, mirroring the spec dataset.
    transactions: defineTable({
      lotId: v.id("lots"),
      referenceId: v.string(), // denormalized for display
      recyclerId: v.id("recyclers"),
      collectorId: v.id("profiles"),
      materialCode: v.string(),
      weight: v.number(),
      quotedPrice: v.number(), // ₹/kg (server-computed final, never trusted from client)
      finalPrice: v.number(), // quotedPrice × weight, set at quote acceptance
      paymentStatus: v.union(v.literal("PENDING"), v.literal("PAID")),
      paymentMethod: v.optional(v.union(v.literal("CASH"), v.literal("DIGITAL"))),
      transactionStatus: transactionStatusValidator,
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_lot", ["lotId"])
      .index("by_recycler", ["recyclerId"])
      .index("by_collector", ["collectorId"])
      .index("by_status", ["transactionStatus"]),

    // §11 handover records — one per completed two-sided handover.
    handoverRecords: defineTable({
      transactionId: v.id("transactions"),
      lotId: v.id("lots"),
      verificationReference: v.string(), // HANDOVER-KC-XXXXXX
      photoDataUrl: v.optional(v.string()),
      weightVerified: v.number(),
      latitude: v.optional(v.number()),
      longitude: v.optional(v.number()),
      verificationHash: v.optional(v.string()), // demo checksum (not blockchain)
      handoverTime: v.number(),
    })
      .index("by_transaction", ["transactionId"])
      .index("by_lot", ["lotId"]),

    // §12 earnings ledger — row written when a transaction becomes PAID/COMPLETED.
    earnings: defineTable({
      userId: v.id("profiles"),
      transactionId: v.id("transactions"),
      lotId: v.id("lots"),
      amount: v.number(),
      createdAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_transaction", ["transactionId"]),

    // §13 sync queue (server mirror of the device queue) — audit + idempotency.
    syncQueue: defineTable({
      userId: v.id("profiles"),
      operationType: v.string(), // e.g. "create_lot"
      entityType: v.string(), // e.g. "lot"
      entityId: v.optional(v.string()),
      clientRef: v.string(),
      payload: v.string(), // JSON
      syncStatus: v.union(v.literal("pending"), v.literal("synced"), v.literal("failed")),
      createdAt: v.number(),
      syncedAt: v.optional(v.number()),
    })
      .index("by_client_ref", ["clientRef"])
      .index("by_user", ["userId"])
      .index("by_status", ["syncStatus"]),

    // Rules-based anomaly flags attached to lots (§34; "Review recommended",
    // never an accusation, never a trained ML claim).
    anomalyFlags: defineTable({
      lotId: v.id("lots"),
      type: v.string(),
      message: v.string(),
      severity: v.union(v.literal("low"), v.literal("medium"), v.literal("high"), v.literal("review")),
      reviewed: v.boolean(),
      createdAt: v.number(),
    }).index("by_lot", ["lotId"]),

    // §35 demo collection-density data for the recycler heatmap (fictional).
    collectionAreas: defineTable({
      area: v.string(),
      city: v.string(),
      lots: v.number(),
      weightKg: v.number(),
      lat: v.number(),
      lng: v.number(),
      intensity: v.number(), // 0..1 relative density for rendering
    }).index("by_area", ["area"]),

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
