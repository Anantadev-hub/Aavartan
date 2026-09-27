// ---------------------------------------------------------------------------
// Market-linked dynamic pricing — MarketPriceProvider abstraction.
//
// ARCHITECTURE (external source → backend ingestion → cloud DB → API → UI):
//   1. A MarketPriceProvider retrieves raw quotes from an external source.
//      Providers run ONLY on the backend; the React app never touches the
//      external source (the frontend reads our own database/API).
//   2. ingestMarketPrice() validates + normalizes each quote and stores it in
//      the `marketPrices` table with full provenance (source, recorded_at,
//      fetched_at, is_current). History is never rewritten.
//   3. A daily scheduled job (crons.ts → refreshAllPrices) runs the active
//      provider so prices move without anyone typing them in. The bridge
//      mirrors the accepted record into `dailyPrices`, the valuation table
//      that lots freeze at creation.
//   4. The REST surface (GET /api/prices/current[/material], /history/material,
//      protected POST /api/prices/refresh) exposes the stored records.
//
// HONESTY CONTRACT (no fake "live" claims, §8/§18):
//   - A provider's sourceKind is one of "api" (machine-readable external API),
//     "reference-feed" (controlled backend adapter over a documented source) or
//     "demo" (clearly labelled simulated data).
//   - The UI derives its wording (§8) from sourceKind + update cadence, never
//     from imagination. See pricingTerminology.
//   - API keys arrive via environment variables and are never logged or sent
//     to the client (§12/§45). Failures log a safe reason only.
// ---------------------------------------------------------------------------

import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  action,
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";

// ---- Terminology (§8): derived from the actual source kind ----------------

export type SourceKind = "api" | "reference-feed" | "demo";

/**
 * UI wording driven by the provider's real nature. A daily benchmark is NEVER
 * called "real-time". "api" providers that publish once per day read
 * "Latest Daily Reference Price"; the reference-feed/demo providers read
 * "Latest Available Reference Price" / "Demo Reference Price".
 */
export function pricingTerminology(kind: SourceKind, updateCadence: string): {
  headline: string;
  note: string;
} {
  if (kind === "demo") {
    return {
      headline: "Demo reference price",
      note: "Simulated price for the prototype — not market data. Connect a market-data API to replace it.",
    };
  }
  if (kind === "api" && updateCadence === "daily") {
    return {
      headline: "Latest Daily Reference Price",
      note: "Updated once per day from the market-data API. Not real-time.",
    };
  }
  if (kind === "api") {
    return {
      headline: "Latest Market Price",
      note: "Fetched from the market-data API.",
    };
  }
  return {
    headline: "Latest Available Reference Price",
    note: "From a controlled reference feed over a documented public source — a webpage, not a live API.",
  };
}

// ---- Validation (§12) ------------------------------------------------------

const SUPPORTED_MATERIALS = new Set([
  "pcb", "lcd", "crt", "cable", "battery", "motor", "plastic",
]);

/** Rejection reasons are safe to log — no secrets, no raw payloads. */
export type RawQuote = {
  materialCode: string;
  location?: string;
  grade?: string;
  pricePerKg: number;
  currency?: string;
  unit?: string;
  sourceName: string;
  sourceKind: SourceKind;
  sourceReference?: string;
  recordedAt?: number;
};

export function validateQuote(q: RawQuote): { ok: true; value: RequiredFields } | { ok: false; reason: string } {
  if (!q || typeof q !== "object") return { ok: false, reason: "quote missing" };
  const material = String(q.materialCode ?? "").trim().toLowerCase();
  if (!material || !SUPPORTED_MATERIALS.has(material)) {
    return { ok: false, reason: `malformed material code: ${material || "(empty)"}` };
  }
  const price = Number(q.pricePerKg);
  if (!Number.isFinite(price) || price <= 0 || price > 1_000_000) {
    return { ok: false, reason: `invalid price value for ${material}` };
  }
  if ((q.currency ?? "INR") !== "INR") {
    return { ok: false, reason: `unsupported currency ${q.currency} for ${material}` };
  }
  if ((q.unit ?? "kg") !== "kg") {
    return { ok: false, reason: `unsupported unit ${q.unit} for ${material}` };
  }
  if (!q.sourceName || typeof q.sourceName !== "string") {
    return { ok: false, reason: `missing source name for ${material}` };
  }
  if (q.sourceKind !== "api" && q.sourceKind !== "reference-feed" && q.sourceKind !== "demo") {
    return { ok: false, reason: `invalid sourceKind for ${material}` };
  }
  const recordedAt =
    typeof q.recordedAt === "number" && Number.isFinite(q.recordedAt) && q.recordedAt > 0
      ? q.recordedAt
      : Date.now();
  return {
    ok: true,
    value: {
      materialCode: material,
      location: (q.location ?? "Delhi/NCR").trim(),
      grade: (q.grade ?? "Standard").trim(),
      pricePerKg: Math.round(price * 10) / 10, // normalize to ₹0.1 precision
      currency: "INR",
      unit: "kg",
      sourceName: q.sourceName.trim(),
      sourceKind: q.sourceKind,
      sourceReference: q.sourceReference?.trim(),
      recordedAt,
    },
  };
}

type RequiredFields = {
  materialCode: string;
  location: string;
  grade: string;
  pricePerKg: number;
  currency: "INR";
  unit: "kg";
  sourceName: string;
  sourceKind: SourceKind;
  sourceReference?: string;
  recordedAt: number;
};

function utcDayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/**
 * Bridge an accepted market quote into the dailyPrices valuation table (§9):
 * NEW lots freeze whichever row they are created against, so this upsert is
 * what makes the market feed actually drive lot valuation. Runs on both the
 * fresh-insert and the dedupe path (a manual override of today's row must
 * never outlive a confirmed market re-ingest).
 */
async function bridgeToDailyPrices(
  ctx: MutationCtx,
  q: RequiredFields,
  marketPriceId: string,
  now: number,
): Promise<void> {
  const day = utcDayKey(q.recordedAt);
  const existing = await ctx.db
    .query("dailyPrices")
    .withIndex("by_material_day", (x) => x.eq("materialCode", q.materialCode).eq("day", day))
    .unique();
  if (existing) {
    await ctx.db.patch(existing._id, {
      pricePerKg: q.pricePerKg,
      source: q.sourceName,
      sourceKind: q.sourceKind,
      marketPriceId: marketPriceId as never,
      recordedAt: now,
    });
  } else {
    await ctx.db.insert("dailyPrices", {
      materialCode: q.materialCode,
      day,
      pricePerKg: q.pricePerKg,
      source: q.sourceName,
      sourceKind: q.sourceKind,
      marketPriceId: marketPriceId as never,
      recordedAt: now,
    });
  }
}

/** Shared ingest result (explicit annotation avoids TS circular inference
 *  when handlers runMutation into functions in this same module). */
type IngestResult = { stored: number; rejected: string[]; total: number };
type IngestOneResult =
  | { stored: false; reason: string }
  | { stored: false; deduped: true; marketPriceId: string }
  | { stored: true; marketPriceId: string; day: string; pricePerKg: number };

// ---- Providers -------------------------------------------------------------

export type MarketPriceProvider = {
  /** Stable registry key, e.g. "metals-api" or "demo-reference". */
  name: string;
  /** Human-facing display name for the transparency panel (§17). */
  displayName: string;
  sourceKind: SourceKind;
  /** "daily" | "real-time" | "delayed" — drives the honest §8 wording. */
  updateCadence: "daily" | "real-time" | "delayed";
  /** Where the data comes from — shown for transparency, stored as provenance. */
  sourceReference: string;
  /**
   * Retrieve raw quotes for the supported materials. Runs ONLY in Convex
   * actions (backend). Implementations may call external APIs with env-stored
   * keys; on failure they should return [] or throw — never fabricate prices.
   */
  fetchQuotes: () => Promise<RawQuote[]>;
};

/**
 * Demo Reference Provider — the clearly-labelled fallback used until a live
 * market-data API is connected (§18). Quotes are simulated locally with a
 * small deterministic drift so the daily job visibly moves prices, and every
 * record is stored with sourceKind "demo". Nothing here pretends to be live.
 */
export const demoReferenceProvider: MarketPriceProvider = {
  name: "demo-reference",
  displayName: "Demo Reference Feed (simulated)",
  sourceKind: "demo",
  updateCadence: "daily",
  sourceReference: "internal://demo-reference-feed",
  fetchQuotes: async () => buildDemoQuotes(),
};

/** Synchronous demo quotes (no network) — used by the provider and bootstrap seeding. */
export function buildDemoQuotes(ts: number = Date.now()): RawQuote[] {
  const base: Record<string, number> = {
    pcb: 410, lcd: 95, crt: 42, cable: 320, battery: 138, motor: 105, plastic: 38,
  };
  // Deterministic drift by UTC day so the daily scheduled refresh produces
  // a NEW, inspectable price each day (visible "next daily price" in tests).
  const daySeed = Number(utcDayKey(ts).replace(/-/g, "")) % 9973;
  return Object.entries(base).map(([materialCode, basePrice]) => {
    const drift = 1 + (((daySeed * 2654435761) % 61) - 30) / 1000; // ±3%
    return {
      materialCode,
      location: "Delhi/NCR",
      grade: "Standard",
      pricePerKg: Math.round(basePrice * drift * 10) / 10,
      currency: "INR",
      unit: "kg",
      sourceName: "Demo Reference Feed",
      sourceKind: "demo" as const,
      sourceReference: "internal://demo-reference-feed",
      recordedAt: ts,
    };
  });
}

/**
 * Metals-API provider stub — the recommended production provider (§18).
 * metals-api.com is a legitimate, machine-readable JSON API for base-metal
 * spot prices (copper/lead/aluminium, USD or INR conversion). Activating it
 * requires METALS_API_KEY + METALS_API_URL in the Convex environment and a
 * documented mapping from base-metal spot rates to local scrap grades — which
 * is why the prototype ships with the demo/reference provider and this seam.
 */
export const metalsApiProvider: MarketPriceProvider = {
  name: "metals-api",
  displayName: "Metals-API (base metals spot)",
  sourceKind: "api",
  updateCadence: "daily",
  sourceReference: "https://metals-api.com/documentation",
  fetchQuotes: async () => {
    const key = process.env.METALS_API_KEY;
    if (!key) return []; // not configured → demo/reference provider stays active
    const base = process.env.METALS_API_URL ?? "https://metals-api.com/api";
    const symbols = ["XCU", "XPD", "XAL"]; // copper, lead, aluminium proxies
    const res = await fetch(
      `${base}/latest?access_key=${encodeURIComponent(key)}&base=USD&symbols=INR,${symbols.join(",")}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) {
      console.warn(`[pricing] metals-api request failed with status ${res.status}`);
      return [];
    }
    const data = (await res.json()) as { rates?: Record<string, number> };
    const rates = data.rates ?? {};
    if (!rates.INR || rates.XCU === undefined) return [];
    // NOTE: mapping LME spot to street scrap grades is a pricing-policy task
    // owned by the operator; this scaffold leaves it explicit rather than
    // inventing multipliers. Returning [] keeps the system honest.
    return [];
  },
};

/** Provider registry — the ONLY place a provider is switched. */
export const PRICE_PROVIDERS: Record<string, MarketPriceProvider> = {
  "demo-reference": demoReferenceProvider,
  "metals-api": metalsApiProvider,
};

/** Active provider key; set via env to promote a real API later. */
export function activeProviderKey(): string {
  return process.env.PRICE_PROVIDER_KEY ?? "demo-reference";
}

export function getActiveProvider(): MarketPriceProvider {
  return PRICE_PROVIDERS[activeProviderKey()] ?? demoReferenceProvider;
}

// ---- Ingestion (backend-only writes) ----------------------------------------

/**
 * Validate + store one raw quote as the newest market record, flip is_current,
 * and bridge the accepted quote into the dailyPrices valuation table. Called
 * by the scheduled refresh action; also exposed as an internal mutation so
 * actions can fan out per material.
 */
export const ingestMarketPrice = internalMutation({
  args: {
    quote: v.object({
      materialCode: v.string(),
      location: v.optional(v.string()),
      grade: v.optional(v.string()),
      pricePerKg: v.number(),
      currency: v.optional(v.string()),
      unit: v.optional(v.string()),
      sourceName: v.string(),
      sourceKind: v.union(v.literal("api"), v.literal("reference-feed"), v.literal("demo")),
      sourceReference: v.optional(v.string()),
      recordedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { quote: raw }): Promise<IngestOneResult> => {
    const check = validateQuote(raw);
    if (!check.ok) {
      console.warn(`[pricing] rejected quote — ${check.reason}`);
      return { stored: false as const, reason: check.reason };
    }
    const q = check.value;
    const now = Date.now();
    const day = utcDayKey(q.recordedAt);

    // Preserve history: the previous current row stays (is_current=false),
    // the new row becomes current. Never rewrite or delete old records.
    const previous = await ctx.db
      .query("marketPrices")
      .withIndex("by_material_current", (x) => x.eq("materialCode", q.materialCode).eq("isCurrent", true))
      .collect();
    for (const row of previous) {
      if (row.pricePerKg !== q.pricePerKg || row.day !== day) {
        await ctx.db.patch(row._id, { isCurrent: false });
      } else {
        // Same quote re-fetched: refresh fetchedAt, keep a single current row,
        // and re-bridge the valuation row (a manual override must not stick).
        await ctx.db.patch(row._id, { fetchedAt: now, recordedAt: q.recordedAt });
        await bridgeToDailyPrices(ctx, q, row._id, now);
        return { stored: false as const, deduped: true, marketPriceId: row._id };
      }
    }

    const id = await ctx.db.insert("marketPrices", {
      materialCode: q.materialCode,
      location: q.location,
      grade: q.grade,
      pricePerKg: q.pricePerKg,
      currency: q.currency,
      unit: q.unit,
      sourceName: q.sourceName,
      sourceKind: q.sourceKind,
      sourceReference: q.sourceReference,
      day,
      recordedAt: q.recordedAt,
      fetchedAt: now,
      isCurrent: true,
    });

    // Keep the materials board in sync so every screen (home rate, recycler
    // quote placeholder, earnings simulator, fair meter) follows the market.
    const mat = await ctx.db
      .query("materials")
      .withIndex("by_code", (x) => x.eq("code", q.materialCode))
      .unique();
    if (mat && mat.currentPrice !== q.pricePerKg) {
      await ctx.db.patch(mat._id, {
        prevPrice: mat.currentPrice,
        currentPrice: q.pricePerKg,
        updatedAt: now,
      });
    }

    // Bridge into the valuation table used by lots.createLot (§9). The lot
    // freezes whichever dailyPrices row it was created against, so later
    // market moves never rewrite an existing lot.
    await bridgeToDailyPrices(ctx, q, id, now);
    return { stored: true as const, marketPriceId: id, day, pricePerKg: q.pricePerKg };
  },
});

/**
 * Internal step for the scheduled refresh: run one provider once and ingest
 * every valid quote. Called by api.pricing.refreshFromProvider (an action) so
 * the fetch happens where network access is allowed.
 */
export const ingestProviderQuotes = internalMutation({
  args: { quotes: v.array(v.object({
    materialCode: v.string(),
    location: v.optional(v.string()),
    grade: v.optional(v.string()),
    pricePerKg: v.number(),
    currency: v.optional(v.string()),
    unit: v.optional(v.string()),
    sourceName: v.string(),
    sourceKind: v.union(v.literal("api"), v.literal("reference-feed"), v.literal("demo")),
    sourceReference: v.optional(v.string()),
    recordedAt: v.optional(v.number()),
  })) },
  handler: async (ctx, { quotes }): Promise<IngestResult> => {
    let stored = 0;
    const rejected: string[] = [];
    for (const quote of quotes) {
      const res: IngestOneResult = await ctx.runMutation(internal.pricing.ingestMarketPrice, { quote });
      if (res.stored) stored += 1;
      else if ("reason" in res) rejected.push(res.reason);
    }
    return { stored, rejected, total: quotes.length };
  },
});

/** Update the staleness metadata row after a refresh attempt. */
export const markRefreshCompleted = internalMutation({
  args: {
    providerName: v.string(),
    providerKind: v.union(v.literal("api"), v.literal("reference-feed"), v.literal("demo")),
    providerDisplay: v.string(),
    ok: v.boolean(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { providerName, providerKind, providerDisplay, ok, note }) => {
    const existing = await ctx.db.query("priceFeedStatus").collect();
    const row = existing[0];
    const patch = {
      providerName,
      providerKind,
      providerDisplay,
      lastAttemptAt: Date.now(),
      lastSuccessAt: ok ? Date.now() : row?.lastSuccessAt,
      lastError: ok ? undefined : (note ?? "provider fetch failed"),
    };
    if (row) await ctx.db.patch(row._id, patch);
    else
      await ctx.db.insert("priceFeedStatus", {
        ...patch,
        lastSuccessAt: ok ? Date.now() : undefined,
      });
    return { ok: true };
  },
});

// ---- Scheduled / on-demand refresh ------------------------------------------

/**
 * The ONE refresh entrypoint. Runs as a Convex action (network-capable) so it
 * serves the daily cron, the protected REST endpoint and the in-app refresh
 * button alike. Fetches quotes from the ACTIVE provider (never the client),
 * validates + stores each one with provenance, and updates the feed status.
 */
export const refreshAllPricesAction = action({
  args: {},
  handler: async (ctx): Promise<
    | { ok: true; provider: string; stored: number; rejected: string[]; total: number }
    | { ok: false; provider: string; error: string }
  > => {
    const provider = getActiveProvider();
    try {
      const quotes = await provider.fetchQuotes();
      const res: IngestResult = await ctx.runMutation(internal.pricing.ingestProviderQuotes, { quotes });
      await ctx.runMutation(internal.pricing.markRefreshCompleted, {
        providerName: provider.name,
        providerKind: provider.sourceKind,
        providerDisplay: provider.displayName,
        ok: true,
      });
      return { ok: true as const, provider: provider.name, ...res };
    } catch (e) {
      // Never leak secrets/keys into logs or responses (§12/§45).
      const reason = e instanceof Error ? e.message : "unknown error";
      console.warn(`[pricing] refresh failed — ${reason}`);
      await ctx.runMutation(internal.pricing.markRefreshCompleted, {
        providerName: provider.name,
        providerKind: provider.sourceKind,
        providerDisplay: provider.displayName,
        ok: false,
        note: reason,
      });
      return { ok: false as const, provider: provider.name, error: reason };
    }
  },
});

// ---- Read models (backend records ONLY — the UI invents no values) ----------

/**
 * Current market price per material with its previous record for the
 * "today's change" row, joined with the materials catalogue and the honest
 * §8 terminology derived from the provider's real kind/cadence.
 */
export const currentMarketPrices = query({
  args: {},
  handler: async (ctx) => {
    const [rows, materials, status] = await Promise.all([
      ctx.db.query("marketPrices").collect(),
      ctx.db.query("materials").collect(),
      ctx.db.query("priceFeedStatus").first(),
    ]);
    const matByCode = new Map(materials.map((m) => [m.code, m]));
    const byMaterial = new Map<string, typeof rows>();
    for (const r of rows) {
      const list = byMaterial.get(r.materialCode) ?? [];
      list.push(r);
      byMaterial.set(r.materialCode, list);
    }
    const out = [];
    for (const [code, list] of byMaterial) {
      list.sort((a, b) => b.recordedAt - a.recordedAt);
      const cur = list.find((r) => r.isCurrent) ?? list[0];
      const prev = list.filter((r) => r._id !== cur._id).sort((a, b) => b.recordedAt - a.recordedAt)[0];
      const mat = matByCode.get(code);
      const term = pricingTerminology(cur.sourceKind, "daily");
      const change = prev ? Math.round((cur.pricePerKg - prev.pricePerKg) * 10) / 10 : null;
      out.push({
        materialCode: code,
        materialId: mat?._id ?? null,
        name: mat?.name ?? code.toUpperCase(),
        unit: mat?.unit ?? "kg",
        pricePerKg: cur.pricePerKg,
        currency: cur.currency,
        location: cur.location,
        grade: cur.grade,
        day: cur.day,
        recordedAt: cur.recordedAt,
        fetchedAt: cur.fetchedAt,
        sourceName: cur.sourceName,
        sourceKind: cur.sourceKind,
        sourceReference: cur.sourceReference ?? null,
        prevPricePerKg: prev?.pricePerKg ?? null,
        changePerKg: change,
        changePct: change !== null && prev && prev.pricePerKg > 0
          ? Math.round((change / prev.pricePerKg) * 1000) / 10
          : null,
        terminology: term,
      });
    }
    out.sort((a, b) =>
      (matByCode.get(a.materialCode)?.sort ?? 99) - (matByCode.get(b.materialCode)?.sort ?? 99),
    );
    return {
      prices: out,
      provider: status
        ? {
            name: status.providerName,
            displayName: status.providerDisplay,
            sourceKind: status.providerKind,
            lastAttemptAt: status.lastAttemptAt,
            lastSuccessAt: status.lastSuccessAt ?? null,
            lastError: status.lastError ?? null,
          }
        : null,
    };
  },
});

/** One material's current market record (REST /api/prices/current/{material}). */
export const currentMarketPrice = query({
  args: { materialCode: v.string() },
  handler: async (ctx, { materialCode }) => {
    const rows = await ctx.db
      .query("marketPrices")
      .withIndex("by_material", (x) => x.eq("materialCode", materialCode))
      .collect();
    if (rows.length === 0) return null;
    rows.sort((a, b) => b.recordedAt - a.recordedAt);
    const cur = rows.find((r) => r.isCurrent) ?? rows[0];
    return cur;
  },
});

/**
 * Stored history for one material (§15) — ascending by day, sliced to the
 * requested window. The chart renders exactly these records; nothing is
 * generated on the frontend.
 */
export const marketPriceHistory = query({
  args: {
    materialCode: v.string(),
    days: v.union(v.literal(7), v.literal(30), v.literal(90)),
  },
  handler: async (ctx, { materialCode, days }) => {
    const rows = await ctx.db
      .query("marketPrices")
      .withIndex("by_material", (x) => x.eq("materialCode", materialCode))
      .collect();
    rows.sort((a, b) => (a.day < b.day ? -1 : 1));
    return rows.slice(Math.max(0, rows.length - days)).map((r) => ({
      day: r.day,
      pricePerKg: r.pricePerKg,
      sourceName: r.sourceName,
      sourceKind: r.sourceKind,
      recordedAt: r.recordedAt,
    }));
  },
});

/**
 * §16 fair-price reference range from STORED market history (no fabrication).
 * Neutral wording only — descriptive, never an accusation.
 */
export const fairPriceRange = query({
  args: { materialCode: v.string() },
  handler: async (ctx, { materialCode }) => {
    const rows = await ctx.db
      .query("marketPrices")
      .withIndex("by_material", (x) => x.eq("materialCode", materialCode))
      .collect();
    const recent = rows.map((r) => r.pricePerKg);
    if (recent.length === 0) return null;
    return {
      low: Math.min(...recent),
      high: Math.max(...recent),
      records: recent.length,
      earliestDay: rows.sort((a, b) => (a.day < b.day ? -1 : 1))[0].day,
    };
  },
});

/** Feed status for the transparency panel (never exposes credentials). */
export const getProviderStatus = query({
  args: {},
  handler: async (ctx) => {
    const provider = getActiveProvider();
    const status = await ctx.db.query("priceFeedStatus").first();
    const apiKeyConfigured = Boolean(process.env.METALS_API_KEY);
    return {
      activeProvider: provider.name,
      displayName: provider.displayName,
      sourceKind: provider.sourceKind,
      updateCadence: provider.updateCadence,
      sourceReference: provider.sourceReference,
      liveApiConfigured: apiKeyConfigured, // boolean only — never the key
      lastAttemptAt: status?.lastAttemptAt ?? null,
      lastSuccessAt: status?.lastSuccessAt ?? null,
      lastError: status?.lastError ?? null,
      terminology: pricingTerminology(provider.sourceKind, provider.updateCadence),
    };
  },
});

/**
 * DEMO/TEST seam (§19 Test 7): simulate the NEXT daily price so the dynamic
 * behaviour can be demonstrated without waiting a calendar day. Ingests a
 * demo quote stamped 24h ahead, which becomes the new current record — new
 * lots then value against it while old lots keep their frozen snapshots.
 * A production build removes or admin-gates this helper.
 */
export const simulateNextDailyPrice = mutation({
  args: {},
  handler: async (ctx): Promise<{ ok: true; stored: number; rejected: string[]; total: number }> => {
    // Publish the NEXT daily price NOW: the deterministic drift for tomorrow's
    // day-key (guaranteeing a different value), stamped as a current update —
    // exactly what the scheduled job does when the next quote arrives. Old
    // lots keep their frozen snapshots; NEW lots pick the new price up.
    const quotes = buildDemoQuotes(Date.now() + 86_400_000).map((q) => ({
      ...q,
      recordedAt: Date.now(),
    }));
    const res: IngestResult = await ctx.runMutation(internal.pricing.ingestProviderQuotes, { quotes });
    return { ok: true, ...res };
  },
});

/**
 * Bootstrap: seed the market table on first deployment so the board has real
 * backend records (clearly labelled demo/reference). Called from seed.ts.
 */
export const seedMarketPricesIfEmpty = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ seeded: boolean; stored?: number; total?: number }> => {
    const existing = await ctx.db.query("marketPrices").first();
    if (existing !== null) return { seeded: false };
    const res: IngestResult = await ctx.runMutation(internal.pricing.ingestProviderQuotes, {
      quotes: buildDemoQuotes(),
    });
    await ctx.runMutation(internal.pricing.markRefreshCompleted, {
      providerName: demoReferenceProvider.name,
      providerKind: demoReferenceProvider.sourceKind,
      providerDisplay: demoReferenceProvider.displayName,
      ok: true,
    });
    return { seeded: true, ...res };
  },
});
