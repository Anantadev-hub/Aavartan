import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  ChevronRightIcon, MapPinIcon, ShieldCheckIcon, SparkleIcon, XCircleIcon, ClockIcon,
} from "@/components/icons";
import { ClayButton, ClayCard, ClayBadge, Field, ClayInput, EmptyState, LoadingState } from "@/components/ui/kit";
import { useAppState, pushToast } from "@/lib/app-state";
import { formatINR, formatKg, formatDateTime, timeAgo, aiConfidencePercent } from "@/lib/format";
import {
  useMaterials, useProfile, useAvailableLots, useLotDetail, useFairPriceMeter,
  type LotWithCollector,
} from "@/hooks/use-kc-data";
import { cn } from "@/lib/utils";

export default function RecyclerLots({ recyclerId }: { recyclerId: Id<"recyclers"> | null }) {
  const { t } = useAppState();
  const incoming = useAvailableLots();
  const { materials } = useMaterials();
  const [reviewing, setReviewing] = useState<string | null>(null);

  if (incoming === undefined) return <LoadingState label={t("common.loading")} />;

  if (reviewing) {
    return (
      <ReviewLot
        lotId={reviewing as Id<"lots">}
        recyclerId={recyclerId}
        onBack={() => setReviewing(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-navy">Available Lots</h1>
        <p className="mt-1 text-sm text-muted2">
          Collector submissions awaiting your review and quote.
        </p>
      </div>

      {incoming.length === 0 ? (
        <EmptyState
          icon={<ClockIcon className="size-10" />}
          title="No lots waiting"
          sub="New collector submissions will appear here."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {incoming.map((lot: LotWithCollector) => {
            const mat = materials?.find((m) => m.code === lot.materialCode);
            return (
              <ClayCard key={lot._id} className="rounded-3xl">
                <div className="flex gap-3">
                  {lot.photoDataUrl ? (
                    <img src={lot.photoDataUrl} alt="" className="size-16 shrink-0 rounded-2xl object-cover" />
                  ) : (
                    <span className="clay-flat flex size-16 shrink-0 items-center justify-center text-lg font-extrabold text-teal-deep">
                      {lot.materialCode.slice(0, 2).toUpperCase()}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-extrabold text-navy">
                      {mat?.name ?? lot.materialCode} · {formatKg(lot.weight)}
                    </p>
                    <p className="mt-0.5 text-[11.5px] text-muted2">
                      {lot.referenceId} · {timeAgo(lot.createdAt)}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {(() => {
                        const pct = aiConfidencePercent(lot.aiConfidence);
                        return pct != null ? (
                          <ClayBadge tone="teal">
                            <SparkleIcon className="size-3" /> AI {pct}%
                            {lot.aiSource === "demo" ? " · demo" : ""}
                          </ClayBadge>
                        ) : (
                          <ClayBadge>Manual</ClayBadge>
                        );
                      })()}
                      <ClayBadge tone="neutral">{lot.condition}</ClayBadge>
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-muted2">Estimated</p>
                    <p className="text-[15px] font-extrabold text-teal-deep">
                      {formatINR(lot.estimatedValue)}
                    </p>
                  </div>
                  <ClayButton size="sm" onClick={() => setReviewing(lot._id)}>
                    Review <ChevronRightIcon className="size-4" />
                  </ClayButton>
                </div>
                <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-muted2">
                  <MapPinIcon className="size-3.5 shrink-0" /> {lot.locationLabel}
                  {lot.collectorName ? ` · ${lot.collectorName}` : ""}
                </p>
              </ClayCard>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------ Review panel ----------------------------- */

function ReviewLot({
  lotId,
  recyclerId,
  onBack,
}: {
  lotId: Id<"lots">;
  recyclerId: Id<"recyclers"> | null;
  onBack: () => void;
}) {
  const { t } = useAppState();
  const data = useLotDetail(lotId); // offline-aware (same return shape)
  const { materials } = useMaterials();
  const quoteLot = useMutation(api.lots.quoteLot);

  const [price, setPrice] = useState("");
  const [rejectMode, setRejectMode] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  // Hooks MUST run before any early return (React rules of hooks): the fair
  // price meter previously hung below the loading/not-found branches and
  // crashed the review screen whenever a lot resolved.
  const typedPrice = Number(price) || 0;
  const meterInput = data && data !== null && "lot" in data ? data.lot.materialCode : null;
  const meter = useFairPriceMeter(
    meterInput ?? "pcb",
    typedPrice > 0 ? typedPrice : undefined,
  );

  if (data === undefined) return <LoadingState label={t("common.loading")} />;
  if (data === null) {
    return (
      <div>
        <p className="text-sm text-muted2">Lot not found.</p>
        <ClayButton variant="surface" className="mt-3" onClick={onBack}>
          Back
        </ClayButton>
      </div>
    );
  }

  const { lot, collector } = data;
  const mat = materials?.find((m) => m.code === lot.materialCode);
  const matName = mat?.name ?? lot.materialCode.toUpperCase();
  const numPrice = typedPrice;
  const finalValue = numPrice > 0 ? Math.round(numPrice * lot.weight) : 0;
  // §9/§10: show the collector who submitted the lot — not the signed-in
  // recycler's own name (the portal previously displayed itself as collector).
  const collectorName = collector?.name ?? "Collector";

  const submit = async (reject: boolean) => {
    if (!recyclerId) {
      pushToast("Facility binding still syncing — try again in a moment", "error");
      return;
    }
    setBusy(true);
    try {
      await quoteLot({
        lotId: lot._id,
        recyclerId,
        quotedPrice: reject ? undefined : numPrice,
        reject,
        rejectionReason: reject ? reason || "Material not suitable" : undefined,
      });
      pushToast(reject ? "Lot rejected" : `Quote sent — ₹${numPrice}/kg`, reject ? "info" : "success");
      onBack();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "Could not submit", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-2">
        <button
          onClick={onBack}
          aria-label="Back to lots"
          className="clay-sm flex size-10 items-center justify-center text-navy clay-pressable"
        >
          <ChevronRightIcon className="size-5 rotate-180" />
        </button>
        <h1 className="flex-1 truncate text-xl font-extrabold tracking-tight text-navy">
          Review {lot.referenceId}
        </h1>
      </div>

      <ClayCard className="rounded-3xl">
        <div className="flex gap-3">
          {lot.photoDataUrl ? (
            <img src={lot.photoDataUrl} alt="" className="size-24 rounded-2xl object-cover" />
          ) : (
            <span className="clay-flat flex size-24 items-center justify-center text-2xl font-extrabold text-teal-deep">
              {lot.materialCode.slice(0, 2).toUpperCase()}
            </span>
          )}
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="text-lg font-extrabold text-navy">{matName}</p>
            <p className="text-[13px] text-muted2">{formatKg(lot.weight)} · {lot.condition}</p>
            {lot.aiConfidence ? (() => {
              const pct = aiConfidencePercent(lot.aiConfidence);
              return pct != null ? (
                <ClayBadge tone="teal" className="mt-1">
                  <SparkleIcon className="size-3" /> AI estimate {pct}% confidence
                </ClayBadge>
              ) : (
                <ClayBadge className="mt-1">Manual entry</ClayBadge>
              );
            })() : (
              <ClayBadge className="mt-1">Manual entry</ClayBadge>
            )}
            <p className="text-[12.5px] text-muted2">
              Platform estimate: <span className="font-bold text-navy">{formatINR(lot.estimatedValue)}</span>
            </p>
          </div>
        </div>
        <div className="mt-3 grid gap-2 text-[12.5px] sm:grid-cols-2">
          <p className="rounded-2xl bg-muted px-3.5 py-2.5">
            <span className="block text-[10.5px] font-bold uppercase tracking-wide text-muted2">Collector</span>
            {collectorName}
          </p>
          <p className="rounded-2xl bg-muted px-3.5 py-2.5">
            <span className="block text-[10.5px] font-bold uppercase tracking-wide text-muted2">Submitted</span>
            {formatDateTime(lot.createdAt)}
          </p>
          <p className="rounded-2xl bg-muted px-3.5 py-2.5 sm:col-span-2">
            <span className="block text-[10.5px] font-bold uppercase tracking-wide text-muted2">Location</span>
            {lot.locationLabel}
          </p>
        </div>
      </ClayCard>

      {!rejectMode ? (
        <ClayCard className="rounded-3xl">
          <p className="text-[13px] font-bold uppercase tracking-wide text-muted2">Your quoted price</p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <Field label="₹ per kg">
              <ClayInput
                type="number"
                inputMode="decimal"
                min={0}
                step={1}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder={String(mat?.currentPrice ?? 0)}
                aria-label="Quote per kg"
              />
            </Field>
            <div className="clay-flat rounded-2xl px-4 py-3">
              <p className="text-[10.5px] font-bold uppercase tracking-wide text-muted2">Final value</p>
              <p className="text-xl font-extrabold text-navy">
                {finalValue > 0 ? formatINR(finalValue) : "—"}
              </p>
            </div>
          </div>
          {meter && (
            <div className="mt-3 rounded-2xl bg-muted px-3.5 py-3">
              <div className="flex items-center justify-between text-[12px] font-bold">
                <span className="text-muted2">Fair Price Meter</span>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5",
                    meter.wording === "Within typical range"
                      ? "bg-[#064E3B] text-teal"
                      : "bg-[#451A03] text-[var(--pending)]",
                  )}
                >
                  {meter.wording}
                </span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[#20242D]">
                <div
                  className={cn(
                    "h-full rounded-full",
                    meter.wording === "Within typical range" ? "bg-teal" : "bg-[var(--gold)]",
                  )}
                  style={{
                    width: `${Math.max(
                      4,
                      Math.min(
                        100,
                        ((meter.quotedPrice - meter.range.low) /
                          Math.max(1, meter.range.high - meter.range.low)) *
                          100,
                      ),
                    )}%`,
                  }}
                />
              </div>
              <div className="mt-1.5 flex justify-between text-[10.5px] font-semibold text-muted2">
                <span>₹{meter.range.low}/kg low</span>
                <span>
                  Market ₹{meter.currentMarket}/kg · quote {meter.pctVsMarket >= 0 ? "+" : ""}
                  {meter.pctVsMarket}%
                </span>
                <span>₹{meter.range.high}/kg high</span>
              </div>
            </div>
          )}
          {numPrice > 0 && mat && numPrice > mat.currentPrice * 2.5 && (
            <p className="mt-2 rounded-2xl bg-[#451A03] px-3.5 py-2.5 text-[12.5px] font-semibold text-[var(--pending)]">
              Review recommended: quote is far above the indicative market rate.
            </p>
          )}
          <div className="mt-4 grid gap-2.5 sm:grid-cols-[1fr_auto]">
            <ClayButton disabled={busy || numPrice <= 0 || !recyclerId} onClick={() => void submit(false)}>
              <ShieldCheckIcon className="size-5" /> Accept &amp; Send Quote
            </ClayButton>
            <ClayButton variant="danger" disabled={busy || !recyclerId} onClick={() => setRejectMode(true)}>
              <XCircleIcon className="size-5" /> Reject Lot
            </ClayButton>
          </div>
          {!recyclerId && (
            <p className="mt-2 rounded-2xl bg-[#451A03] px-3.5 py-2.5 text-[12.5px] font-semibold text-[var(--pending)]">
              Facility binding still syncing — quoting is disabled until it lands.
            </p>
          )}
        </ClayCard>
      ) : (
        <ClayCard className="rounded-3xl border-l-4 border-[var(--danger)]">
          <p className="text-[13px] font-bold uppercase tracking-wide text-[var(--danger)]">Reject lot</p>
          <div className="mt-2">
            <Field label="Reason">
              <ClayInput
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Material quality below acceptance threshold"
              />
            </Field>
          </div>
          <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
            <ClayButton variant="danger" disabled={busy} onClick={() => void submit(true)}>
              Confirm rejection
            </ClayButton>
            <ClayButton variant="ghost" onClick={() => setRejectMode(false)}>
              Cancel
            </ClayButton>
          </div>
          <p className="mt-2 text-[11.5px] text-muted2">
            The collector sees your reason and can list the lot with another recycler.
          </p>
        </ClayCard>
      )}
    </div>
  );
}
