import { useMemo, useState } from "react";
import {
  ChevronRightIcon, LayersIcon, MapPinIcon, RecycleIcon, TruckIcon,
} from "@/components/icons";
import { AppHeader } from "@/components/shell";
import {
  ClayBadge, ClayButton, ClayCard, ClayInput, ClaySection, EmptyState, LoadingState,
} from "@/components/ui/kit";
import { useAppState } from "@/lib/app-state";
import { formatKg, formatINR, timeAgo } from "@/lib/format";
import {
  useMyPools, useNearbyPools, useNearbyCollectors, useMyContributions,
  useUpdateMyLocation, useCreatePool, useJoinPool, useLeavePool,
  useSaveTransportEstimate, useMatchPoolToRecycler, useSchedulePickup,
  useCompletePool, useMyLots, useProfile, hasBackendId,
  usePoolNotifications, useMarkNotificationsRead,
} from "@/hooks/use-kc-data";
import { cn } from "@/lib/utils";
import PoolDetail from "./PoolDetail";

// ---------------------------------------------------------------------------
// Smart Scrap Pooling (Part 2, §16/§17/§19). Privacy-preserving aggregation:
// the app shows approximate distances and area labels only — the UI never
// renders another collector's coordinates, and no GPS is collected unless the
// collector taps "Find Nearby Collectors" (manual area fallback always works).
// ---------------------------------------------------------------------------

type View = "main" | "create" | "detail";

const POOL_STATUS_LABEL: Record<string, string> = {
  OPEN: "Open",
  FILLING: "Filling",
  TARGET_REACHED: "Target reached",
  MATCHED_TO_RECYCLER: "Recycler matched",
  PICKUP_SCHEDULED: "Pickup scheduled",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
};

export default function Pooling({ onClose }: { onClose: () => void }) {
  const { t, online } = useAppState();
  const profile = useProfile();
  const ready = hasBackendId(profile);
  const [view, setView] = useState<View>("main");
  const [detailPoolId, setDetailPoolId] = useState<string | null>(null);

  if (!ready) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <AppHeader title="Smart Scrap Pooling" onBack={onClose} />
        <div className="flex-1 overflow-y-auto px-4 pt-4">
          <EmptyState
            title="Account syncing"
            sub="Pooling becomes available the moment your account is connected."
          />
        </div>
      </div>
    );
  }
  if (view === "detail" && detailPoolId) {
    return (
      <PoolDetail
        poolId={detailPoolId}
        onBack={() => {
          setDetailPoolId(null);
          setView("main");
        }}
      />
    );
  }
  if (view === "create") {
    return (
      <CreatePoolForm
        onClose={() => setView("main")}
        onCreated={(poolId) => {
          setDetailPoolId(poolId);
          setView("detail");
        }}
      />
    );
  }
  return (
    <PoolingMain
      onClose={onClose}
      onOpenCreate={() => setView("create")}
      onOpenPool={(id) => {
        setDetailPoolId(id);
        setView("detail");
      }}
    />
  );
}

function PoolingMain({
  onClose, onOpenCreate, onOpenPool,
}: {
  onClose: () => void;
  onOpenCreate: () => void;
  onOpenPool: (id: string) => void;
}) {
  const { t, online, toast } = useAppState();
  const profile = useProfile();
  const myPools = useMyPools();
  const nearby = useNearbyPools();
  const contributions = useMyContributions();
  const updateLocation = useUpdateMyLocation();
  const notifications = usePoolNotifications();
  const markRead = useMarkNotificationsRead();
  const [locating, setLocating] = useState(false);
  const [manualArea, setManualArea] = useState("");
  const [showManual, setShowManual] = useState(false);

  const activePools = (myPools ?? []).filter((p) =>
    !["COMPLETED", "CANCELLED", "EXPIRED"].includes(p.status),
  );
  const completedPools = (myPools ?? []).filter((p) =>
    ["COMPLETED"].includes(p.status),
  );
  const completedContribs = (contributions ?? []).filter(
    (c) => c.contributionStatus !== "WITHDRAWN" && ["COMPLETED", "MATCHED_TO_RECYCLER", "PICKUP_SCHEDULED"].includes(c.poolStatus),
  );

  // §7: one-time, explicit permission request. No background tracking.
  const requestGps = () => {
    if (!("geolocation" in navigator)) {
      setShowManual(true);
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        void updateLocation({
          latitude: Math.round(pos.coords.latitude * 1000) / 1000, // ~100 m
          longitude: Math.round(pos.coords.longitude * 1000) / 1000,
          locality: manualArea.trim() || "My area",
          poolingOptIn: true,
        })
          .then(() => toast("Location saved — nearby pools updated", "success"))
          .catch(() => toast("Could not save location — try the area option", "error"));
      },
      () => {
        // Permission denied → manual area fallback (§7).
        setLocating(false);
        setShowManual(true);
      },
      { timeout: 8000, maximumAge: 600_000 },
    );
  };

  const saveManualArea = () => {
    const area = manualArea.trim();
    if (!area) return;
    // Manual area: a coarse, deterministic approximate point per area label.
    const seed = [...area].reduce((s, c) => (s * 31 + c.charCodeAt(0)) >>> 0, 7);
    const lat = 28.55 + (seed % 100) / 1000;
    const lng = 77.2 + ((seed >> 7) % 100) / 1000;
    void updateLocation({ latitude: lat, longitude: lng, locality: area, poolingOptIn: true })
      .then(() => toast("Area saved — nearby pools updated", "success"))
      .catch(() => toast("Could not save area — try again", "error"));
    setShowManual(false);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AppHeader title="Smart Scrap Pooling" onBack={onClose} />
      <main className="flex-1 overflow-y-auto px-4 pb-8 pt-4">
        {!online && (
          <p className="mb-3 rounded-2xl bg-muted px-3.5 py-2.5 text-[12.5px] font-semibold text-muted2">
            {t("common.offline")} — changes will sync when you're connected.
          </p>
        )}

        {/* Intro card (§26 framing) */}
        <ClayCard className="rounded-3xl">
          <div className="flex items-start gap-3">
            <span className="clay-sm flex size-11 shrink-0 items-center justify-center text-teal">
              <RecycleIcon className="size-6" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-extrabold text-navy">Have a small quantity?</p>
              <p className="mt-1 text-[13px] leading-snug text-muted2">
                Pool with nearby collectors so shared transport becomes viable. Your exact
                location is never shown — neighbours see only an approximate distance and area.
              </p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            <ClayButton onClick={requestGps} disabled={locating} className="w-full">
              <MapPinIcon className="size-5" />
              {locating ? "Locating…" : "Find Nearby"}
            </ClayButton>
            <ClayButton variant="surface" onClick={onOpenCreate} className="w-full">
              <LayersIcon className="size-5" />
              Create Pool
            </ClayButton>
          </div>
          <button
            onClick={() => setShowManual((v) => !v)}
            className="mt-2 text-[12.5px] font-bold text-teal-deep"
          >
            {showManual ? "Hide area selection" : "Or select your area manually (no GPS)"}
          </button>
          {showManual && (
            <div className="mt-2 flex gap-2">
              <ClayInput
                value={manualArea}
                onChange={(e) => setManualArea(e.target.value)}
                placeholder="e.g. Lajpat Nagar"
                aria-label="Your area"
              />
              <ClayButton onClick={saveManualArea} disabled={!manualArea.trim()}>
                Save
              </ClayButton>
            </div>
          )}
        </ClayCard>

        {/* In-app notifications (§18) */}
        {notifications && notifications.length > 0 && (
          <ClaySection title="Updates">
            <div className="space-y-2">
              {notifications.slice(0, 4).map((n) => (
                <div
                  key={n._id}
                  className={cn(
                    "clay-sm rounded-2xl px-3.5 py-2.5",
                    !n.readAt && "ring-2 ring-teal/60",
                  )}
                >
                  <p className="text-[13px] font-extrabold text-navy">{n.title}</p>
                  <p className="text-[11.5px] leading-snug text-muted2">{n.body}</p>
                </div>
              ))}
              {notifications.some((n) => !n.readAt) && (
                <button
                  onClick={() => void markRead({})}
                  className="text-[12px] font-bold text-teal-deep"
                >
                  Mark all as read
                </button>
              )}
            </div>
          </ClaySection>
        )}

        {/* Nearby pool opportunities */}
        <ClaySection title="Nearby pool opportunities">
          {nearby === undefined ? (
            <LoadingState label={t("common.loading")} />
          ) : nearby.length === 0 ? (
            <ClayCard className="rounded-3xl">
              <p className="text-[13px] text-muted2">
                No open pools nearby yet — create one and neighbours can join.
              </p>
            </ClayCard>
          ) : (
            <div className="space-y-2.5">
              {nearby.map((p) => (
                <button
                  key={p.poolId}
                  onClick={() => onOpenPool(p.poolId)}
                  className="clay-sm flex w-full items-center gap-3 rounded-2xl p-3.5 text-left clay-pressable"
                >
                  <span className="clay-flat flex size-11 shrink-0 items-center justify-center text-[13px] font-extrabold text-teal-deep">
                    {p.materialCode.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14.5px] font-extrabold text-navy">
                      {p.materialCode.toUpperCase()} · {formatKg(p.currentQuantityKg)} / {formatKg(p.targetQuantityKg)}
                    </span>
                    <span className="mt-0.5 block text-[12px] text-muted2">
                      {p.approxDistanceKm != null ? `~${p.approxDistanceKm} km · ` : ""}
                      {p.approximateArea} · {p.contributors} collector{p.contributors > 1 ? "s" : ""}
                    </span>
                  </span>
                  <ChevronRightIcon className="size-5 shrink-0 text-muted2" />
                </button>
              ))}
            </div>
          )}
        </ClaySection>

        {/* My active pools */}
        <ClaySection title="My active pools">
          {myPools === undefined ? (
            <LoadingState label={t("common.loading")} />
          ) : activePools.length === 0 ? (
            <ClayCard className="rounded-3xl">
              <p className="text-[13px] text-muted2">You have no active pools.</p>
            </ClayCard>
          ) : (
            <div className="space-y-2.5">
              {activePools.map((p) => (
                <PoolRowCard key={p._id} pool={p} onOpen={() => onOpenPool(p._id)} />
              ))}
            </div>
          )}
        </ClaySection>

        {/* My contributions */}
        <ClaySection title="My contributions">
          {(contributions ?? []).filter((c) => c.contributionStatus !== "WITHDRAWN").length === 0 ? (
            <ClayCard className="rounded-3xl">
              <p className="text-[13px] text-muted2">No contributions yet.</p>
            </ClayCard>
          ) : (
            <div className="space-y-2">
              {(contributions ?? [])
                .filter((c) => c.contributionStatus !== "WITHDRAWN")
                .slice(0, 6)
                .map((c) => (
                  <div key={c.contributionId} className="clay-sm rounded-2xl px-3.5 py-2.5">
                    <p className="text-[13px] font-extrabold text-navy">
                      {c.lotReferenceId} · {formatKg(c.quantityKg)} → {c.poolRef}
                    </p>
                    <p className="text-[11.5px] text-muted2">
                      {c.materialCode.toUpperCase()} · {POOL_STATUS_LABEL[c.poolStatus] ?? c.poolStatus}
                    </p>
                  </div>
                ))}
            </div>
          )}
        </ClaySection>

        {/* Completed */}
        {completedPools.length + completedContribs.length > 0 && (
          <ClaySection title="Completed pools">
            <div className="space-y-2">
              {completedPools.map((p) => (
                <PoolRowCard key={p._id} pool={p} onOpen={() => onOpenPool(p._id)} />
              ))}
              {completedContribs.map((c) => (
                <div key={c.contributionId} className="clay-sm rounded-2xl px-3.5 py-2.5">
                  <p className="text-[13px] font-bold text-navy">
                    {c.poolRef} · {formatKg(c.quantityKg)} delivered
                  </p>
                </div>
              ))}
            </div>
          </ClaySection>
        )}

        <p className="px-1 text-[11px] leading-relaxed text-muted2">
          Pooling is privacy-preserving local aggregation: it helps small collectors consolidate
          compatible e-waste before transportation. Distances are approximate.
        </p>
      </main>
    </div>
  );
}

function PoolRowCard({ pool, onOpen }: { pool: NonNullable<ReturnType<typeof useMyPools>>[number]; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="clay-sm flex w-full items-center gap-3 rounded-2xl p-3.5 text-left clay-pressable"
    >
      <span className="clay-flat flex size-11 shrink-0 items-center justify-center text-[13px] font-extrabold text-teal-deep">
        {pool.materialCode.slice(0, 2).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px] font-extrabold text-navy">
          {pool.poolRef} · {formatKg(pool.currentQuantityKg)} / {formatKg(pool.targetQuantityKg)}
        </span>
        <span className="mt-0.5 block text-[12px] text-muted2">
          {POOL_STATUS_LABEL[pool.status] ?? pool.status} · {pool.contributors} collector
          {pool.contributors > 1 ? "s" : ""} · {timeAgo(pool.createdAt)}
        </span>
      </span>
      <ChevronRightIcon className="size-5 shrink-0 text-muted2" />
    </button>
  );
}

/* --------------------------- Create pool form --------------------------- */

function CreatePoolForm({ onClose, onCreated }: { onClose: () => void; onCreated: (poolId: string) => void }) {
  const { t, toast, online } = useAppState();
  const profile = useProfile();
  const lots = useMyLots(profile?._id);
  const createPool = useCreatePool();
  const [lotId, setLotId] = useState<string>("");
  const [target, setTarget] = useState("50");
  const [window, setWindow] = useState("Flexible");
  const [transport, setTransport] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const eligible = (lots ?? []).filter((l) =>
    ["created", "sent", "rejected"].includes(l.status),
  );

  const submit = () => {
    if (!lotId) return;
    setSubmitting(true);
    createPool({
      lotId: lotId as never,
      targetQuantityKg: Number(target) || 0,
      pickupWindow: window,
      transportCostEstimate: transport ? Number(transport) : undefined,
    })
      .then((res) => onCreated(res.poolId))
      .catch((e) => toast(e instanceof Error ? e.message : "Could not create pool", "error"))
      .finally(() => setSubmitting(false));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AppHeader title="Create Pool" onBack={onClose} />
      <main className="flex-1 space-y-4 overflow-y-auto px-4 pb-8 pt-4">
        {!online && (
          <p className="rounded-2xl bg-muted px-3.5 py-2.5 text-[12.5px] font-semibold text-muted2">
            {t("common.offline")} — your pool will be created when you're connected.
          </p>
        )}
        {eligible.length === 0 ? (
          <EmptyState
            title="No eligible lots"
            sub="Create a lot first (Add E-Waste), then pool it from here. Only your own lots can be pooled."
          />
        ) : (
          <>
            <ClaySection title="Choose your lot">
              <div className="space-y-2">
                {eligible.map((l) => (
                  <button
                    key={l._id}
                    onClick={() => setLotId(l._id)}
                    aria-pressed={lotId === l._id}
                    className={cn(
                      "clay-sm flex w-full items-center justify-between rounded-2xl p-3.5 text-left clay-pressable",
                      lotId === l._id && "ring-2 ring-teal",
                    )}
                  >
                    <span className="text-[14px] font-extrabold text-navy">
                      {l.referenceId} · {l.materialCode.toUpperCase()}
                    </span>
                    <span className="text-[13px] font-bold text-teal-deep">{formatKg(l.weight)}</span>
                  </button>
                ))}
              </div>
            </ClaySection>
            <ClaySection title="Target pooled quantity (kg)">
              <ClayInput
                inputMode="decimal"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="50"
              />
            </ClaySection>
            <ClaySection title="Pickup / transport window">
              <ClayInput
                value={window}
                onChange={(e) => setWindow(e.target.value)}
                placeholder="e.g. Weekday mornings"
              />
            </ClaySection>
            <ClaySection title="Estimated transport cost (₹, optional)">
              <ClayInput
                inputMode="decimal"
                value={transport}
                onChange={(e) => setTransport(e.target.value)}
                placeholder="e.g. 900"
              />
              <p className="mt-1.5 text-[11.5px] text-muted2">
                Entered by you or the recycler — used only for the estimated transport
                calculation, never presented as an actual price.
              </p>
            </ClaySection>
            <ClayButton className="w-full" onClick={submit} disabled={!lotId || submitting}>
              {submitting ? "Creating…" : "Create Pool"}
            </ClayButton>
          </>
        )}
      </main>
    </div>
  );
}
