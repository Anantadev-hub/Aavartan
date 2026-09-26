import { v } from "convex/values";
import { action, internalQuery, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  classifyWithRoboflow,
  demoClassify,
  CONFIDENCE_THRESHOLD,
  type ClassifyResult,
} from "./roboflow";

// ---------------------------------------------------------------------------
// AI service — POST /api/ai/classify-material
//
// Server-side Roboflow inference with an HONEST demo fallback (spec §42): if
// Roboflow is unreachable/misconfigured the action returns source="demo" and a
// visible note "AI service unavailable — using demo prediction." — it never
// pretends a demo result came from live AI.
//
// Flow (spec §20): photo → AI detection → confidence → USER CONFIRMATION →
// weight → price → lot. AI never auto-creates a sale; requiresConfirmation is
// true whenever the class is unsupported or confidence < 0.65.
// ---------------------------------------------------------------------------

export { CONFIDENCE_THRESHOLD };

const ALLOWED_MATERIALS = ["pcb", "lcd", "crt", "cable", "battery", "motor", "plastic"];

/** Internal lookup (actions have no direct db access). */
export const materialIdByCode = internalQuery({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const m = await ctx.db
      .query("materials")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    return m?._id ?? null;
  },
});

/** Resolve the mapped material code against the materials catalogue. */
async function resolveMaterialId(
  ctx: ActionCtx,
  materialCode: string | null,
): Promise<string | null> {
  if (!materialCode || !ALLOWED_MATERIALS.includes(materialCode)) return null;
  return ctx.runQuery(internal.ai.materialIdByCode, { code: materialCode });
}

export const classifyMaterial = action({
  args: { imageDataUrl: v.string() },
  handler: async (ctx, { imageDataUrl }): Promise<ClassifyResult & { materialId: string | null }> => {
    // ---- Validate image (spec §44): type + size at the boundary -----------
    if (!imageDataUrl.startsWith("data:image/")) {
      throw new Error("Invalid image payload — expected a data URL image");
    }
    if (imageDataUrl.length > 3_500_000) {
      throw new Error("Image too large — compress before upload");
    }

    // ---- Real inference first, server-side --------------------------------
    const rf = await classifyWithRoboflow(imageDataUrl);
    if (rf) {
      const materialId = await resolveMaterialId(ctx, rf.materialCode);
      return { ...rf, materialId };
    }

    // ---- Honest demo fallback --------------------------------------------
    const demo = demoClassify(imageDataUrl);
    const materialId = await resolveMaterialId(ctx, demo.materialCode);
    return { ...demo, materialId };
  },
});

// Lightweight status probe for demo screens ("AI: live Roboflow" vs demo mode).
export const aiStatus = action({
  args: {},
  handler: async (_ctx): Promise<{ mode: "roboflow" | "demo"; model: string }> => {
    const configured = Boolean(process.env.ROBOFLOW_API_KEY && process.env.ROBOFLOW_MODEL_ID);
    return {
      mode: configured ? "roboflow" : "demo",
      model: process.env.ROBOFLOW_MODEL_ID ?? "demo-mock-classifier-v1",
    };
  },
});

// Valuation stays explainable: rate table × condition multiplier (see lots.ts).
export const estimateValueRules = { conditionMultiplier: { good: 1, mixed: 0.9, damaged: 0.7 } };
