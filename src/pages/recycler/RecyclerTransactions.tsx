import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  CheckCircleIcon, ClockIcon, ShieldCheckIcon, WalletIcon, ChevronLeftIcon,
} from "@/components/icons";
import { ClayButton, ClayCard, ClayBadge, StatusPill, EmptyState, LoadingState } from "@/components/ui/kit";
import { useAppState, pushToast } from "@/lib/app-state";
import { formatINR, formatKg, formatDateTime, timeAgo, aiConfidencePercent } from "@/lib/format";
import { useMaterials, useRecyclerLots, useLotDetail, type LotWithCollector } from "@/hooks/use-kc-data";
import { cn } from "@/lib/utils";

// Spec §29 filter vocabulary: All / Pending / Accepted / Handover / Completed.
type Filter = "all" | "pending" | "accepted" | "handover" | "completed";

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "accepted", label: "Accepted" },
  { key: "handover", label: "Handover" },
  { key: "completed", label: "Completed" },
];

function matchesFilter(status: string, f: Filter): boolean {
  if (f === "all") return true;
  if (f === "pending") return status === "sent";
  if (f === "accepted") return status === "accepted";
  if (f === "handover") return status === "handed_over";
  return status === "completed";
}

export default function RecyclerTransactions({ recyclerId }: { recyclerId: Id<"recyclers"> | null }) {
  const { t } = useAppState();
  const lots = useRecyclerLots(recyclerId ?? undefined);
  const { materials } = useMaterials();
  const [filter, setFilter] = useState<Filter>("all");
  const [openLotId, setOpenLotId] = useState<string | null>(null);

  if (openLotId) {
    return (
      <TransactionRecord
        lotId={openLotId as Id<"lots">}
        onBack={() => setOpenLotId(null)}
      />
    );
  }

  if (lots === undefined) return <LoadingState label={t("common.loading")} />;

  const rows = lots.filter((l) => matchesFilter(l.status, filter));
  const count = (f: Filter) => lots.filter((l) => matchesFilter(l.status, f)).length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-navy">Transactions</h1>
        <p className="mt-1 text-sm text-muted2">Quotes, handovers and payments with collectors.</p>
      </div>

      {/* Filters — spec §29: All · Pending · Accepted · Handover · Completed */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className={cn(
              "rounded-xl px-3.5 py-2 text-[12.5px] font-bold clay-pressable",
              filter === f.key ? "bg-navy text-teal" : "bg-card text-muted2 shadow-[var(--clay-1)]",
            )}
          >
            {f.label} ({count(f.key)})
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState title="Nothing here yet" sub="Transactions appear as lots move through the pipeline." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((lot: LotWithCollector) => {
            const mat = materials?.find((m) => m.code === lot.materialCode);
            return (
              <ClayCard key={lot._id} className="rounded-3xl">
                <button
                  onClick={() => setOpenLotId(lot._id)}
                  className="w-full text-left clay-pressable rounded-2xl"
                  aria-label={`Open transaction record ${lot.referenceId}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-extrabold text-navy">
                        {mat?.name ?? lot.materialCode} · {formatKg(lot.weight)}
                      </p>
                      {/* §9/§10: the collector who sold — never the signed-in recycler. */}
                      <p className="mt-0.5 text-[11.5px] text-muted2">
                        {lot.referenceId} · {lot.collectorName ?? "Collector"} · {timeAgo(lot.createdAt)}
                      </p>
                    </div>
                    <StatusPill status={lot.status} />
                  </div>

                  <div className="mt-2.5 grid grid-cols-3 gap-2 text-center">
                    <div className="clay-flat rounded-2xl px-2 py-2">
                      <p className="text-[10px] font-bold uppercase text-muted2">Quote</p>
                      <p className="text-[13px] font-extrabold text-navy">
                        {lot.quotedPrice ? `${formatINR(lot.quotedPrice)}/kg` : "—"}
                      </p>
                    </div>
                    <div className="clay-flat rounded-2xl px-2 py-2">
                      <p className="text-[10px] font-bold uppercase text-muted2">Final</p>
                      <p className="text-[13px] font-extrabold text-teal-deep">
                        {lot.finalSaleValue ? formatINR(lot.finalSaleValue) : "—"}
                      </p>
                    </div>
                    <div className="clay-flat rounded-2xl px-2 py-2">
                      <p className="text-[10px] font-bold uppercase text-muted2">Payment</p>
                      <p className="text-[13px] font-extrabold text-navy">
                        {lot.paymentStatus === "completed"
                          ? (lot.paymentMethod ?? "done").toUpperCase()
                          : lot.paymentStatus === "pending"
                            ? "Pending"
                            : "—"}
                      </p>
                    </div>
                  </div>
                </button>

                {/* Actions per status */}
                <div className="mt-3">
                  {lot.status === "accepted" && (
                    <ConfirmHandoverButton lotId={lot._id} disabled={!recyclerId} />
                  )}
                  {lot.status === "handed_over" && (
                    <CompletePaymentButton lotId={lot._id} />
                  )}
                  {lot.status === "completed" && (
                    <p className="flex items-center gap-1.5 text-[13px] font-bold text-[var(--verified)]">
                      <CheckCircleIcon className="size-4.5" /> Payment completed ·{" "}
                      {formatDateTime(lot.paymentAt)}
                    </p>
                  )}
                  {lot.status === "rejected" && (
                    <p className="text-[12.5px] text-muted2">Reason: {lot.rejectionReason}</p>
                  )}
                  {lot.status === "sent" && (
                    <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--pending)]">
                      <ClockIcon className="size-4" /> Awaiting your review in Available Lots
                    </p>
                  )}
                  {lot.status === "created" && (
                    <p className="text-[12.5px] text-muted2">
                      Not sent to any recycler yet.
                    </p>
                  )}
                </div>
              </ClayCard>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* --------------------- Full digital transaction record -------------------- */
/* The §13 Digital Material Passport view — every field both sides see. */

function TransactionRecord({ lotId, onBack }: { lotId: Id<"lots">; onBack: () => void }) {
  const { t } = useAppState();
  const data = useLotDetail(lotId); // offline-aware
  const { materials } = useMaterials();
  const [busy, setBusy] = useState(false);
  const confirmHandover = useMutation(api.lots.confirmHandover);
  const markPayment = useMutation(api.lots.markPaymentCompleted);

  // Handover actions belong on the recycler side of the record.
  const confirm = async () => {
    setBusy(true);
    try {
      await confirmHandover({ lotId, by: "recycler" });
      pushToast("Recycler handover confirmed", "success");
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "Could not confirm", "error");
    } finally {
      setBusy(false);
    }
  };

  const complete = async (method: "cash" | "upi") => {
    setBusy(true);
    try {
      await markPayment({ lotId, method });
      pushToast("Payment completed — collector ledger updated", "success");
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "Could not record payment", "error");
    } finally {
      setBusy(false);
    }
  };

  if (data === undefined) return <LoadingState label={t("common.loading")} />;
  if (data === null) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted2">Transaction record not found.</p>
        <ClayButton variant="surface" onClick={onBack}>Back</ClayButton>
      </div>
    );
  }

  const { lot, recycler, collector } = data;
  const mat = materials?.find((m) => m.code === lot.materialCode);
  const matName = mat?.name ?? lot.materialCode.toUpperCase();
  const aiPct = lot.aiConfidence != null ? aiConfidencePercent(lot.aiConfidence) : null;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-2">
        <button
          onClick={onBack}
          aria-label="Back to transactions"
          className="clay-sm flex size-10 items-center justify-center text-navy clay-pressable"
        >
          <ChevronLeftIcon className="size-5" />
        </button>
        <h1 className="flex-1 truncate text-xl font-extrabold tracking-tight text-navy">
          Transaction {lot.referenceId}
        </h1>
        <StatusPill status={lot.status} />
      </div>

      {/* Material */}
      <ClayCard className="rounded-3xl">
        <div className="flex gap-3">
          {lot.photoDataUrl ? (
            <img src={lot.photoDataUrl} alt="" className="size-24 rounded-2xl object-cover" />
          ) : (
            <span className="clay-flat flex size-24 items-center justify-center text-2xl font-extrabold text-teal-deep">
              {lot.materialCode.slice(0, 2).toUpperCase()}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-lg font-extrabold text-navy">{matName}</p>
            <p className="mt-0.5 text-[13px] text-muted2">
              {formatKg(lot.weight)} · {lot.condition}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {aiPct != null ? (
                <ClayBadge tone="teal">
                  AI {aiPct}%{lot.aiSource === "demo" ? " · demo" : ""}
                </ClayBadge>
              ) : (
                <ClayBadge>Manual entry</ClayBadge>
              )}
              <ClayBadge tone="neutral">{lot.condition}</ClayBadge>
              {lot.syncOrigin === "offline" && <ClayBadge tone="amber">Synced from offline</ClayBadge>}
            </div>
            <p className="mt-1.5 text-[12.5px] text-muted2">
              Platform estimate: <span className="font-bold text-navy">{formatINR(lot.estimatedValue)}</span>
            </p>
          </div>
        </div>
      </ClayCard>

      {/* Parties + location */}
      <ClayCard className="rounded-3xl">
        <div className="grid gap-2 text-[12.5px] sm:grid-cols-2">
          <p className="rounded-2xl bg-muted px-3.5 py-2.5">
            <span className="block text-[10.5px] font-bold uppercase tracking-wide text-muted2">Collector</span>
            {collector?.name ?? "—"}
          </p>
          <p className="rounded-2xl bg-muted px-3.5 py-2.5">
            <span className="block text-[10.5px] font-bold uppercase tracking-wide text-muted2">Recycler</span>
            {recycler?.name ?? "—"}
            {recycler?.verified ? " ✓" : ""}
          </p>
          <p className="rounded-2xl bg-muted px-3.5 py-2.5">
            <span className="block text-[10.5px] font-bold uppercase tracking-wide text-muted2">Collection location</span>
            {lot.locationLabel}
          </p>
          <p className="rounded-2xl bg-muted px-3.5 py-2.5">
            <span className="block text-[10.5px] font-bold uppercase tracking-wide text-muted2">Created</span>
            {formatDateTime(lot.createdAt)}
          </p>
        </div>
      </ClayCard>

      {/* Money */}
      <ClayCard className="rounded-3xl">
        <p className="text-[13px] font-bold uppercase tracking-wide text-muted2">Value chain</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <div className="clay-flat rounded-2xl px-3.5 py-3">
            <p className="text-[10.5px] font-bold uppercase text-muted2">Estimate</p>
            <p className="text-[15px] font-extrabold text-navy">{formatINR(lot.estimatedValue)}</p>
          </div>
          <div className="clay-flat rounded-2xl px-3.5 py-3">
            <p className="text-[10.5px] font-bold uppercase text-muted2">Quote</p>
            <p className="text-[15px] font-extrabold text-navy">
              {lot.quotedPrice ? `${formatINR(lot.quotedPrice)}/kg` : "—"}
            </p>
          </div>
          <div className="clay-flat rounded-2xl px-3.5 py-3">
            <p className="text-[10.5px] font-bold uppercase text-muted2">Final sale</p>
            <p className="text-[15px] font-extrabold text-teal-deep">
              {lot.finalSaleValue ? formatINR(lot.finalSaleValue) : "—"}
            </p>
          </div>
        </div>
        {lot.quotedAt && (
          <p className="mt-2 text-[11.5px] text-muted2">Quoted {formatDateTime(lot.quotedAt)}</p>
        )}
      </ClayCard>

      {/* Handover verification record (§11) */}
      {lot.handoverRef && (
        <ClayCard className="rounded-3xl">
          <div className="flex items-center gap-2">
            <ShieldCheckIcon className="size-5 text-teal" />
            <p className="text-[15px] font-extrabold text-navy">Handover verification</p>
          </div>
          <div className="mt-3 space-y-1.5 text-[12.5px]">
            <RecRow label="Reference" value={lot.handoverRef} />
            <RecRow label="Collector confirmed" value={lot.handoverConfirmedByCollector ? "Yes" : "Waiting"} />
            <RecRow label="Recycler confirmed" value={lot.handoverConfirmedByRecycler ? "Yes" : "Waiting"} />
            <RecRow label="Timestamp" value={formatDateTime(lot.handoverAt)} />
            <RecRow label="Location" value={lot.locationLabel} />
            <RecRow label="Integrity checksum (demo)" value={lot.handoverHash?.slice(0, 12) ?? "—"} />
          </div>
        </ClayCard>
      )}

      {/* Lifecycle actions for the recycler */}
      {lot.status === "accepted" && (
        <ClayButton className="w-full" disabled={busy} onClick={() => void confirm()}>
          <ShieldCheckIcon className="size-5" /> Confirm Handover
        </ClayButton>
      )}
      {lot.status === "handed_over" && (
        <div className="grid grid-cols-2 gap-2">
          <ClayButton variant="surface" disabled={busy} onClick={() => void complete("cash")}>
            Cash
          </ClayButton>
          <ClayButton disabled={busy} onClick={() => void complete("upi")}>
            <WalletIcon className="size-5" /> UPI
          </ClayButton>
        </div>
      )}
      {lot.status === "completed" && (
        <p className="flex items-center justify-center gap-1.5 text-[13.5px] font-bold text-[var(--verified)]">
          <CheckCircleIcon className="size-4.5" /> Payment completed · {formatDateTime(lot.paymentAt)}
        </p>
      )}
    </div>
  );
}

function RecRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl bg-muted px-3 py-2">
      <span className="text-muted2">{label}</span>
      <span className="truncate font-bold text-navy">{value}</span>
    </div>
  );
}

/* ------------------------------ Row actions ------------------------------ */

function ConfirmHandoverButton({ lotId, disabled }: { lotId: Id<"lots">; disabled?: boolean }) {
  const confirmHandover = useMutation(api.lots.confirmHandover);
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    try {
      await confirmHandover({ lotId, by: "recycler" });
      pushToast("Recycler handover confirmed", "success");
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "Could not confirm", "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <ClayButton size="md" className="w-full" disabled={busy || disabled} onClick={() => void confirm()}>
      <ShieldCheckIcon className="size-5" /> Confirm Handover
    </ClayButton>
  );
}

function CompletePaymentButton({ lotId }: { lotId: Id<"lots"> }) {
  const markPayment = useMutation(api.lots.markPaymentCompleted);
  const [busy, setBusy] = useState(false);
  const complete = async (method: "cash" | "upi") => {
    setBusy(true);
    try {
      await markPayment({ lotId, method });
      pushToast("Payment completed — collector ledger updated", "success");
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "Could not record payment", "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid grid-cols-2 gap-2">
      <ClayButton variant="surface" disabled={busy} onClick={() => void complete("cash")}>
        Cash
      </ClayButton>
      <ClayButton disabled={busy} onClick={() => void complete("upi")}>
        <WalletIcon className="size-5" /> UPI
      </ClayButton>
    </div>
  );
}
