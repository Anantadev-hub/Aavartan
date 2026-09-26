import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  ChevronLeftIcon, MapPinIcon, PhoneIcon, ShieldCheckIcon, StarIcon, TruckIcon, FilterIcon,
} from "@/components/icons";
import { ClayButton, ClayCard, ClayBadge, EmptyState, LoadingState } from "@/components/ui/kit";
import { useAppState, pushToast, enqueueDraft } from "@/lib/app-state";
import { formatINR } from "@/lib/format";
import { useMaterials, useProfile, useMatchedRecyclers } from "@/hooks/use-kc-data";
import { cn } from "@/lib/utils";

type SortMode = "match" | "distance" | "rate";

export default function FindRecycler({
  materialCode,
  weightKg,
  onDone,
  onCreated,
  onClose,
}: {
  materialCode?: string;
  weightKg?: number;
  onDone?: (recyclerId: Id<"recyclers">) => void;
  onCreated?: (lotId: Id<"lots">) => void;
  onClose: () => void;
}) {
  const { t } = useAppState();
  const profile = useProfile();
  const { materials } = useMaterials();
  const [sort, setSort] = useState<SortMode>("match");
  const [verifiedOnly, setVerifiedOnly] = useState(true);
  const [pickupOnly, setPickupOnly] = useState(false);
  const [selecting, setSelecting] = useState<Id<"recyclers"> | null>(null);

  const mat = materialCode ?? "pcb";
  const matName = materials?.find((m) => m.code === mat)?.name ?? mat.toUpperCase();

  // Offline-aware matching hook (same args/return as the previous useQuery).
  const results = useMatchedRecyclers({
    materialCode: mat,
    weightKg: weightKg && weightKg > 0 ? weightKg : undefined,
    verifiedOnly,
    pickupOnly,
    sortBy: sort,
  });

  const createLot = useMutation(api.lots.createLot);
  // Browse mode (no weight known): show recyclers without creating lots.
  const browse = !weightKg || weightKg <= 0;

  const select = async (recyclerId: Id<"recyclers">) => {
    if (!profile) return;
    // Locally onboarded (Pending Sync) profile: queue the lot instead of
    // calling the backend mutation with an invalid id.
    if ("isLocalProfile" in profile) {
      enqueueDraft({
        materialCode: mat,
        weight: weightKg && weightKg > 0 ? weightKg : 1,
        condition: "good",
        locationLabel: "Sector 8, New Delhi (demo location)",
        capturedAt: Date.now(),
        estimatedValue: 0,
      });
      pushToast(t("add.offlineNote"), "info");
      onClose();
      return;
    }
    if (onDone) {
      onDone(recyclerId);
      return;
    }
    // Direct flow from "Find Recyclers" quick action: create a lot with this
    // recycler at the board rate (estimate refined when the recycler quotes).
    setSelecting(recyclerId);
    try {
      const m = materials?.find((x) => x.code === mat);
      const rate = m?.currentPrice ?? 0;
      const res = await createLot({
        collectorId: profile._id,
        recyclerId,
        materialCode: mat,
        weight: weightKg && weightKg > 0 ? weightKg : 1,
        condition: "good",
        locationLabel: "Sector 8, New Delhi (demo location)",
        syncOrigin: "online",
        sendNow: true,
      });
      pushToast(`Lot ${res.referenceId} sent to recycler`, "success");
      if (onCreated) onCreated(res.lotId);
      else onClose();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "Could not create lot", "error");
    } finally {
      setSelecting(null);
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      <div className="px-4 pt-4">
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            aria-label="Back"
            className="clay-sm flex size-10 items-center justify-center text-navy clay-pressable"
          >
            <ChevronLeftIcon className="size-5" />
          </button>
          <h1 className="text-[22px] font-extrabold tracking-tight text-navy">{t("recyclers.title")}</h1>
        </div>
        <p className="mt-1 text-[13px] text-muted2">
          {t("recyclers.accepting")} <span className="font-bold text-navy">{matName.split(" (")[0]}</span>{" "}
          {t("recyclers.nearYou")}.
        </p>

        {/* Filters */}
        <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-1">
          <span className="clay-flat flex size-9 shrink-0 items-center justify-center text-muted2">
            <FilterIcon className="size-4.5" />
          </span>
          {(
            [
              { key: "match", label: "Best match" },
              { key: "distance", label: "Nearest" },
              { key: "rate", label: "Highest rate" },
            ] as const
          ).map((f) => (
            <button
              key={f.key}
              onClick={() => setSort(f.key)}
              aria-pressed={sort === f.key}
              className={cn(
                "shrink-0 rounded-xl px-3 py-2 text-[12px] font-bold clay-pressable",
                sort === f.key ? "bg-navy text-teal" : "bg-card text-muted2 shadow-[var(--clay-1)]",
              )}
            >
              {f.label}
            </button>
          ))}
          <button
            onClick={() => setVerifiedOnly((v) => !v)}
            aria-pressed={verifiedOnly}
            className={cn(
              "shrink-0 rounded-xl px-3 py-2 text-[12px] font-bold clay-pressable",
              verifiedOnly ? "bg-teal text-white" : "bg-card text-muted2 shadow-[var(--clay-1)]",
            )}
          >
            ✓ Verified
          </button>
          <button
            onClick={() => setPickupOnly((v) => !v)}
            aria-pressed={pickupOnly}
            className={cn(
              "shrink-0 rounded-xl px-3 py-2 text-[12px] font-bold clay-pressable",
              pickupOnly ? "bg-teal text-white" : "bg-card text-muted2 shadow-[var(--clay-1)]",
            )}
          >
            Pickup
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-2.5 px-4 pb-6 pt-2">
        {results === undefined ? (
          <LoadingState label={t("common.loading")} />
        ) : results.length === 0 ? (
          <EmptyState title="No recyclers match" sub="Try removing a filter." />
        ) : (
          results.map((r) => (
            <ClayCard key={r._id} className={cn("rounded-3xl", !r.acceptsMaterial && "opacity-70")}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-[15px] font-extrabold text-navy">{r.name}</p>
                    {r.verified && (
                      <ShieldCheckIcon className="size-4 shrink-0 text-[var(--verified)]" aria-label="Verified" />
                    )}
                  </div>
                  <p className="mt-0.5 flex items-center gap-2 text-[11.5px] text-muted2">
                    <span className="inline-flex items-center gap-0.5">
                      <MapPinIcon className="size-3.5" /> {r.distanceKm} km
                    </span>
                    <span className="inline-flex items-center gap-0.5">
                      <StarIcon className="size-3.5 text-[var(--gold)]" /> {r.rating}
                    </span>
                    {r.pickupAvailable && (
                      <span className="inline-flex items-center gap-0.5 text-teal-deep">
                        <TruckIcon className="size-3.5" /> Pickup
                      </span>
                    )}
                  </p>
                </div>
                <div className="text-right">
                  {r.acceptsMaterial ? (
                    <>
                      <p className="text-[15px] font-extrabold text-navy">{formatINR(r.rate)}</p>
                      <p className="text-[10px] font-bold text-muted2">per kg</p>
                    </>
                  ) : (
                    <ClayBadge tone="red">Not accepted</ClayBadge>
                  )}
                </div>
              </div>

              <p className="mt-2 flex flex-wrap gap-1">
                {r.materialsAccepted.map((mc) => (
                  <span
                    key={mc}
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                      mc === mat ? "bg-mint text-teal-deep" : "bg-muted text-muted2",
                    )}
                  >
                    {materials?.find((m) => m.code === mc)?.name.split(" (")[0] ?? mc}
                  </span>
                ))}
              </p>

              {r.acceptsMaterial && weightKg && weightKg > 0 && r.estimatedValue != null && (
                <p className="mt-2 text-[12px] font-semibold text-muted2">
                  Est. for your {weightKg} kg: <span className="text-navy">{formatINR(r.estimatedValue)}</span>
                </p>
              )}

              {/* Visible match reasons (§26) — transparency, not black-box AI. */}
              {r.matchReasons?.length > 0 && (
                <p className="mt-2 flex flex-wrap gap-1">
                  {r.matchReasons.map((reason) => (
                    <span
                      key={reason}
                      className="rounded-full bg-[#064E3B]/60 px-2 py-0.5 text-[10px] font-bold text-teal"
                    >
                      {reason}
                    </span>
                  ))}
                </p>
              )}

              <div className="mt-3 flex items-center justify-between gap-2">
                <ClayBadge tone={r.verified ? "green" : "amber"}>
                  {r.authorizationStatus}
                </ClayBadge>
                {browse ? (
                  <span className="inline-flex items-center gap-1.5 rounded-xl bg-muted px-3 py-2 text-[12px] font-bold text-muted2">
                    <PhoneIcon className="size-4" /> {r.contact}
                  </span>
                ) : (
                  <ClayButton
                    size="sm"
                    disabled={!r.acceptsMaterial || selecting !== null}
                    onClick={() => void select(r._id)}
                  >
                    {selecting === r._id ? "Sending…" : t("common.selectRecycler")}
                  </ClayButton>
                )}
              </div>
            </ClayCard>
          ))
        )}

        <p className="pt-1 text-center text-[11px] text-muted2">
          {browse
            ? "Browse mode — start from Add E-Waste with a weight to send a lot."
            : "Matching uses a transparent score: material fit, distance, verification, pickup and rate. No black-box AI."}
        </p>
      </div>
    </div>
  );
}
