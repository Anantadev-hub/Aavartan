import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  BuildingIcon, GridIcon, LayersIcon, LogOutIcon, MapPinIcon, PhoneIcon, RecycleIcon,
  ShieldCheckIcon, StarIcon, TruckIcon, ClockIcon, WalletIcon,
} from "@/components/icons";
import { ClayButton, ClayCard, ClayBadge, LoadingState, OfflineBanner, Toasts, SyncIndicator } from "@/components/ui/kit";
import { useAppState, setOnline } from "@/lib/app-state";
import {
  useProfile, useRecyclerStats, useAvailableLots, useMaterials, useFacility,
  useCollectionAreasHeatmap, usePurchasesSummary, isLocalProfile, useRecyclerBindingRepair,
  type LotWithCollector,
} from "@/hooks/use-kc-data";
import { formatINR, timeAgo, formatKg } from "@/lib/format";
import { cn } from "@/lib/utils";
import RecyclerLots from "./RecyclerLots";
import RecyclerTransactions from "./RecyclerTransactions";

type Tab = "home" | "lots" | "deals" | "facility";

function Redirect({ to }: { to: string }) {
  const navigate = useNavigate();
  useEffect(() => {
    navigate(to, { replace: true });
  }, [navigate, to]);
  return null;
}

export default function RecyclerApp() {
  const { t } = useAppState();
  const navigate = useNavigate();
  const profile = useProfile();
  const [tab, setTab] = useState<Tab>("home");

  // Repair a signed-in backend profile that predates its facility binding so
  // the portal never loops to /auth over a missing recyclerId.
  useRecyclerBindingRepair();

  // Seed reference data (no-op after first run).
  const seed = useMutation(api.seed.seedIfEmpty);
  useEffect(() => {
    seed({}).catch(() => undefined);
  }, [seed]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    setOnline(navigator.onLine);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  if (profile === undefined) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <LoadingState label={t("common.loading")} />
      </div>
    );
  }
  if (profile === null) {
    return <Redirect to="/auth?role=recycler" />;
  }
  if (profile.role !== "recycler") {
    return <Redirect to="/app" />;
  }
  // A signed-in recycler whose facility binding is still missing (seed raced
  // the profile creation) renders the portal with empty facility data and a
  // clear note instead of bouncing — the reactive binding repair above fills
  // it in as soon as the facility exists.
  const recyclerId = profile.recyclerId ?? null;

  return (
    <div className="min-h-dvh bg-background">
      {/* Top header */}
      <header className="sticky top-0 z-40 border-b border-white/[0.08] bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <span className="clay flex size-10 items-center justify-center text-teal">
            <RecycleIcon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-extrabold leading-tight text-navy">
              Kabadiwala Connect — Recycler Portal
            </p>
            <p className="flex items-center gap-1 text-[11px] font-semibold text-muted2">
              {profile.name} (demo account)
              <ShieldCheckIcon className="size-3.5 text-[var(--verified)]" />
            </p>
          </div>
          <SyncIndicator />
          <button
            onClick={() => navigate("/", { replace: true })}
            aria-label="Exit portal"
            className="clay-sm flex size-10 items-center justify-center text-muted2 clay-pressable"
          >
            <LogOutIcon className="size-5" />
          </button>
        </div>
      </header>
      <OfflineBanner />

      <main className="mx-auto max-w-6xl px-4 pb-28 pt-4">
        {tab === "home" && <RecyclerDashboard recyclerId={recyclerId} onGoTab={setTab} />}
        {tab === "lots" && <RecyclerLots recyclerId={recyclerId} />}
        {tab === "deals" && <RecyclerTransactions recyclerId={recyclerId} />}
        {tab === "facility" && <RecyclerFacility recyclerId={recyclerId} />}
      </main>

      {/* Bottom nav — recycler */}
      <nav
        aria-label="Recycler primary"
        className="sticky bottom-0 z-40 border-t border-white/[0.08] bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
      >
        <div className="mx-auto grid max-w-6xl grid-cols-4 px-2 py-1.5">
          {(
            [
              { tab: "home", label: t("nav.home"), icon: GridIcon },
              { tab: "lots", label: t("nav.lots"), icon: LayersIcon },
              { tab: "deals", label: t("nav.deals"), icon: RecycleIcon },
              { tab: "facility", label: t("nav.facility"), icon: BuildingIcon },
            ] as const
          ).map((item) => (
            <button
              key={item.tab}
              onClick={() => setTab(item.tab)}
              aria-current={tab === item.tab ? "page" : undefined}
              className={cn(
                "flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-2xl clay-pressable",
                tab === item.tab ? "text-teal-deep" : "text-muted2",
              )}
            >
              <item.icon className="size-6" strokeWidth={tab === item.tab ? 2.4 : 2} />
              <span className={cn("text-[11px]", tab === item.tab ? "font-extrabold" : "font-medium")}>
                {item.label}
              </span>
            </button>
          ))}
        </div>
      </nav>
      <Toasts />
    </div>
  );
}

/* ------------------------------ Dashboard ------------------------------- */

function RecyclerDashboard({
  recyclerId,
  onGoTab,
}: {
  recyclerId: Id<"recyclers"> | null;
  onGoTab: (t: Tab) => void;
}) {
  const { t } = useAppState();
  const stats = useRecyclerStats(recyclerId ?? undefined);
  const purchases = usePurchasesSummary(recyclerId ?? undefined);
  const incoming = useAvailableLots();
  const { materials } = useMaterials();
  // §35 demo collection heatmap (fictional density data, clearly labelled).
  const heatmap = useCollectionAreasHeatmap();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-navy">Operations dashboard</h1>
        <p className="mt-1 text-sm text-muted2">
          Incoming collector lots, quotes and payments — demo data.
        </p>
      </div>

      {!recyclerId && (
        <ClayCard className="rounded-3xl border-l-4 border-[var(--pending)]">
          <p className="text-[13px] font-bold text-navy">Facility binding pending</p>
          <p className="mt-1 text-[12.5px] text-muted2">
            Demo facility data is still syncing. Portal stats will appear here — no action needed.
          </p>
        </ClayCard>
      )}

      {/* Stats */}
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { l: "Available lots", v: stats ? String(stats.newLots) : "…", tone: "teal" as const, icon: <LayersIcon className="size-5" /> },
          { l: "Pending verification", v: stats ? String(stats.active) : "…", tone: "gold" as const, icon: <ClockIcon className="size-5" /> },
          { l: "Completed transactions", v: stats ? String(stats.completed) : "…", tone: "navy" as const, icon: <RecycleIcon className="size-5" /> },
          { l: "Material received", v: purchases ? formatKg(purchases.totalKg) : "…", tone: "teal" as const, icon: <LayersIcon className="size-5" /> },
          { l: "This month's purchases", v: purchases ? formatINR(purchases.monthPaid, { compact: true }) : "…", tone: "navy" as const, icon: <WalletIcon className="size-5" /> },
        ].map((s) => (
          <ClayCard key={s.l} className="rounded-3xl">
            <div className="flex items-center justify-between">
              <span
                className={cn(
                  "clay-sm flex size-10 items-center justify-center",
                  s.tone === "teal" && "text-teal",
                  s.tone === "gold" && "text-[var(--gold)]",
                  s.tone === "navy" && "text-navy",
                )}
              >
                {s.icon}
              </span>
            </div>
            <p className="mt-3 text-3xl font-extrabold text-navy">{s.v}</p>
            <p className="text-[12px] font-semibold uppercase tracking-wide text-muted2">{s.l}</p>
          </ClayCard>
        ))}
      </div>

      {/* Collection areas heatmap (§35, demo data) */}
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-bold uppercase tracking-wide text-navy">Collection areas</h2>
        <span className="text-[10.5px] font-semibold text-muted2">demo density</span>
      </div>
      <ClayCard className="rounded-3xl">
        <div className="space-y-2">
          {(heatmap?.areas ?? []).slice(0, 5).map((a) => (
            <div key={a._id} className="flex items-center gap-3">
              <span className="w-28 shrink-0 truncate text-[12.5px] font-bold text-navy">{a.area}</span>
              <div className="h-3 flex-1 overflow-hidden rounded-full bg-[#20242D]">
                <div
                  className="h-full rounded-full bg-[linear-gradient(90deg,#047857,#10B981)]"
                  style={{ width: `${Math.max(8, Math.round(a.intensity * 100))}%` }}
                />
              </div>
              <span className="w-20 shrink-0 text-right text-[11px] font-semibold text-muted2">
                {a.lots} lots
              </span>
            </div>
          ))}
          {!heatmap && <p className="text-sm text-muted2">Loading density…</p>}
        </div>
        <p className="mt-3 text-[10.5px] text-muted2">{heatmap?.disclaimer ?? ""}</p>
      </ClayCard>

      {/* Incoming preview — §"New Lots Near You" */}
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-bold uppercase tracking-wide text-navy">New lots near you</h2>
        <ClayButton size="sm" variant="surface" onClick={() => onGoTab("lots")}>
          View all
        </ClayButton>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {(incoming ?? []).slice(0, 4).map((lot: LotWithCollector) => {
          const mat = materials?.find((m) => m.code === lot.materialCode);
          return (
            <ClayCard key={lot._id} className="rounded-3xl">
              <div className="flex items-center gap-3">
                {lot.photoDataUrl ? (
                  <img src={lot.photoDataUrl} alt="" className="size-14 rounded-2xl object-cover" />
                ) : (
                  <span className="clay-flat flex size-14 items-center justify-center text-lg font-extrabold text-teal-deep">
                    {lot.materialCode.slice(0, 2).toUpperCase()}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-extrabold text-navy">
                    {mat?.name ?? lot.materialCode} · {formatKg(lot.weight)}
                  </p>
                  <p className="text-[11.5px] text-muted2">
                    {lot.referenceId} · {lot.collectorName ?? "Collector"} · {timeAgo(lot.createdAt)}
                  </p>
                  <p className="mt-1 text-[13px] font-bold text-teal-deep">
                    Est. {formatINR(lot.estimatedValue)}
                  </p>
                </div>
              </div>
            </ClayCard>
          );
        })}
        {(incoming ?? []).length === 0 && (
          <ClayCard className="rounded-3xl">
            <p className="text-sm text-muted2">No incoming lots right now.</p>
          </ClayCard>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ Facility -------------------------------- */

function RecyclerFacility({ recyclerId }: { recyclerId: Id<"recyclers"> | null }) {
  const facility = useFacility(recyclerId ?? undefined); // offline-aware
  const { materials } = useMaterials();
  const { t } = useAppState();

  if (facility === undefined) return <LoadingState label={t("common.loading")} />;
  if (facility === null) return <p className="text-sm text-muted2">Facility not found.</p>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-navy">Facility profile</h1>
        <p className="mt-1 text-sm text-muted2">Your registered facility and accepted materials.</p>
      </div>

      <ClayCard className="rounded-3xl">
        <div className="flex items-start gap-3">
          <span className="clay-sm flex size-12 items-center justify-center text-teal">
            <BuildingIcon className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-lg font-extrabold text-navy">{facility.name}</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-muted2">
              <MapPinIcon className="size-4 shrink-0" /> {facility.address}, {facility.area},{" "}
              {facility.city}
            </p>
            <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-muted2">
              <PhoneIcon className="size-4 shrink-0" /> {facility.contact}
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <ClayBadge tone={facility.verified ? "green" : "amber"}>
            <ShieldCheckIcon className="size-3.5" /> Authorization verified (demo)
          </ClayBadge>
          <ClayBadge tone="gold">
            <StarIcon className="size-3.5" /> {facility.rating} rating
          </ClayBadge>
          {facility.pickupAvailable && (
            <ClayBadge tone="teal">
              <TruckIcon className="size-3.5" /> Pickup · {facility.pickupRadiusKm} km radius
            </ClayBadge>
          )}
        </div>
        <p className="mt-3 rounded-2xl bg-muted px-3.5 py-2.5 text-[12.5px] text-muted2">
          {facility.serviceArea} · {facility.timingNote}
        </p>
        <p className="mt-2 text-[11px] text-muted2">
          Demo authorization status — no real CPCB registration IDs are used in this prototype.
        </p>
      </ClayCard>

      <ClayCard className="rounded-3xl">
        <p className="text-[13px] font-bold uppercase tracking-wide text-muted2">Accepted materials & rates</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {facility.materialsAccepted.map((code) => {
            const m = materials?.find((x) => x.code === code);
            const rate = facility.rates[code] ?? m?.currentPrice ?? 0;
            return (
              <div key={code} className="clay-sm flex items-center justify-between rounded-2xl px-3.5 py-2.5">
                <span className="text-[13.5px] font-bold text-navy">{m?.name ?? code}</span>
                <span className="text-[13.5px] font-extrabold text-teal-deep">{formatINR(rate)}/kg</span>
              </div>
            );
          })}
        </div>
      </ClayCard>
    </div>
  );
}
