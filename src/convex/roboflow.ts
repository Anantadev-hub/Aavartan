"use node";
// ---------------------------------------------------------------------------
// Roboflow integration (SERVER-SIDE ONLY).
//
// The API key lives in the Convex backend environment (ROBOFLOW_API_KEY,
// ROBOFLOW_MODEL_ID, ROBOFLOW_API_URL) and is NEVER sent to the client or
// hardcoded. All requests happen inside this Convex action module.
//
// Flow: image → validate → POST to Roboflow → predictions → highest-confidence
// class → map to a supported material → threshold check → structured result.
// If Roboflow is unreachable/misconfigured we return an HONEST demo fallback
// ("AI service unavailable — using demo prediction") so the SIH demo can
// continue without pretending the result came from live AI.
// ---------------------------------------------------------------------------

export type ClassifySource = "roboflow" | "demo";

export type ClassifyResult = {
  source: ClassifySource;
  isDemoFallback: boolean;
  demoNote: string | null;
  detectedClass: string | null; // raw model class, e.g. "PCB"
  materialCode: string | null; // mapped marketplace material, e.g. "pcb"
  materialId: string | null; // materials table id when known to the app
  confidence: number; // 0..1
  supported: boolean; // class maps to a marketplace material
  requiresConfirmation: boolean; // user must confirm before proceeding
  candidates: Array<{ materialCode: string; confidence: number }>;
};

/** Confidence below which the AI result is treated as unverified. */
export const CONFIDENCE_THRESHOLD = 0.65;

/**
 * Business-rule mapping (spec §19): only these model classes map to
 * marketplace materials. Specific classes like Smartphone/RAM/HDD are
 * deliberately NOT force-mapped to PCB — unsupported detections return
 * supported=false and the collector picks the material manually.
 */
const CLASS_TO_MATERIAL: Record<string, string> = {
  PCB: "pcb",
  BATTERY: "battery",
  CABLE: "cable",
};

/** Roboflow serverless base URL. */
function apiBase(): string {
  return (process.env.ROBOFLOW_API_URL ?? "https://serverless.roboflow.com").replace(/\/+$/, "");
}

/** Model id with version suffix, e.g. "e-waste-detection-model-ikn0x/1". */
function modelId(): string | null {
  const id = process.env.ROBOFLOW_MODEL_ID;
  if (!id) return null;
  return /\/\d+$/.test(id) ? id : `${id}/1`;
}

type RoboflowPrediction = { class?: string; confidence?: number };
type RoboflowResponse = { predictions?: RoboflowPrediction[] };

function demoNote(msg: string): string {
  return msg;
}

/**
 * POST the base64 image to Roboflow and normalize the response.
 * Returns null when the service is unavailable/misconfigured — the caller
 * (ai.classifyMaterial) then produces the clearly-labelled demo fallback.
 */
export async function classifyWithRoboflow(imageDataUrl: string): Promise<ClassifyResult | null> {
  const key = process.env.ROBOFLOW_API_KEY;
  const model = modelId();
  if (!key || !model) return null;

  // Accept both raw base64 and data URLs; strip the data URL prefix.
  const base64 = imageDataUrl.includes(",") ? imageDataUrl.split(",")[1] : imageDataUrl;
  if (!base64 || base64.length < 32) return null;

  const url = `${apiBase()}/${model}?api_key=${encodeURIComponent(key)}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: base64,
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      // Server-side diagnostics only — the key is never logged (§45).
      console.warn(`[roboflow] inference failed with status ${res.status}`);
      return null; // caller falls back to the honest demo result
    }
    const data = (await res.json()) as RoboflowResponse;
    const predictions = Array.isArray(data.predictions) ? data.predictions : [];
    if (predictions.length === 0) {
      // Roboflow IS reachable and found nothing in the image — that is a real
      // "no detection" result, NOT a service outage. Report it honestly.
      return {
        source: "roboflow",
        isDemoFallback: false,
        demoNote: null,
        detectedClass: null,
        materialCode: null,
        materialId: null,
        confidence: 0,
        supported: false,
        requiresConfirmation: true,
        candidates: [],
      };
    }

    // Select the highest-confidence prediction overall.
    const best = predictions.reduce((a, b) =>
      (b.confidence ?? 0) > (a.confidence ?? 0) ? b : a,
    );
    const detectedClass = (best.class ?? "").trim();
    const confidence = Math.max(0, Math.min(1, best.confidence ?? 0));
    const materialCode = CLASS_TO_MATERIAL[detectedClass.toUpperCase()] ?? null;
    const supported = materialCode !== null && confidence >= CONFIDENCE_THRESHOLD;

    const candidates = predictions
      .map((p) => ({
        materialCode: CLASS_TO_MATERIAL[(p.class ?? "").toUpperCase()] ?? "",
        confidence: Math.round(Math.max(0, Math.min(1, p.confidence ?? 0)) * 100),
      }))
      .filter((c) => c.materialCode !== "")
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 3);

    return {
      source: "roboflow",
      isDemoFallback: false,
      demoNote: null,
      detectedClass: detectedClass || null,
      materialCode: supported ? materialCode : null,
      materialId: null, // resolved against the materials table by the caller
      confidence,
      supported,
      requiresConfirmation: !supported,
      candidates,
    };
  } catch {
    // Network error, timeout, non-JSON body → honest demo fallback upstream.
    return null;
  }
}

// ---- Demo fallback (deterministic mock classifier) -------------------------
// Deterministic pseudo-model: hashes the image so the same photo yields the
// same material. Bias to PCB keeps the scripted SIH demo reproducible.
// The result is ALWAYS flagged isDemoFallback=true with a visible note.

export function demoClassify(imageDataUrl: string): ClassifyResult {
  let seed = 0;
  const step = Math.max(1, Math.floor(imageDataUrl.length / 64));
  for (let i = 0; i < imageDataUrl.length; i += step) {
    seed = (seed * 31 + imageDataUrl.charCodeAt(i)) >>> 0;
  }
  const rand = (() => {
    let s = seed || 1;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  })();

  const classes = ["pcb", "cable", "battery", "lcd", "crt", "motor", "plastic", "other"];
  const primaryIdx = rand() < 0.7 ? 0 : 1 + (seed % (classes.length - 1));
  const primary = classes[primaryIdx];
  const confidence = primary === "pcb" ? 0.78 + rand() * 0.2 : 0.55 + rand() * 0.3;
  const supported = confidence >= CONFIDENCE_THRESHOLD;

  return {
    source: "demo",
    isDemoFallback: true,
    demoNote: demoNote("AI service unavailable — using demo prediction."),
    detectedClass: primary.toUpperCase(),
    materialCode: primary,
    materialId: null,
    confidence,
    supported,
    requiresConfirmation: !supported,
    candidates: [
      { materialCode: primary, confidence: Math.round(confidence * 100) },
    ],
  };
}

/** HONEST note strings shared with the UI. */
export const DEMO_FALLBACK_NOTE = "AI service unavailable — using demo prediction.";
