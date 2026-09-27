import { useState, useEffect } from "react";
import { RecycleIcon, TruckIcon, LotsIcon } from "@/components/icons";
import { AppHeader } from "@/components/shell";
import {
  ClayBadge, ClayButton, ClayCard, ClayInput, ClaySection, EmptyState, LoadingState,
} from "@/components/ui/kit";
import { useAppState } from "@/lib/app-state";
import { formatKg, formatINR } from "@/lib/format";
import {
  usePoolDetail, usePoolRecyclerOptions, useJoinPool, useLeavePool,
  useSaveTransportEstimate, useMatchPoolToRecycler, useSchedulePickup,
  useCompletePool, useMyLots, useProfile, useAuthReady,
} from "@/hooks/use-kc-data";


const STATUS_LABEL: Record<string, string> = {
  OPEN: "Open",
  FILLING: "Filling",
  TARGET_REACHED: "Target reached",
  MATCHED_TO_RECYCLER: "Recycler matched",
  PICKUP_SCHEDULED: "Pickup scheduled",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
};

export default function PoolDetail({
  poolId, onBack, onRetry,
}: {
  poolId: string;
  onBack: () => void;
  onRetry?: () => void;
}) {
  const { t, toast } = useAppState();
  const authReady = useAuthReady();
  // Auth-gated: an unauthenticated Convex query THROWS during render
  // ("Sign in required") — skip until the session hydrates.
  const pool = usePoolDetail(poolId, { enabled: authReady });
  const joinPool = useJoinPool();
  const leavePool = useLeavePool();
  const saveTransport = useSaveTransportEstimate();
  const matchToRecycler = useMatchPoolToRecycler();
  const schedulePickup = useSchedulePickup();
  const completePool = useCompletePool();

  const [showJoin, setShowJoin] = useState(false);
  const [transport, setTransport] = useState("");
  const [busy, setBusy] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  // Backend-unreachable guard (same contract as PoolingMain): a stuck
  // "loading" resolves to a retryable error card, never an infinite spinner.
  useEffect(() => {
    if (pool !== undefined) {
      setTimedOut(false);
      return;
    }
    const id = setTimeout(() => setTimedOut(true), 12_000);
    return () => clearTimeout(id);
  }, [pool]);

  const run = (fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(true);
    fn()
      .then(() => toast(okMsg, "success"))
      .catch((e) => toast(e instanceof Error ? e.message : "Action failed", "error"))
      .finally(() => setBusy(false));
  };

  if (pool === undefined) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <AppHeader title="Smart Pool" onBack={onBack} />
        <div className="flex-1 overflow-y-auto px-4 pt-4">
          {timedOut ? (
            <EmptyState
              title="Unable to load this pool right now."
              sub="Check your connection and try again."
              action={
                <ClayButton variant="surface" size="sm" onClick={() => onRetry?.()}>
                  {t("common.retry")}
                </ClayButton>
              }
            />
          ) : (
            <LoadingState label={t("common.loading")} />
          )}
        </div>
      </div>
    );
  }
  if (pool === null) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <AppHeader title="Smart Pool" onBack={onBack} />
        <div className="flex-1 overflow-y-auto px-4 pt-4">
          <EmptyState
            title="Pool not found"
            sub="It may have been cancelled or expired."
            action={
              onRetry ? (
                <ClayButton variant="surface" size="sm" onClick={() => onRetry?.()}>
                  {t("common.retry")}
                </ClayButton>
              ) : undefined
            }
          />
        </div>
      </div>
    );
  }

  const pct = Math.min(100, Math.round((pool.currentQuantityKg / Math.max(1, pool.targetQuantityKg)) * 100));
  const joinable = ["OPEN", "FILLING"].includes(pool.status);
  const estCost = pool.transportCostEstimate;
  const pooledPerKg = estCost != null && pool.currentQuantityKg > 0
    ? Math.round((estCost / pool.currentQuantityKg) * 10) / 10
    : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AppHeader title={`Smart Pool ${pool.poolRef}`} onBack={onBack} />
      <main className="flex-1 space-y-4 overflow-y-auto px-4 pb-8 pt-4">
        <ClayCard className="rounded-3xl">
          <div className="flex items-center justify-between">
            <p className="text-lg font-extrabold text-navy">{pool.materialCode.toUpperCase()}</p>
            <ClayBadge tone={pool.status === "COMPLETED" ? "green" : joinable ? "teal" : "gold"}>
              {STATUS_LABEL[pool.status] ?? pool.status}
            </ClayBadge>
          </div>
          <div className="clay-track mt-3 h-4 overflow-hidden rounded-full">
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,#047857,#10B981)] transition-all"
              style={{ width: `${Math.max(6, pct)}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-[13px]">
            <span className="font-extrabold text-navy">
              {formatKg(pool.currentQuantityKg)} / {formatKg(pool.targetQuantityKg)}
            </span>
            <span className="flex items-center gap-1 text-muted2">
              <LotsIcon className="size-4" /> {pool.contributors} collector{pool.contributors > 1 ? "s" : ""}
            </span>
          </div>
          <p className="mt-2 text-[12px] text-muted2">
            Area: {pool.approximateArea} · Pickup: {pool.pickupWindow}
            {pool.myContributionKg > 0 ? ` · You: ${formatKg(pool.myContributionKg)}` : ""}
          </p>
        </ClayCard>

        {/* §14 estimated transportation economics */}
        <ClaySection title="Estimated transportation economics">
          <ClayCard className="rounded-3xl">
            <div className="flex items-center gap-2 text-[12.5px] text-muted2">
              <TruckIcon className="size-4 shrink-0 text-teal" />
              <span>Calculations only — not guaranteed savings. Cost is entered by users/recycler.</span>
            </div>
            <div className="mt-3 flex gap-2">
              <ClayInput
                inputMode="decimal"
                value={transport}
                onChange={(e) => setTransport(e.target.value)}
                placeholder={estCost != null ? `Current ₹${estCost}` : "Total transport cost ₹"}
                aria-label="Total transport cost"
              />
              <ClayButton
                onClick={() =>
                  run(
                    () => saveTransport({ poolId: pool._id as never, transportCost: Number(transport) || 0 }),
                    "Estimate saved",
                  )
                }
                disabled={!transport || busy}
              >
                Save
              </ClayButton>
            </div>
            {pooledPerKg !== null && (
              <div className="mt-3 grid grid-cols-2 gap-2.5">
                <div className="clay-sm rounded-2xl px-3.5 py-2.5 text-center">
                  <p className="text-lg font-extrabold text-navy">{formatINR(pooledPerKg)}</p>
                  <p className="text-[10.5px] font-semibold text-muted2">pooled transport / kg</p>
                </div>
                <div className="clay-sm rounded-2xl px-3.5 py-2.5 text-center">
                  <p className="text-lg font-extrabold text-navy">
                    {estCost != null ? formatINR(estCost) : "—"}
                  </p>
                  <p className="text-[10.5px] font-semibold text-muted2">total for {formatKg(pool.currentQuantityKg)}</p>
                </div>
              </div>
            )}
          </ClayCard>
        </ClaySection>

        {/* Actions */}
        <ClaySection title="Actions">
          <div className="space-y-2.5">
            {joinable && !pool.isCreator && (
              <ClayButton className="w-full" onClick={() => setShowJoin((v) => !v)}>
                Join Pool
              </ClayButton>
            )}
            {showJoin && <JoinPicker poolId={pool._id} materialCode={pool.materialCode} onDone={() => setShowJoin(false)} />}
            {pool.isCreator && joinable && (
              <RecyclerOptionsCard
                poolId={pool._id}
                enabled={authReady}
                onMatch={(recyclerId) =>
                  run(() => matchToRecycler({ poolId: pool._id as never, recyclerId: recyclerId as never }), "Recycler matched")
                }
              />
            )}
            {pool.isCreator && pool.status === "MATCHED_TO_RECYCLER" && (
              <ClayButton
                className="w-full"
                variant="surface"
                onClick={() => run(() => schedulePickup({ poolId: pool._id as never, pickupWindow: pool.pickupWindow }), "Pickup scheduled")}
                disabled={busy}
              >
                Schedule Pickup
              </ClayButton>
            )}
            {pool.isCreator && ["MATCHED_TO_RECYCLER", "PICKUP_SCHEDULED"].includes(pool.status) && (
              <ClayButton
                className="w-full"
                onClick={() => run(() => completePool({ poolId: pool._id as never }), "Pool completed")}
                disabled={busy}
              >
                Mark Completed
              </ClayButton>
            )}
            {pool.myContributionKg > 0 && !["COMPLETED", "CANCELLED", "EXPIRED", "PICKUP_SCHEDULED"].includes(pool.status) && (
              <ClayButton
                className="w-full"
                variant="surface"
                onClick={() => run(() => leavePool({ poolId: pool._id as never }), pool.isCreator ? "Pool cancelled" : "You left the pool")}
                disabled={busy}
              >
                {pool.isCreator ? "Cancel Pool" : "Leave Pool"}
              </ClayButton>
            )}
          </div>
        </ClaySection>

        <p className="px-1 text-[11px] leading-relaxed text-muted2">
          Each collector's lot keeps its own record: earnings stay per-collector through the normal
          handover and payment flow. Exact addresses and coordinates are never shared.
        </p>
      </main>
    </div>
  );
}

/** Pick one of YOUR compatible lots to contribute (G7/G8 enforced server-side). */
function JoinPicker({ poolId, materialCode, onDone }: { poolId: string; materialCode: string; onDone: () => void }) {
  const { toast } = useAppState();
  const authReady = useAuthReady();
  const profile = useProfile();
  const lots = useMyLots(authReady ? (profile?._id as never) : undefined);
  const joinPool = useJoinPool();
  const [busy, setBusy] = useState(false);
  const eligible = (lots ?? []).filter(
    (l) => l.materialCode === materialCode && ["created", "sent", "rejected"].includes(l.status),
  );
  return (
    <ClayCard className="rounded-3xl">
      <p className="text-[13px] font-bold uppercase tracking-wide text-muted2">
        Your {materialCode.toUpperCase()} lots
      </p>
      {eligible.length === 0 ? (
        <p className="mt-2 text-[13px] text-muted2">
          No compatible lots — this pool accepts {materialCode.toUpperCase()} only.
        </p>
      ) : (
        <div className="mt-2 space-y-2">
          {eligible.map((l) => (
            <button
              key={l._id}
              disabled={busy}
              onClick={() => {
                setBusy(true);
                joinPool({ poolId: poolId as never, lotId: l._id })
                  .then(() => {
                    toast("Joined pool — thanks for contributing!", "success");
                    onDone();
                  })
                  .catch((e) => toast(e instanceof Error ? e.message : "Could not join", "error"))
                  .finally(() => setBusy(false));
              }}
              className="clay-sm flex w-full items-center justify-between rounded-2xl p-3 text-left clay-pressable"
            >
              <span className="text-[13.5px] font-extrabold text-navy">{l.referenceId}</span>
              <span className="text-[13px] font-bold text-teal-deep">{formatKg(l.weight)}</span>
            </button>
          ))}
        </div>
      )}
    </ClayCard>
  );
}

/** §15 compatible recycler options for a pool. */
function RecyclerOptionsCard({
  poolId, enabled, onMatch,
}: {
  poolId: string;
  enabled: boolean;
  onMatch: (recyclerId: string) => void;
}) {
  const options = usePoolRecyclerOptions(poolId, { enabled });
  const [open, setOpen] = useState(false);
  if (options === undefined || options === null) return null;
  return (
    <ClayCard className="rounded-3xl">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between">
        <span className="flex items-center gap-2 text-[14px] font-extrabold text-navy">
          <RecycleIcon className="size-5 text-teal" /> View recycler options
        </span>
        <span className="text-[12px] font-bold text-teal-deep">{options.options.length}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-2.5">
          {options.options.length === 0 && (
            <p className="text-[13px] text-muted2">No compatible recyclers for this material yet.</p>
          )}
          {options.options.map((o) => (
            <div key={o.recyclerId} className="clay-sm rounded-2xl p-3.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[14px] font-extrabold text-navy">{o.recyclerName}</p>
                <p className="text-[14px] font-extrabold text-teal-deep">
                  {formatINR(o.quotePerKg)}/kg
                </p>
              </div>
              <p className="mt-1 text-[11.5px] text-muted2">
                {o.quoteIsLive ? "Live recycler quote" : "Board rate"} ·{" "}
                {o.minimumQuantityKg != null ? `min ${formatKg(o.minimumQuantityKg)} · ` : ""}
                {o.pickupAvailable ? "pickup available" : "walk-in"} · ~{o.distanceKm} km
                {o.validUntil != null
                  ? ` · valid till ${new Date(o.validUntil).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}`
                  : ""}
              </p>
              <ClayButton className="mt-2 w-full" onClick={() => onMatch(o.recyclerId)}>
                Match this recycler
              </ClayButton>
            </div>
          ))}
        </div>
      )}
    </ClayCard>
  );
}
