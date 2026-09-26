import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
import { CONFIDENCE_THRESHOLD } from "./roboflow";

// ---------------------------------------------------------------------------
// REST API surface (spec §3, §43, §46). The React app talks to Convex
// reactively; this router additionally exposes the spec's /api/* REST
// endpoints for integrations and future clients. Same server-side rules:
// secrets stay in env, prices/statuses/authorization are never trusted from
// the client, and errors never expose stack traces or keys (§43, §45).
//
// Demo auth (§14): POST /api/auth/login → verify-otp with the demo OTP 123456
// issues a demo session token. No real SMS is sent; clearly labelled demo auth.
// ---------------------------------------------------------------------------

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const bad = (message: string, status: number) => json({ success: false, error: message }, status);

const DEMO_OTP = "123456";
type DemoSession = { phone: string; name: string; role: string; ts: number };
const sessions = new Map<string, DemoSession>();

function sessionFrom(req: Request): DemoSession | null {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return token ? (sessions.get(token) ?? null) : null;
}

const http = httpRouter();

// Route table: registered here and re-mounted by http.ts (routers don't compose).
const restRoutes: Array<{
  path: string;
  method: "GET" | "POST";
  handler: ReturnType<typeof httpAction>;
}> = [];

function route(path: string, method: "GET" | "POST", handler: ReturnType<typeof httpAction>) {
  restRoutes.push({ path, method, handler });
  http.route({ path, method, handler });
}

// ---- Auth (§14) --------------------------------------------------------------

route("/api/auth/login", "POST", httpAction(async (_ctx, req) => {
  const body = (await req.json().catch(() => ({}))) as { phone?: string };
  if (!body.phone || !/^[6-9]\d{9}$/.test(body.phone)) return bad("Invalid mobile number", 400);
  return json({
    success: true,
    demo: true,
    otpRequired: true,
    note: "Demo mode: OTP is 123456 — no SMS is sent.",
  });
}));

route("/api/auth/verify-otp", "POST", httpAction(async (_ctx, req) => {
  const body = (await req.json().catch(() => ({}))) as {
    phone?: string; otp?: string; name?: string; role?: string;
  };
  if (!body.phone || !/^[6-9]\d{9}$/.test(body.phone)) return bad("Invalid mobile number", 400);
  if (body.otp !== DEMO_OTP) return bad("Invalid OTP", 401);
  const token = `kc_demo_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const role = body.role === "recycler" ? "recycler" : "collector";
  sessions.set(token, { phone: body.phone, name: body.name ?? "Demo User", role, ts: Date.now() });
  return json({
    success: true,
    demo: true,
    token,
    user: { phone: body.phone, name: body.name ?? "Demo User", role },
  });
}));

route("/api/auth/me", "GET", httpAction(async (_ctx, req) => {
  const session = sessionFrom(req);
  if (!session) return bad("Authentication required", 401);
  return json({ success: true, user: { phone: session.phone, name: session.name, role: session.role } });
}));

// ---- Materials (§17) ----------------------------------------------------------

route("/api/materials", "GET", httpAction(async (ctx) => {
  const materials = await ctx.runQuery(api.materials.listMaterials, {});
  return json({ success: true, materials });
}));

// ---- Prices (§23, §24) --------------------------------------------------------

route("/api/prices", "GET", httpAction(async (ctx) => {
  const materials = await ctx.runQuery(api.materials.listMaterials, {});
  return json({
    success: true,
    demo: true,
    note: "Demo prices — illustrative only, not live market data.",
    prices: materials.map((m) => ({
      materialCode: m.code,
      materialId: m._id,
      category: m.category ?? null,
      pricePerKg: m.currentPrice,
      previousPrice: m.prevPrice,
    })),
  });
}));

route("/api/prices/trends", "GET", httpAction(async (ctx, req) => {
  const url = new URL(req.url);
  const materialCode = url.searchParams.get("materialCode") ?? "pcb";
  const daysParam = Number(url.searchParams.get("days") ?? 30);
  const days = daysParam === 7 || daysParam === 90 ? daysParam : 30;
  const trends = await ctx.runQuery(api.materials.priceTrends, { materialCode, days });
  return json({ success: true, materialCode, days, demo: true, trends });
}));

route("/api/prices/estimate", "POST", httpAction(async (ctx, req) => {
  const body = (await req.json().catch(() => ({}))) as {
    materialCode?: string; weight?: number; condition?: "good" | "mixed" | "damaged";
  };
  if (!body.materialCode || typeof body.weight !== "number" || body.weight <= 0) {
    return bad("materialCode and positive weight required", 400);
  }
  // weight × price_per_kg from DB records (§23) — never AI-invented.
  const est = await ctx.runQuery(api.lots.estimateValue, {
    materialCode: body.materialCode,
    weight: body.weight,
    condition: body.condition ?? "good",
  });
  if (!est) return bad("Unknown material", 404);
  return json({ success: true, ...est, demo: true });
}));

route("/api/prices/fair-meter", "GET", httpAction(async (ctx, req) => {
  const url = new URL(req.url);
  const materialCode = url.searchParams.get("materialCode");
  const quotedPrice = Number(url.searchParams.get("quotedPrice"));
  if (!materialCode || !Number.isFinite(quotedPrice) || quotedPrice <= 0) {
    return bad("materialCode and positive quotedPrice required", 400);
  }
  const meter = await ctx.runQuery(api.insights.fairPriceMeter, { materialCode, quotedPrice });
  if (!meter) return bad("Unknown material", 404);
  return json({ success: true, ...meter });
}));

// ---- AI (§18, §19, §42) -------------------------------------------------------

route("/api/ai/classify-material", "POST", httpAction(async (ctx, req) => {
  const body = (await req.json().catch(() => ({}))) as { imageDataUrl?: string };
  if (!body.imageDataUrl || !body.imageDataUrl.startsWith("data:image/")) {
    return bad("imageDataUrl (data URL) required", 400);
  }
  try {
    const result = await ctx.runAction(api.ai.classifyMaterial, { imageDataUrl: body.imageDataUrl });
    return json({
      success: true,
      detected_class: result.detectedClass,
      material: result.materialCode,
      material_id: result.materialId,
      confidence: Math.round(result.confidence * 100) / 100,
      supported: result.supported,
      requires_confirmation: result.requiresConfirmation,
      demo_fallback: result.isDemoFallback,
      note: result.demoNote,
    });
  } catch (e) {
    const tooLarge = e instanceof Error && /too large/i.test(e.message);
    return bad(tooLarge ? "Image too large" : "Classification failed", tooLarge ? 400 : 500);
  }
}));

route("/api/ai/status", "GET", httpAction(async () => {
  const configured = Boolean(process.env.ROBOFLOW_API_KEY && process.env.ROBOFLOW_MODEL_ID);
  return json({
    success: true,
    mode: configured ? "roboflow" : "demo",
    model: process.env.ROBOFLOW_MODEL_ID ?? "demo-mock-classifier-v1",
    threshold: CONFIDENCE_THRESHOLD,
  });
}));

// ---- Lots (§21) ----------------------------------------------------------------

route("/api/lots", "POST", httpAction(async (ctx, req) => {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const collectorId = typeof body.collectorId === "string" ? body.collectorId : null;
  const materialCode = typeof body.materialCode === "string" ? body.materialCode : null;
  const weight = typeof body.weight === "number" ? body.weight : null;
  if (!collectorId || !materialCode || !weight || weight <= 0) {
    return bad("collectorId, materialCode and positive weight required", 400);
  }
  try {
    // estimated_value and reference_id are computed server-side (§21, §45).
    const res = await ctx.runMutation(api.lots.createLot, {
      collectorId: collectorId as never,
      materialCode,
      weight,
      condition: "good",
      locationLabel: typeof body.locationLabel === "string" ? body.locationLabel : "Demo location",
      photoDataUrl: typeof body.photoDataUrl === "string" ? body.photoDataUrl : undefined,
      aiMaterialCode: typeof body.aiMaterialCode === "string" ? body.aiMaterialCode : undefined,
      aiConfidence: typeof body.aiConfidence === "number" ? body.aiConfidence : undefined,
      syncOrigin: "online",
      sendNow: body.sendNow === true,
    });
    return json({ success: true, ...res });
  } catch {
    return bad("Could not create lot", 400);
  }
}));

route("/api/lots", "GET", httpAction(async (ctx, req) => {
  const url = new URL(req.url);
  const collectorId = url.searchParams.get("collectorId");
  const lots = await ctx.runQuery(api.lots.listLots, {
    collectorId: (collectorId ?? undefined) as never,
  });
  return json({ success: true, lots });
}));

// ---- Recyclers (§26, §27) --------------------------------------------------------

route("/api/recyclers/match", "POST", httpAction(async (ctx, req) => {
  const body = (await req.json().catch(() => ({}))) as {
    materialCode?: string; weightKg?: number;
  };
  if (!body.materialCode) return bad("materialCode required", 400);
  const results = await ctx.runQuery(api.recyclers.matchRecyclers, {
    materialCode: body.materialCode,
    weightKg: typeof body.weightKg === "number" ? body.weightKg : undefined,
    verifiedOnly: true,
    pickupOnly: false,
    sortBy: "match",
  });
  return json({
    success: true,
    matches: results.map((r) => ({
      recyclerId: r._id,
      name: r.name,
      location: `${r.area}, ${r.city}`,
      authorization: r.authorizationStatus,
      pickupAvailable: r.pickupAvailable,
      acceptedMaterial: r.acceptsMaterial,
      ratePerKg: r.rate,
      matchPercent: r.matchScore,
      matchReasons: r.matchReasons,
      estimatedValue: r.estimatedValue,
    })),
  });
}));

route("/api/recycler/lots", "GET", httpAction(async (ctx) => {
  const lots = await ctx.runQuery(api.lots.listAvailableLots, {});
  return json({ success: true, lots });
}));

// ---- Transactions (§28, §29, §30, §31) ----------------------------------------

route("/api/transactions", "GET", httpAction(async (ctx) => {
  const transactions = await ctx.runQuery(api.insights.transactionsList, {});
  return json({ success: true, transactions });
}));

route("/api/transactions/:id/handover", "POST", httpAction(async (ctx, req) => {
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean); // [api, transactions, :id, handover]
  const lotId = parts[2];
  const body = (await req.json().catch(() => ({}))) as {
    photoDataUrl?: string; weightVerified?: number; latitude?: number; longitude?: number;
  };
  if (!lotId) return bad("transaction id required", 400);
  if (body.weightVerified !== undefined && (typeof body.weightVerified !== "number" || body.weightVerified <= 0)) {
    return bad("weightVerified must be a positive number", 410 + 0);
  }
  try {
    // Server generates the HANDOVER-KC-XXXXXX verification reference (§30).
    const res = await ctx.runMutation(api.lots.confirmHandover, {
      lotId: lotId as never,
      by: "recycler",
      photoDataUrl: typeof body.photoDataUrl === "string" ? body.photoDataUrl : undefined,
      weightVerified: body.weightVerified,
      latitude: body.latitude,
      longitude: body.longitude,
    });
    return json({ success: true, ...res });
  } catch {
    return bad("Handover failed — check lot status", 409);
  }
}));

route("/api/transactions/:id/payment", "POST", httpAction(async (ctx, req) => {
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const lotId = parts[2];
  const body = (await req.json().catch(() => ({}))) as { method?: string };
  if (!lotId) return bad("transaction id required", 400);
  if (body.method !== "cash" && body.method !== "upi") {
    return bad("method must be 'cash' or 'upi' (DIGITAL)", 400);
  }
  try {
    // Payment status is server-decided; earnings ledger row written on PAID (§31/§12).
    const res = await ctx.runMutation(api.lots.markPaymentCompleted, {
      lotId: lotId as never,
      method: body.method,
    });
    return json({ success: true, ...res });
  } catch {
    return bad("Payment failed — lot must be handed over first", 409);
  }
}));

// ---- Earnings (§32, §33) ----------------------------------------------------------

route("/api/earnings/summary", "GET", httpAction(async (ctx, req) => {
  const url = new URL(req.url);
  const collectorId = url.searchParams.get("collectorId");
  if (!collectorId) return bad("collectorId required", 400);
  const summary = await ctx.runQuery(api.lots.earningsSummary, { collectorId: collectorId as never });
  return json({ success: true, summary });
}));

route("/api/earnings/monthly", "GET", httpAction(async (ctx, req) => {
  const url = new URL(req.url);
  const collectorId = url.searchParams.get("collectorId");
  if (!collectorId) return bad("collectorId required", 400);
  const monthly = await ctx.runQuery(api.lots.monthlyEarnings, { collectorId: collectorId as never });
  return json({ success: true, monthly });
}));

route("/api/earnings/simulator", "GET", httpAction(async (ctx, req) => {
  const url = new URL(req.url);
  const weight = Number(url.searchParams.get("weightKg"));
  if (!Number.isFinite(weight) || weight <= 0) return bad("positive weightKg required", 400);
  const sim = await ctx.runQuery(api.insights.earningsSimulator, { totalWeightKg: weight });
  if (!sim) return bad("Could not simulate", 400);
  return json({ success: true, estimate: true, ...sim });
}));

// ---- Analytics (§35, §40) -----------------------------------------------------------

route("/api/analytics/collection-areas", "GET", httpAction(async (ctx) => {
  const res = await ctx.runQuery(api.insights.collectionAreasHeatmap, {});
  return json({ success: true, ...res });
}));

route("/api/admin/summary", "GET", httpAction(async (ctx) => {
  const summary = await ctx.runQuery(api.insights.adminSummary, {});
  return json({ success: true, ...summary });
}));

// ---- Offline sync (§36) --------------------------------------------------------------

route("/api/sync", "POST", httpAction(async (ctx, req) => {
  const body = (await req.json().catch(() => ({}))) as {
    collectorId?: string; drafts?: Array<Record<string, unknown>>;
  };
  if (!body.collectorId || !Array.isArray(body.drafts)) {
    return bad("collectorId and drafts array required", 400);
  }
  const cleaned = body.drafts
    .filter((d) => typeof d.clientRef === "string" && typeof d.materialCode === "string")
    .map((d) => ({
      clientRef: String(d.clientRef),
      materialCode: String(d.materialCode),
      weight: Number(d.weight) || 0,
      condition: (d.condition === "mixed" || d.condition === "damaged" ? d.condition : "good") as
        | "good"
        | "mixed"
        | "damaged",
      pieces: typeof d.pieces === "number" ? d.pieces : undefined,
      notes: typeof d.notes === "string" ? d.notes : undefined,
      source: typeof d.source === "string" ? d.source : undefined,
      photoDataUrl: typeof d.photoDataUrl === "string" ? d.photoDataUrl : undefined,
      aiMaterialCode: typeof d.aiMaterialCode === "string" ? d.aiMaterialCode : undefined,
      aiDetectedClass: typeof d.aiDetectedClass === "string" ? d.aiDetectedClass : undefined,
      aiConfidence: typeof d.aiConfidence === "number" ? d.aiConfidence : undefined,
      aiSource: d.aiSource === "roboflow" ? ("roboflow" as const) : d.aiSource === "demo" ? ("demo" as const) : undefined,
      locationLabel: typeof d.locationLabel === "string" ? d.locationLabel : "Demo location",
      capturedAt: typeof d.capturedAt === "number" ? d.capturedAt : Date.now(),
      estimatedValue: Number(d.estimatedValue) || 0,
    }));
  if (cleaned.length === 0) return bad("No valid drafts in payload", 400);
  try {
    const res = await ctx.runMutation(api.sync.syncQueue, {
      collectorId: body.collectorId as never,
      drafts: cleaned,
    });
    return json({ success: true, ...res });
  } catch {
    return bad("Sync failed", 500);
  }
}));

export { restRoutes };
export default http;
