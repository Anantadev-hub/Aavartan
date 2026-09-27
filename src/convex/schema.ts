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

// Price source model (Part 1 §1). Four kinds, never mixed in presentation:
//   demo               — clearly labelled simulated data (no live claim)
//   recycler_quote     — a real authorized recycler's buying price
//   commodity_reference— external benchmark/API price (future provider)
//   reference_feed     — controlled backend adapter over a documented source
export const PRICE_SOURCE_KINDS = [
  "demo",
  "recycler_quote",
  "commodity_reference",
  "reference_feed",
] as const;
export const priceSourceKindValidator = v.union(
  ...PRICE_SOURCE_KINDS.map((k) => v.literal(k)),
);

export const RECYCLER_QUOTE_STATUSES = [
  "ACTIVE", "PAUSED", "EXPIRED", "WITHDRAWN",
] as const;
export const recyclerQuoteStatusValidator = v.union(
  ...RECYCLER_QUOTE_STATUSES.map((s) => v.literal(s)),
);

export const POOL_STATUSES = [
  "OPEN", "FILLING", "TARGET_REACHED", "MATCHED_TO_RECYCLER",
  "PICKUP_SCHEDULED", "COMPLETED", "CANCELLED", "EXPIRED",
] as const;
export const poolStatusValidator = v.union(
  ...POOL_STATUSES.map((s) => v.literal(s)),
);

export const POOL_CONTRIBUTION_STATUSES = [
  "PENDING", "CONFIRMED", "WITHDRAWN", "DELIVERED",
] as const;
export const poolContributionStatusValidator = v.union(
  ...POOL_CONTRIBUTION_STATUSES.map((s) => v.literal(s)),
);

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
  "SENT_TO_RECYCLER",
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
      phone: v.optional(v.string()), // normalized 10-digit when from onboarding
      preferredLanguage: v.optional(v.union(v.literal("en"), v.literal("hi"), v.literal("mr"))),
      collectionArea: v.optional(v.string()),
      recyclerId: v.optional(v.id("recyclers")), // for recycler-role users
      createdAt: v.number(),
      updatedAt: v.optional(v.number()),
    })
      .index("by_user", ["userId"])
      .index("by_phone", ["phone"]),

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
    // Price snapshot: valuation is frozen at creation — later market moves
    // NEVER rewrite a historical lot (see lots.createLot + dailyPrices).
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
      imageId: v.optional(v.id("images")), // §5 unique image record
      photoDataUrl: v.optional(v.string()), // demo: inline jpeg; prod: object storage
      aiMaterialCode: v.optional(v.string()), // final material after user confirmation
      aiDetectedClass: v.optional(v.string()), // raw model class (e.g. PCB)
      aiConfidence: v.optional(v.number()), // 0-100 integer (UI contract)
      aiSource: v.optional(v.union(v.literal("roboflow"), v.literal("demo"))),
      estimatedValue: v.number(), // frozen: weight × price_at_creation
      pricePerKgAtCreation: v.optional(v.number()), // §9 exact rate used
      priceRecordId: v.optional(v.id("dailyPrices")), // §9 which price row
      priceTimestamp: v.optional(v.number()), // §9 when that rate was recorded
      priceSource: v.optional(v.string()), // §9 provenance: provider name
      priceSourceName: v.optional(v.string()), // §6: display name of the source
      priceSourceKind: v.optional(
        v.union(
          v.literal("api"),
          v.literal("reference-feed"),
          v.literal("demo"),
          v.literal("manual"),
          v.literal("board-default"),
          v.literal("recycler_quote"),
          v.literal("commodity_reference"),
        ),
      ),
      pricingMethod: v.optional(
        v.union(
          v.literal("recycler_quote_median"),
          v.literal("demo_fallback"),
          v.literal("board_default"),
        ),
      ),
      recyclerQuoteCount: v.optional(v.number()), // §6: quotes behind the frozen price
      marketPriceId: v.optional(v.id("marketPrices")), // upstream market record
      quotedPrice: v.optional(v.number()), // ₹/kg quoted by recycler
      quotedAt: v.optional(v.number()),
      finalSaleValue: v.optional(v.number()),
      locationLabel: v.string(),
      lat: v.optional(v.number()), // static demo coords
      lng: v.optional(v.number()),
      status: lotStatusValidator,
      sentAt: v.optional(v.number()), // when the lot was actually dispatched to a recycler
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

    // §5 persistent image records — every capture gets a globally unique ID
    // (IMG-KC-2026-XXXXXX) stored in the database, never only in memory.
    // photoDataUrl keeps the compressed JPEG inline (demo object storage);
    // a production build swaps the string for a storage URL/reference.
    images: defineTable({
      imageRef: v.string(), // IMG-KC-2026-000001
      uploaderId: v.id("profiles"),
      lotId: v.optional(v.id("lots")), // set when attached to a lot
      storageUrl: v.optional(v.string()), // object-storage reference (demo: data URL)
      photoDataUrl: v.optional(v.string()),
      aiDetectedClass: v.optional(v.string()),
      aiConfidence: v.optional(v.number()), // 0-100 integer
      aiSource: v.optional(v.union(v.literal("roboflow"), v.literal("demo"))),
      uploadTimestamp: v.number(),
    })
      .index("by_ref", ["imageRef"])
      .index("by_lot", ["lotId"])
      .index("by_uploader", ["uploaderId"]),

    // §8 daily price snapshots — the valuation source of truth. Each row is
    // the recorded rate for a material on a day; lots freeze whichever row
    // they were created against (§9). Rows are written by the market-price
    // ingestion pipeline (bridge of the current market quote) or, explicitly
    // labelled, by manual/demo overrides — never presented as live market data.
    dailyPrices: defineTable({
      materialCode: v.string(),
      day: v.string(), // YYYY-MM-DD (IST-independent UTC day key)
      pricePerKg: v.number(),
      source: v.string(), // provider name / "demo" / "manual"
      sourceKind: v.optional(
        v.union(
          v.literal("api"),
          v.literal("reference-feed"),
          v.literal("demo"),
          v.literal("manual"),
        ),
      ),
      marketPriceId: v.optional(v.id("marketPrices")), // upstream market record
      recordedAt: v.number(),
    })      .index("by_material_day", ["materialCode", "day"])
      .index("by_material", ["materialCode"]),

    // Market-linked price records (dynamic pricing §1–§6). Written ONLY by the
    // backend ingestion pipeline from a MarketPriceProvider — the React app
    // never touches an external source. Each row keeps the full provenance:
    // material, location, grade, price, currency, unit, source and both the
    // provider's recorded_at and our fetched_at timestamps. History is
    // preserved; the newest valid record per material is is_current.
    marketPrices: defineTable({
      materialCode: v.string(),
      location: v.string(), // e.g. "Delhi/NCR"
      grade: v.string(), // e.g. "Standard" (provider-supplied when available)
      pricePerKg: v.number(),
      currency: v.literal("INR"),
      unit: v.literal("kg"),
      sourceName: v.string(), // e.g. "Demo Reference Feed" / "metals-api"
      sourceKind: v.union(v.literal("api"), v.literal("reference-feed"), v.literal("demo")),
      sourceReference: v.optional(v.string()), // URL / document reference
      day: v.string(), // YYYY-MM-DD the quote applies to
      recordedAt: v.number(), // provider's recorded timestamp (ms)
      fetchedAt: v.number(), // when OUR backend fetched it (ms)
      isCurrent: v.boolean(), // newest valid record for the material
    })
      .index("by_material", ["materialCode"])
      .index("by_material_day", ["materialCode", "day"])
      .index("by_material_current", ["materialCode", "isCurrent"]),

    // One-row staleness status for the price feed (§11/§12): which provider is
    // active, when it last ran, and the last safe error (never credentials).
    priceFeedStatus: defineTable({
      providerName: v.string(),
      providerKind: v.union(v.literal("api"), v.literal("reference-feed"), v.literal("demo")),
      providerDisplay: v.string(),
      lastAttemptAt: v.number(),
      lastSuccessAt: v.optional(v.number()),
      lastError: v.optional(v.string()),
    }),

    // ---- Part 1: Recycler-quote price discovery ---------------------------

    // Buying quotes submitted by authorized recyclers for materials they
    // accept. Only ACTIVE quotes within their validity window participate in
    // price discovery. A recycler may quote ONLY materials in materialsAccepted.
    recyclerQuotes: defineTable({
      recyclerId: v.id("recyclers"),
      materialCode: v.string(),
      pricePerKg: v.number(),
      grade: v.string(), // "Standard" unless the recycler grades differently
      minimumQuantityKg: v.number(),
      maximumQuantityKg: v.optional(v.number()),
      pickupAvailable: v.boolean(),
      serviceArea: v.string(),
      quoteStatus: recyclerQuoteStatusValidator,
      validFrom: v.number(),
      validUntil: v.number(),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_material", ["materialCode"])
      .index("by_recycler", ["recyclerId"])
      .index("by_material_status", ["materialCode", "quoteStatus"]),

    // Discovery snapshots — the computed market reference per material+day
    // (median of valid recycler quotes; labelled fallback when none). Written
    // only by the backend discovery engine / scheduled job.
    priceSnapshots: defineTable({
      materialCode: v.string(),
      day: v.string(), // YYYY-MM-DD (UTC)
      pricePerKg: v.number(),
      pricingMethod: v.union(
        v.literal("recycler_quote_median"),
        v.literal("demo_fallback"),
      ),
      low: v.optional(v.number()),
      high: v.optional(v.number()),
      median: v.optional(v.number()),
      recyclerQuoteCount: v.number(),
      sourceKind: priceSourceKindValidator,
      sourceName: v.string(),
      sourceReference: v.optional(v.string()),
      location: v.string(),
      recordedAt: v.number(),
      fetchedAt: v.number(),
    })
      .index("by_material_day", ["materialCode", "day"])
      .index("by_material", ["materialCode"]),

    // ---- Part 2: Smart Scrap Pooling ---------------------------------------

    // Coarse, privacy-preserving collector location (§8). Stores an exact
    // coordinate ONLY inside the backend as a matching input — every read
    // model returns masked data (area label + approximate distance, never the
    // raw lat/lng or geohash of another collector).
    collectorLocations: defineTable({
      collectorId: v.id("profiles"),
      approximateLatitude: v.number(),
      approximateLongitude: v.number(),
      geohash: v.string(), // coarse bucket (precision 5 ≈ 4.9km × 4.9km)
      cell: v.string(), // precision-4 key (≈ 39km × 19.5km) for indexed nearby search
      geohashPrecision: v.number(),
      locality: v.string(),
      pincode: v.optional(v.string()),
      locationUpdatedAt: v.number(),
      poolingOptIn: v.boolean(),
    })
      .index("by_collector", ["collectorId"])
      .index("by_geohash", ["geohash"])
      .index("by_cell", ["cell"])
      .index("by_optin", ["poolingOptIn"]),

    // A collector's declared intent to pool surplus material (§9). Distinct
    // from the pool itself; contributes to the nearby matching pool.
    poolingRequests: defineTable({
      collectorId: v.id("profiles"),
      materialCode: v.string(),
      quantityKg: v.number(),
      grade: v.string(),
      preferredRecyclerId: v.optional(v.id("recyclers")),
      targetQuantityKg: v.number(),
      pickupWindow: v.string(),
      status: v.union(v.literal("OPEN"), v.literal("MATCHED"), v.literal("CLOSED")),
      createdAt: v.number(),
      expiresAt: v.number(),
    })
      .index("by_collector", ["collectorId"])
      .index("by_material", ["materialCode"])
      .index("by_status", ["status"]),

    // The Pool entity (§11): aggregated compatible scrap before transport.
    pools: defineTable({
      poolRef: v.string(), // POOL-KC-XXXXXX
      creatorCollectorId: v.id("profiles"),
      materialCode: v.string(),
      grade: v.string(),
      targetQuantityKg: v.number(),
      currentQuantityKg: v.number(),
      status: poolStatusValidator,
      preferredRecyclerId: v.optional(v.id("recyclers")),
      matchedRecyclerId: v.optional(v.id("recyclers")),
      pickupWindow: v.string(),
      approximateArea: v.string(),
      transportCostEstimate: v.optional(v.number()), // ₹, user/recycler-editable
      geohash: v.string(),
      cell: v.string(), // precision-4 key for indexed nearby search (§21)
      createdAt: v.number(),
      updatedAt: v.number(),
      expiresAt: v.number(),
      completedAt: v.optional(v.number()),
    })
      .index("by_ref", ["poolRef"])
      .index("by_creator", ["creatorCollectorId"])
       .index("by_material", ["materialCode"])
      .index("by_status", ["status"])
      .index("by_geohash", ["geohash"])
      .index("by_cell", ["cell"])
      .index("by_recycler", ["preferredRecyclerId"]),

    // §12 per-collector contributions — traceable ownership, one lot per
    // contribution; the original lot keeps its own lifecycle and earnings.
    poolContributions: defineTable({
      poolId: v.id("pools"),
      collectorId: v.id("profiles"),
      lotId: v.id("lots"),
      quantityKg: v.number(),
      contributionStatus: poolContributionStatusValidator,
      joinedAt: v.number(),
    })
      .index("by_pool", ["poolId"])
      .index("by_collector", ["collectorId"])
      .index("by_lot", ["lotId"]),
    // In-app pooling notifications (§18). First-party only — no SMS/email.
    poolNotifications: defineTable({
      collectorId: v.id("profiles"),
      poolId: v.optional(v.id("pools")),
      type: v.string(), // pool_invitation | member_joined | target_reached | recycler_matched | pickup_scheduled | pool_completed
      title: v.string(),
      body: v.string(),
      readAt: v.optional(v.number()),
      createdAt: v.number(),
    }).index("by_collector", ["collectorId"]),

    // §14 estimated transportation economics (calculations, never guarantees).
    transportEstimates: defineTable({
      poolId: v.optional(v.id("pools")),
      pooledQuantityKg: v.number(),
      transportCost: v.number(),
      participants: v.number(),
      costPerKgPooled: v.number(),
      individualCostPerKg: v.optional(v.number()),
      note: v.string(),
      createdAt: v.number(),
    }).index("by_pool", ["poolId"]),

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
