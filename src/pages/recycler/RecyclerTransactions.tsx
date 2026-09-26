import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { CheckCircleIcon, ClockIcon, ShieldCheckIcon, WalletIcon } from "@/components/icons";
import { ClayButton, ClayCard, ClayBadge, StatusPill, EmptyState, LoadingState } from "@/components/ui/kit";
import { useAppState, pushToast } from "@/lib/app-state";
import { formatINR, formatKg, formatDateTime, timeAgo } from "@/lib/format";
import { useMaterials, useRecyclerLots, useProfile } from "@/hooks/use-kc-data";
import { cn } from "@/lib/utils";

type Filter = "active" | "completed" | "rejected" | "all";

export default function RecyclerTransactions({ recyclerId }: { recyclerId: Id<"recyclers"> }) {
  const { t } = useAppState();
  const lots = useRecyclerLots(recyclerId);
  const { materials } = useMaterials();
  const profile = useProfile();
  const [filter, setFilter] = useState<Filter>("active");

  if (lots === undefined) return <LoadingState label={t("common.loading")} />;

  const active = lots.filter((l) => ["accepted", "handed_over"].includes(l.status));
  const completed = lots.filter((l) => l.status === "completed");
  const rejected = lots.filter((l) => l.status === "rejected");
  const rows =
    filter === "active" ? active : filter === "completed" ? completed : filter === "rejected" ? rejected : lots;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-navy">Transactions</h1>
        <p className="mt-1 text-sm text-muted2">Quotes, handovers and payments with collectors.</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {(
          [
            { key: "active", label: `Active (${active.length})` },
            { key: "completed", label: `Completed (${completed.length})` },
            { key: "rejected", label: `Rejected (${rejected.length})` },
            { key: "all", label: `All (${lots.length})` },
          ] as const
        ).map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className={cn(
              "rounded-xl px-3.5 py-2 text-[12.5px] font-bold clay-pressable",
              filter === f.key ? "bg-navy text-teal" : "bg-card text-muted2 shadow-[var(--clay-1)]",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState title="Nothing here yet" sub="Transactions will appear as lots move through the pipeline." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((lot) => {
            const mat = materials?.find((m) => m.code === lot.materialCode);
            return (
              <ClayCard key={lot._id} className="rounded-3xl">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-extrabold text-navy">
                      {mat?.name ?? lot.materialCode} · {formatKg(lot.weight)}
                    </p>
                    <p className="mt-0.5 text-[11.5px] text-muted2">
                      {lot.referenceId} · {profile?.name ?? "Collector"} · {timeAgo(lot.createdAt)}
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

                {/* Actions per status */}
                <div className="mt-3">
                  {lot.status === "accepted" && (
                    <ConfirmHandoverButton lotId={lot._id} />
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
                </div>
              </ClayCard>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ConfirmHandoverButton({ lotId }: { lotId: Id<"lots"> }) {
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
    <ClayButton size="md" className="w-full" disabled={busy} onClick={() => void confirm()}>
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
