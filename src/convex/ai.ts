import { v } from "convex/values";
import { action } from "./_generated/server";

// ---------------------------------------------------------------------------
// AI service (mock inference). Architecture mirrors a real model deployment:
// swap `mockClassify` for a fetch() to a FastAPI model endpoint and nothing
// else in the app changes. The UI clearly labels this as demo inference.
// ---------------------------------------------------------------------------

type ClassResult = {
  materialCode: string;
  confidence: number;
  candidates: Array<{ materialCode: string; confidence: number }>;
  model: string;
};

// Deterministic pseudo-model: hashes the image size + a sample of pixel-ish
// bytes so the same photo yields the same material (feels like a real model
// without shipping one). Replace with a real CNN endpoint for production.
function mockClassify(imageDataUrl: string): ClassResult {
  // Sample characters spread across the data URL for a stable seed.
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
  // Demo bias: resolve to PCB ~70% of the time so the scripted SIH demo flow
  // (photograph a PCB → "PCB — 94%") is reproducible on stage.
  const primaryIdx = rand() < 0.7 ? 0 : 1 + (seed % (classes.length - 1));
  const confidence = primaryIdx === 0 ? 0.78 + rand() * 0.2 : 0.55 + rand() * 0.3;
  const second = classes[(primaryIdx + 1 + Math.floor(rand() * 6)) % classes.length];
  const candidates = [
    { materialCode: classes[primaryIdx], confidence: Math.round(confidence * 100) },
    { materialCode: second, confidence: Math.round((1 - confidence) * 62) },
  ].sort((a, b) => b.confidence - a.confidence);

  return {
    materialCode: candidates[0].materialCode,
    confidence: candidates[0].confidence / 100,
    candidates,
    model: "demo-mock-classifier-v1",
  };
}

export const classifyMaterial = action({
  args: { imageDataUrl: v.string() },
  handler: async (_ctx, { imageDataUrl }): Promise<ClassResult> => {
    // Validate input is a data URL image (file type validation at the boundary).
    if (!imageDataUrl.startsWith("data:image/")) {
      throw new Error("Invalid image payload");
    }
    if (imageDataUrl.length > 3_500_000) {
      throw new Error("Image too large");
    }
    // PRODUCTION: const res = await fetch(`${process.env.AI_SERVICE_URL}/classify`, {...});
    const result = mockClassify(imageDataUrl);
    return result;
  },
});

// Valuation stays explainable: rate table × condition multiplier (see lots.ts).
export const estimateValueRules = { conditionMultiplier: { good: 1, mixed: 0.9, damaged: 0.7 } };
