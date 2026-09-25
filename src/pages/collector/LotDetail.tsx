import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { QRCodeSVG } from "qrcode.react";
import {
  CheckCircleIcon, ClockIcon, MapPinIcon, ShieldCheckIcon, SparkleIcon, XCircleIcon, ChevronLeftIcon,
} from "@/components/icons";
import { ClayButton, ClayCard, ClayBadge, StatusPill, LoadingState } from "@/components/ui/kit";
import { Timeline } from "@/components/ui/timeline";
import { useAppState, pushToast } from "@/lib/app-state";
import { formatINR, formatKg, formatDateTime } from "@/lib/format";
import { useMaterials, useProfile } from "@/hooks/use-kc-data";
import { cn } from "@/lib/utils";

export default function LotDetail({ lotId, onBack }: { lotId: Id<"lots"> | string; onBack: () => void }) {
  const { t, online } = useAppState();
  const profile = useProfile();
  const data = useQuery(api.lots.getLot, { lotId: lotId as never });
  const timeline = useQuery(api.lots.lotTimeline, { lotId: lotId as never });
  const { materials } = useMaterials();

  const confirmHandover = useMutation(api.lots.confirmHandover);
  const [confirming, setConfirming] = useState(false);

  if (data === undefined || timeline === undefined) {
    return <LoadingState label={t("common.loading")} />;
  }
  if (data === null || timeline === null) {
    return (
      <div className="px-4 pt-4">
        <EmptyStateInline label="Lot not found." onClose={onBack} />
      </div>
    );
  }

  const { lot, recycler, collector, anomalyFlags } = data;
  const mat = materials?.find((m) => m.code === lot.materialCode);
  const matName = mat?.name ?? lot.materialCode.toUpperCase();

  const isCollectorSide = profile?.role === "collector";
  const canConfirmHandover =
    isCollectorSide && lot.status === "accepted" && !lot.handoverConfirmedByCollector;

  const confirm = async () => {
    setConfirming(true);
    try {
      await confirmHandover({ lotId: lot._id, by: "collector" });
      pushToast("Handover confirmed — waiting for recycler", "success");
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "Could not confirm", "error");
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="flex-1 space-y-4 px-4 pb-6 pt-4">
      <div className="flex items-center gap-2">
        <button
          onClick={onBack}
          aria-label="Back"
          className="clay-sm flex size-10 items-center justify-center text-navy clay-pressable"
        >
          <ChevronLeftIcon className="size-5" />
        </button>
        <h1 className="flex-1 truncate text-[20px] font-extrabold tracking-tight text-navy">
          {lot.referenceId}
        </h1>
        <StatusPill status={lot.status} />
      </div>

      {/* Material + photo */}
      <ClayCard className="rounded-3xl">
        <div className="flex gap-3">
          {lot.photoDataUrl ? (
            <img src={lot.photoDataUrl} alt="" className="size-20 rounded-2xl object-cover" />
          ) : (
            <span className="clay-flat flex size-20 items-center justify-center text-xl font-extrabold text-teal-deep">
              {lot.materialCode.slice(0, 2).toUpperCase()}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[17px] font-extrabold text-navy">{matName}</p>
            <p className="mt-0.5 text-[12.5px] text-muted2">
              {formatKg(lot.weight)} · {formatDateTime(lot.createdAt)}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {lot.aiConfidence ? (
                <ClayBadge tone="teal">
                  <SparkleIcon className="size-3" /> AI {lot.aiConfidence}%
                </ClayBadge>
              ) : (
                <ClayBadge>Manual entry</ClayBadge>
              )}
              <ClayBadge tone="neutral">{lot.condition}</ClayBadge>
              {lot.syncOrigin === "offline" && <ClayBadge tone="amber">Synced from offline</ClayBadge>}
            </div>
          </div>
        </div>
      </ClayCard>

      {/* Quote / value */}
      <ClayCard className="rounded-3xl">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted2">
              {lot.quotedPrice ? "Recycler quote" : "Estimated value"}
            </p>
            <p className="text-2xl font-extrabold text-navy">
              {lot.quotedPrice
                ? `${formatINR(lot.quotedPrice)}/kg`
                : formatINR(lot.estimatedValue)}
            </p>
          </div>
          {lot.finalSaleValue != null && (
            <div className="text-right">
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted2">Final value</p>
              <p className="text-2xl font-extrabold text-teal-deep">{formatINR(lot.finalSaleValue)}</p>
            </div>
          )}
        </div>
        {lot.status === "rejected" && (
          <p className="mt-3 rounded-2xl bg-red-50 px-3.5 py-2.5 text-[13px] font-semibold text-[var(--danger)]">
            Rejected: {lot.rejectionReason}
          </p>
        )}
      </ClayCard>

      {/* Timeline */}
      <ClayCard className="rounded-3xl">
        <p className="mb-3 text-[13px] font-bold uppercase tracking-wider text-muted2">Tracking</p>
        <Timeline steps={timeline.events} />
      </ClayCard>

      {/* Handover record */}
      {(lot.handoverRef || canConfirmHandover) && (
        <ClayCard className="rounded-3xl">
          <div className="flex items-center gap-2">
            <ShieldCheckIcon className="size-5 text-teal" />
            <p className="text-[15px] font-extrabold text-navy">{t("handover.title")}</p>
          </div>

          {lot.handoverRef ? (
            <div className="mt-3 space-y-3">
              <div className="clay-sm flex items-center justify-center rounded-2xl bg-white p-4">
                <QRCodeSVG
                  value={JSON.stringify({
                    ref: lot.referenceId,
                    handover: lot.handoverRef,
                    hash: lot.handoverHash,
                  })}
                  size={132}
                  bgColor="#ffffff"
                  fgColor="#0b1f3a"
                />
              </div>
              <div className="space-y-1.5 text-[12.5px]">
                <Row ok label={t("handover.referenceGenerated")} value={lot.handoverRef} />
                <Row ok label={t("handover.collectorConfirmed")} value={lot.handoverConfirmedByCollector ? "Yes" : "Waiting"} />
                <Row ok label={t("handover.recyclerConfirmed")} value={lot.handoverConfirmedByRecycler ? "Yes" : "Waiting"} />
                <Row ok label={t("handover.timestampRecorded")} value={formatDateTime(lot.handoverAt)} />
                <Row ok label={t("handover.locationRecorded")} value={lot.locationLabel} />
                <Row ok label="Integrity checksum (demo)" value={lot.handoverHash?.slice(0, 12) ?? "—"} />
              </div>
              <p className="rounded-2xl bg-mint px-3.5 py-2.5 text-[12px] font-semibold text-teal-deep">
                Verified Digital Handover — tamper-evident concept demo (checksum, not cryptographic).
              </p>
            </div>
          ) : (
            <div className="mt-3">
              <p className="text-[13px] text-muted2">
                Both sides confirm the physical exchange. The recycler has quoted; confirm below once the
                material changes hands.
              </p>
              {canConfirmHandover && (
                <ClayButton className="mt-3 w-full" disabled={confirming || !online} onClick={() => void confirm()}>
                  {lot.handoverConfirmedByRecycler
                    ? "Confirm handover now"
                    : "I have handed over the material"}
                </ClayButton>
              )}
              {lot.handoverConfirmedByCollector && !lot.handoverConfirmedByRecycler && (
                <p className="mt-2 flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--pending)]">
                  <ClockIcon className="size-4" /> Waiting for recycler confirmation
                </p>
              )}
            </div>
          )}
        </ClayCard>
      )}

      {/* Recycler + location */}
      <ClayCard className="rounded-3xl">
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted2">Recycler</p>
        {recycler ? (
          <p className="mt-1 text-[15px] font-extrabold text-navy">
            {recycler.name} {recycler.verified && <ShieldCheckIcon className="inline size-4 text-[var(--verified)]" />}
          </p>
        ) : (
          <p className="mt-1 text-[13px] text-muted2">Not yet assigned</p>
        )}
        <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-muted2">
          <MapPinIcon className="size-4 shrink-0" /> {lot.locationLabel}
        </p>
        <p className="mt-1 text-[12.5px] text-muted2">Collector: {collector?.name ?? "—"}</p>
      </ClayCard>

      {/* Anomaly flags (transparent, non-accusatory) */}
      {anomalyFlags.length > 0 && (
        <ClayCard className="rounded-3xl border-l-4 border-[var(--pending)]">
          <p className="text-[13px] font-extrabold text-navy">Review recommended</p>
          {anomalyFlags.map((f) => (
            <p key={f._id} className="mt-1.5 text-[12.5px] text-muted2">
              • {f.message}
            </p>
          ))}
        </ClayCard>
      )}
    </div>
  );
}

function Row({ label, value }: { ok?: boolean; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl bg-muted px-3 py-2">
      <span className="text-muted2">{label}</span>
      <span className="truncate font-bold text-navy">{value}</span>
    </div>
  );
}

function EmptyStateInline({ label, onClose }: { label: string; onClose: () => void }) {
  return (
    <div className="clay-flat rounded-3xl px-6 py-10 text-center">
      <p className="font-bold text-navy">{label}</p>
      <ClayButton variant="surface" className="mt-4" onClick={onClose}>
        Back
      </ClayButton>
    </div>
  );
}
