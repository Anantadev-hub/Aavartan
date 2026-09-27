import { Component, useEffect, useState, type ReactNode } from "react";
import {
  ChevronRightIcon, LayersIcon, MapPinIcon, RecycleIcon,
} from "@/components/icons";
import { AppHeader } from "@/components/shell";
import {
  ClayButton, ClayCard, ClayInput, ClaySection, EmptyState, LoadingState,
} from "@/components/ui/kit";
import { useAppState } from "@/lib/app-state";
import { translate, loadLang } from "@/lib/i18n";
import { formatKg, timeAgo } from "@/lib/format";
import {
  useMyPools, useNearbyPools, useMyContributions,
  useCreatePool, useUpdateMyLocation,
  useMyLots, useProfile, hasBackendId, useAuthReady,
  usePoolNotifications, useMarkNotificationsRead,
} from "@/hooks/use-kc-data";
import { cn } from "@/lib/utils";
import PoolDetail from "./PoolDetail";

// ---------------------------------------------------------------------------
// Smart Scrap Pooling (Part 2, §16/§17/§19). Privacy-preserving aggregation:
// the app shows approximate distances and area labels only — the UI never
// renders another collector's coordinates, and no GPS is collected unless the
// collector taps "Find Nearby Collectors" (manual area fallback always works).
//
// Resilience rules (this page must never render blank):
//   - GPS is requested ONLY on the "Find Nearby Collectors" tap; permission
//     denial or unavailability just opens the manual area panel.
//   - Auth-dependent queries are skipped until the auth session hydrates —
//     an unauthenticated Convex query THROWS during render ("Sign in
//     required"), which previously black-screened this page.
//   - If the backend cannot resolve the queries within POOL_LOAD_TIMEOUT_MS
//     the page shows a retryable error card, never a stuck spinner.
//   - PoolErrorBoundary catches any child render error with Retry.
// ---------------------------------------------------------------------------

type View = "main" | "create" | "detail";

const POOL_LOAD_TIMEOUT_MS = 12_000;

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

/** Error card with Retry — used when queries can't resolve (offline/backend). */
function LoadErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useAppState();
  return (
    <ClayCard className="rounded-3xl">
      <p className="text-[13px] text-muted2">{message}</p>
      <ClayButton variant="surface" size="sm" className="mt-3" onClick={onRetry}>
        {t("common.retry")}
      </ClayButton>
    </ClayCard>
  );
}

/**
 * Boundary around the whole pooling flow: a child crash shows this + Retry
 * (remounts the subtree) instead of the dark root error screen.
 */
class PoolErrorBoundary extends Component<
  { children: ReactNode; onRetry: () => void },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err: unknown) {
    console.error("[Pooling] render error:", err);
  }
  render() {
    if (this.state.hasError) {
      const t = translate(loadLang(), "pool.boundary");
      const retryLabel = translate(loadLang(), "common.retry");
      return (
        <div className="flex min-h-0 flex-1 flex-col">
          <EmptyState
            title={t}
            sub="Check your connection and try again."
            action={
              <ClayButton variant="surface" size="sm" onClick={this.props.onRetry}>
                {retryLabel}
              </ClayButton>
            }
          />
        </div>
      );
    }
    return this.props.children;
  }
}

export default function Pooling({ onClose }: { onClose: () => void }) {
  const profile = useProfile();
  const ready = hasBackendId(profile);
  const [view, setView] = useState<View>("main");
  const [detailPoolId, setDetailPoolId] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  const retry = () => setEpoch((e) => e + 1);

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
  return (
    <PoolErrorBoundary key={`pool-boundary-${epoch}`} onRetry={retry}>
      {view === "detail" && detailPoolId ? (
        <PoolDetail
          poolId={detailPoolId}
          onBack={() => {
            setDetailPoolId(null);
            setView("main");
          }}
          onRetry={retry}
        />
      ) : view === "create" ? (
        <CreatePoolForm
          onClose={() => setView("main")}
          onCreated={(poolId) => {
            setDetailPoolId(poolId);
            setView("detail");
          }}
        />
      ) : (
        <PoolingMain
          onClose={onClose}
          onOpenCreate={() => setView("create")}
          onOpenPool={(id) => {
            setDetailPoolId(id);
            setView("detail");
          }}
          onRetry={retry}
        />
      )}
    </PoolErrorBoundary>
  );
}

function PoolingMain({
  onClose, onOpenCreate, onOpenPool, onRetry,
}: {
  onClose: () => void;
  onOpenCreate: () => void;
  onOpenPool: (id: string) => void;
  onRetry: () => void;
}) {
  const { t, online, toast } = useAppState();
  const authReady = useAuthReady();
  const myPools = useMyPools({ enabled: authReady });
  const nearby = useNearbyPools(undefined, { enabled: authReady });
  const contributions = useMyContributions({ enabled: authReady });
  const notifications = usePoolNotifications({ enabled: authReady });
  const markRead = useMarkNotificationsRead();
  const updateLocation = useUpdateMyLocation();
  const [locating, setLocating] = useState(false);
  const [manualArea, setManualArea] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  // Backend-unreachable guard: queries still undefined (no live data, no
  // offline cache) after the timeout means they cannot resolve — show the
  // retryable error state (TEST 5), never a spinner forever and never a blank
  // screen. Not gated on authReady: a down backend also blocks auth hydration.
  const stillLoading =
    myPools === undefined || nearby === undefined || contributions === undefined;
  useEffect(() => {
    if (!stillLoading) {
      setTimedOut(false);
      return;
    }
    const id = setTimeout(() => setTimedOut(true), POOL_LOAD_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [stillLoading]);

  const activePools = (myPools ?? []).filter((p) =>
    !["COMPLETED", "CANCELLED", "EXPIRED"].includes(p.status),
  );
  const completedPools = (myPools ?? []).filter((p) =>
    ["COMPLETED"].includes(p.status),
  );
  const completedContribs = (contributions ?? []).filter(
    (c) => c.contributionStatus !== "WITHDRAWN" && ["COMPLETED", "MATCHED_TO_RECYCLER", "PICKUP_SCHEDULED"].includes(c.poolStatus),
  );

  // §7: one-time, explicit permission request on the button tap. No background
  // tracking, no request on page open. Every failure path keeps the UI usable.
  const requestGps = () => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setShowManual(true);
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        void saveLocation({
          latitude: Math.round(pos.coords.latitude * 1000) / 1000, // ~100 m
          longitude: Math.round(pos.coords.longitude * 1000) / 1000,
          locality: manualArea.trim() || "My area",
          poolingOptIn: true,
        });
      },
      () => {
        // Permission denied / unavailable / timeout → manual area fallback (§7).
        setLocating(false);
        setShowManual(true);
      },
      { timeout: 8000, maximumAge: 600_000 },
    );
  };

  // Location save is best-effort: failure toasts, page keeps rendering.
  const saveLocation = (args: {
    latitude: number;
    longitude: number;
    locality: string;
    poolingOptIn: boolean;
  }) =>
    updateLocation(args)
      .then(() => toast("Location saved — nearby pools updated", "success"))
      .catch(() => toast("Could not save location — try the area option", "error"));

  const saveManualArea = () => {
    const area = manualArea.trim();
    if (!area) return;
    // Manual area: a coarse, deterministic approximate point per area label.
    const seed = [...area].reduce((s, c) => (s * 31 + c.charCodeAt(0)) >>> 0, 7);
    const lat = 28.55 + (seed % 100) / 1000;
    const lng = 77.2 + ((seed >> 7) % 100) / 1000;
    void saveLocation({ latitude: lat, longitude: lng, locality: area, poolingOptIn: true });
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
              {locating ? "Locating…" : t("pool.findNearby")}
            </ClayButton>
            <ClayButton variant="surface" onClick={onOpenCreate} className="w-full">
              <LayersIcon className="size-5" />
              {t("pool.create")}
            </ClayButton>
          </div>
          <button
            onClick={() => setShowManual((v) => !v)}
            className="mt-2 text-[12.5px] font-bold text-teal-deep"
          >
            {showManual ? "Hide area selection" : t("pool.useMyArea")}
          </button>
          {showManual && (
            <div className="mt-2 flex gap-2">
              <ClayInput
                value={manualArea}
                onChange={(e) => setManualArea(e.target.value)}
                placeholder="e.g. Lajpat Nagar or 110024"
                aria-label="Your area or pincode"
              />
              <ClayButton onClick={saveManualArea} disabled={!manualArea.trim()}>
                {t("common.save")}
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
        <ClaySection title={t("pool.nearby")}>
          {nearby === undefined ? (
            timedOut ? (
              <LoadErrorCard message={t("pool.loadError")} onRetry={onRetry} />
            ) : (
              <LoadingState label={t("pool.findingNearby")} />
            )
          ) : nearby.length === 0 ? (
            <ClayCard className="rounded-3xl">
              <p className="text-[13px] text-muted2">{t("pool.nearbyEmpty")}</p>
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
        <ClaySection title={t("pool.myPools")}>
          {myPools === undefined ? (
            timedOut ? (
              <LoadErrorCard message={t("pool.loadError")} onRetry={onRetry} />
            ) : (
              <LoadingState label={t("common.loading")} />
            )
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
        <ClaySection title={t("pool.contributions")}>
          {contributions === undefined ? (
            timedOut ? (
              <LoadErrorCard message={t("pool.loadError")} onRetry={onRetry} />
            ) : (
              <LoadingState label={t("common.loading")} />
            )
          ) : (contributions ?? []).filter((c) => c.contributionStatus !== "WITHDRAWN").length === 0 ? (
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
          <ClaySection title={t("pool.completed")}>
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
  const lots = useMyLots(profile?._id as never);
  const createPool = useCreatePool();
  const [lotId, setLotId] = useState<string>("");
  const [target, setTarget] = useState("50");
  const [pickupWindowText, setPickupWindowText] = useState("Flexible");
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
      pickupWindow: pickupWindowText,
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
                    <span className="min-w-0 flex-1 truncate text-[14px] font-extrabold text-navy">
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
                value={pickupWindowText}
                onChange={(e) => setPickupWindowText(e.target.value)}
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
