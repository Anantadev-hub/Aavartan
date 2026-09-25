import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  CameraIcon, ChevronLeftIcon, ImageIcon, MapPinIcon, SparkleIcon, TruckIcon, WarningIcon,
} from "@/components/icons";
import { ClayButton, ClayCard, ClayBadge, Field, ClayInput } from "@/components/ui/kit";
import { useAppState, pushToast, enqueueDraft } from "@/lib/app-state";
import { fileToCompressedDataUrl, formatINR } from "@/lib/format";
import { useMaterials, useProfile } from "@/hooks/use-kc-data";
import { cn } from "@/lib/utils";

type Step = "capture" | "analyzing" | "result" | "details";

const CONDITIONS = [
  { key: "good", labelKey: "add.condGood" },
  { key: "mixed", labelKey: "add.condMixed" },
  { key: "damaged", labelKey: "add.condDamaged" },
] as const;

export default function AddFlow({
  onDone,
  onCancel,
  onFindRecycler,
}: {
  onDone: (lotId: Id<"lots">) => void;
  onCancel: () => void;
  onFindRecycler: (materialCode: string, weightKg: number) => void;
}) {
  const { t, online } = useAppState();
  const profile = useProfile();
  const { materials } = useMaterials();

  const createLotFn = useMutation(api.lots.createLot);
  const classifyAction = useAction(api.ai.classifyMaterial);

  const [step, setStep] = useState<Step>("capture");
  const [photo, setPhoto] = useState<string | null>(null);
  const [ai, setAi] = useState<{ materialCode: string; confidence: number } | null>(null);
  const [material, setMaterial] = useState<string>("pcb");
  const [weightText, setWeightText] = useState<string>("0.0");
  const [condition, setCondition] = useState<"good" | "mixed" | "damaged">("good");
  const [pieces, setPieces] = useState("");
  const [source, setSource] = useState("");
  const [locationLabel, setLocationLabel] = useState("Sector 8, New Delhi (demo location)");
  const [submitting, setSubmitting] = useState(false);

  const weight = Number(weightText) || 0;
  const estimate = useQuery(
    api.lots.estimateValue,
    weight > 0 ? { materialCode: material, weight, condition } : "skip",
  );

  const materialName = materials?.find((m) => m.code === material)?.name ?? material.toUpperCase();

  const startAnalysis = async (file: File) => {
    try {
      const dataUrl = await fileToCompressedDataUrl(file);
      setPhoto(dataUrl);
      setStep("analyzing");
      // Demo inference via the Convex action seam (src/convex/ai.ts). Swap the
      // mock model inside that action for a FastAPI endpoint in production.
      const result = await classifyAction({ imageDataUrl: dataUrl });
      await new Promise((r) => setTimeout(r, 1400)); // visible "analyzing" state
      setAi({ materialCode: result.materialCode, confidence: result.confidence });
      setMaterial(result.materialCode);
      setStep("result");
      if (result.confidence < 0.7) pushToast(t("add.lowConfidence"), "info");
    } catch {
      pushToast("AI identification failed. Please select the material manually.", "error");
      setStep("details");
    }
  };

  const createLot = async (sendNow: boolean) => {
    if (!profile || submitting) return;
    setSubmitting(true);
    try {
      if (online) {
        const res = await createLotFn({
          collectorId: profile._id,
          materialCode: material,
          weight,
          condition,
          pieces: pieces ? Number(pieces) : undefined,
          notes: source || undefined,
          photoDataUrl: photo ?? undefined,
          aiMaterialCode: ai?.materialCode,
          aiConfidence: ai ? Math.round(ai.confidence * 100) : undefined,
          locationLabel,
          syncOrigin: "online",
          sendNow: false,
        });
        pushToast(`Lot ${res.referenceId} created`, "success");
        onDone(res.lotId);
      } else {
        // Offline: queue locally; the sync worker flushes it when online.
        enqueueDraft({
          materialCode: material,
          weight,
          condition,
          pieces: pieces ? Number(pieces) : undefined,
          notes: source || undefined,
          photoDataUrl: photo ?? undefined,
          aiMaterialCode: ai?.materialCode,
          aiConfidence: ai ? Math.round(ai.confidence * 100) : undefined,
          locationLabel,
          capturedAt: Date.now(),
          estimatedValue: estimate?.estimatedValue ?? 0,
        });
        pushToast(t("add.offlineNote"), "info");
        onCancel();
      }
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "Could not create the lot", "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5 px-4 pb-6 pt-4">
      <div className="flex items-center gap-2">
        <button
          onClick={onCancel}
          aria-label="Cancel add flow"
          className="clay-sm flex size-10 items-center justify-center text-navy clay-pressable"
        >
          <ChevronLeftIcon className="size-5" />
        </button>
        <h1 className="text-[22px] font-extrabold tracking-tight text-navy">{t("add.title")}</h1>
      </div>

      {step === "capture" && (
        <div className="space-y-4">
          <ClayCard className="flex min-h-[300px] flex-col items-center justify-center gap-4 rounded-[32px] p-6">
            <span className="clay-track flex size-24 items-center justify-center text-teal">
              <CameraIcon className="size-10" />
            </span>
            <p className="text-center text-sm text-muted2">{t("add.instruction")}</p>
            <div className="grid w-full gap-2.5">
              <label className="clay-btn-primary flex h-14 cursor-pointer items-center justify-center gap-2 text-base font-semibold clay-pressable">
                <CameraIcon className="size-5" />
                {t("add.camera")}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void startAnalysis(f);
                  }}
                />
              </label>
              <label className="clay-sm flex h-14 cursor-pointer items-center justify-center gap-2 text-base font-semibold text-navy clay-pressable">
                <ImageIcon className="size-5" />
                {t("add.gallery")}
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void startAnalysis(f);
                  }}
                />
              </label>
            </div>
          </ClayCard>
          <p className="text-center text-[11px] text-muted2">
            Photo stays on your device as a compressed demo image.
          </p>
        </div>
      )}

      {step === "analyzing" && (
        <ClayCard className="flex flex-col items-center gap-5 rounded-[32px] p-8 text-center">
          <span className="relative flex size-24 items-center justify-center">
            <span className="absolute size-24 animate-ping rounded-full bg-teal/15" />
            <span className="absolute size-20 rounded-full border-4 border-teal/20 border-t-teal motion-safe:animate-spin" />
            <SparkleIcon className="relative size-8 text-teal" />
          </span>
          <p className="text-[16px] font-bold text-navy">{t("add.analyzing")}</p>
          <p className="text-xs text-muted2">{t("add.demoInference")}</p>
          <div className="clay-track h-3 w-full overflow-hidden">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-teal/60" />
          </div>
        </ClayCard>
      )}

      {step === "result" && ai && (
        <div className="space-y-4">
          {photo && (
            <div className="clay-lg overflow-hidden rounded-[32px] p-2">
              <img
                src={photo}
                alt="Captured e-waste"
                className="h-44 w-full rounded-[24px] object-cover"
              />
            </div>
          )}
          <ClayCard className="rounded-3xl">
            <div className="flex items-center gap-3">
              <span className="clay-sm flex size-11 shrink-0 items-center justify-center text-teal">
                <SparkleIcon className="size-6" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted2">
                  {t("add.aiId")}
                </p>
                <p className="truncate text-xl font-extrabold text-navy">
                  {materials?.find((m) => m.code === ai.materialCode)?.name ??
                    ai.materialCode.toUpperCase()}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xl font-extrabold text-teal-deep">
                  {Math.round(ai.confidence * 100)}%
                </p>
                <p className="text-[10.5px] font-semibold text-muted2">confidence</p>
              </div>
            </div>
            {ai.confidence < 0.7 && (
              <p className="mt-3 rounded-2xl bg-amber-50 px-3.5 py-2.5 text-[13px] font-semibold text-amber-700">
                {t("add.lowConfidence")}
              </p>
            )}
            <p className="mt-3 text-[11px] text-muted2">{t("add.demoInference")}</p>
          </ClayCard>

          <div>
            <p className="text-[13px] font-bold text-navy">{t("add.notRight")}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {(materials ?? []).map((m) => (
                <button
                  key={m.code}
                  onClick={() => {
                    setMaterial(m.code);
                    setStep("details");
                  }}
                  className={cn(
                    "clay-sm rounded-2xl px-3.5 py-2.5 text-[13px] font-bold clay-pressable",
                    material === m.code ? "bg-mint text-teal-deep ring-2 ring-teal" : "text-navy",
                  )}
                >
                  {m.name.split(" (")[0]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {step === "details" && (
        <div className="space-y-4">
          {photo && (
            <div className="clay-sm flex items-center gap-3 rounded-2xl p-2.5">
              <img src={photo} alt="" className="size-14 rounded-xl object-cover" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-extrabold text-navy">{materialName}</p>
                {ai && (
                  <p className="text-[11.5px] text-muted2">
                    AI verified — {Math.round(ai.confidence * 100)}%
                  </p>
                )}
              </div>
              <ClayBadge tone={ai ? "teal" : "neutral"}>{ai ? "AI verified" : "Manual"}</ClayBadge>
            </div>
          )}

          <ClayCard className="space-y-4 rounded-3xl">
            <Field label={t("add.weight")}>
              <div className="clay-flat flex items-center bg-card px-4">
                <ClayInput
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={0.1}
                  value={weightText}
                  onChange={(e) => setWeightText(e.target.value)}
                  className="h-14 border-0 bg-transparent text-xl font-extrabold text-navy shadow-none focus-visible:outline-none"
                  aria-label={t("add.weight")}
                />
                <span className="text-[15px] font-bold text-muted2">kg</span>
              </div>
            </Field>

            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted2">
                {t("add.condition")}
              </p>
              <div className="mt-1.5 grid grid-cols-3 gap-2">
                {CONDITIONS.map((c) => (
                  <button
                    key={c.key}
                    onClick={() => setCondition(c.key)}
                    aria-pressed={condition === c.key}
                    className={cn(
                      "clay-sm flex min-h-14 items-center justify-center rounded-2xl text-[13px] font-bold clay-pressable",
                      condition === c.key ? "bg-mint text-teal-deep ring-2 ring-teal" : "text-navy",
                    )}
                  >
                    {t(c.labelKey)}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Pieces (optional)">
                <ClayInput
                  value={pieces}
                  onChange={(e) => setPieces(e.target.value)}
                  inputMode="numeric"
                  placeholder="—"
                />
              </Field>
              <Field label="Source (optional)">
                <ClayInput
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder="—"
                />
              </Field>
            </div>

            <Field label="Location">
              <ClayInput value={locationLabel} onChange={(e) => setLocationLabel(e.target.value)} />
            </Field>
            <p className="flex items-center gap-1.5 text-[11px] text-muted2">
              <MapPinIcon className="size-3.5 shrink-0" />
              Demo uses a static location — real GPS comes with the mobile build.
            </p>
          </ClayCard>

          <ClayCard className="rounded-3xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted2">
                  {t("add.rate")}
                </p>
                <p className="text-2xl font-extrabold text-navy">
                  {estimate ? formatINR(estimate.ratePerKg) : "…"}
                  <span className="text-sm font-bold text-muted2">/kg</span>
                </p>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted2">
                  {t("add.estimate")}
                </p>
                <p className="text-2xl font-extrabold text-teal-deep">
                  {estimate ? formatINR(estimate.estimatedValue) : "—"}
                </p>
              </div>
            </div>
            <p className="mt-2.5 text-[11.5px] text-muted2">{t("add.disclaimer")}</p>
          </ClayCard>

          {!online && (
            <p className="flex items-center gap-2 rounded-2xl bg-amber-50 px-3.5 py-2.5 text-[13px] font-semibold text-amber-700">
              <WarningIcon className="size-4 shrink-0" />
              {t("add.offlineNote")}
            </p>
          )}

          <div className="grid gap-2.5">
            <ClayButton
              className="w-full"
              disabled={submitting || weight <= 0 || !online}
              onClick={() => onFindRecycler(material, weight)}
            >
              <TruckIcon className="size-5" />
              Find Authorized Recycler
            </ClayButton>
            <ClayButton
              variant="surface"
              className="w-full"
              disabled={submitting || weight <= 0}
              onClick={() => void createLot(!online)}
            >
              {online ? "Create lot" : "Save offline"}
            </ClayButton>
            <ClayButton
              variant="ghost"
              className="w-full"
              onClick={() => setStep(photo ? "result" : "capture")}
            >
              Back
            </ClayButton>
          </div>
        </div>
      )}
    </div>
  );
}
