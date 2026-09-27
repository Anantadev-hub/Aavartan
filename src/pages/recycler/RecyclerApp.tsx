import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  BuildingIcon, GridIcon, LayersIcon, LogOutIcon, MapPinIcon, PhoneIcon, RecycleIcon,
  ShieldCheckIcon, StarIcon, TruckIcon, ClockIcon, WalletIcon, PriceTagIcon, UserIcon,
} from "@/components/icons";
import { ClayButton, ClayCard, ClayBadge, LoadingState, OfflineBanner, Toasts, SyncIndicator } from "@/components/ui/kit";
import { useAppState, setOnline, pushToast, setLang as applyLang } from "@/lib/app-state";
import { LANGS, LANG_LABELS } from "@/lib/i18n";
import { clearPendingProfile, clearLastAuth } from "@/lib/auth-service";
import {
  useProfile, useProfileState, useRecyclerStats, useAvailableLots, useMaterials, useFacility,
  useCollectionAreasHeatmap, usePurchasesSummary, isLocalProfile, useRecyclerBindingRepair,
  usePendingProfileSync,
  type LotWithCollector,
} from "@/hooks/use-kc-data";
import { clearCache } from "@/lib/offline-cache";
import { formatINR, timeAgo, formatKg } from "@/lib/format";
import { cn } from "@/lib/utils";
import RecyclerLots from "./RecyclerLots";
import RecyclerTransactions from "./RecyclerTransactions";
import RecyclerQuotes from "./RecyclerQuotes";

type Tab = "home" | "lots" | "deals" | "quotes" | "facility" | "profile";

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
  const { signOut } = useAuthActions();
  const profile = useProfile();
  const profileState = useProfileState();
  const [tab, setTab] = useState<Tab>("home");

  // Session lost / stale identity: drop cached account artifacts once so no
  // other account's data can render, then re-authenticate via the redirect.
  useEffect(() => {
    if (profileState.phase === "anonymous" || profileState.phase === "missing") {
      clearCache();
    }
  }, [profileState.phase]);

  // Retry a stalled offline onboarding (Pending Sync profile) — mirrors the
  // collector shell; completes the backend record once connectivity returns.
  usePendingProfileSync();

  // Repair a signed-in backend profile that predates its facility binding so
  // the portal never loops to /auth over a missing recyclerId. Auth-timing
  // safe: idles until the session is verified — a mount-time run while auth
  // was still resolving returned null server-side and silently no-oped.
  useRecyclerBindingRepair({
    enabled: profileState.phase === "ready" && !profile?.recyclerId,
  });

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

  // Auth hydrating → loading; unauthenticated/stale session → login.
  if (profileState.phase === "loading") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <LoadingState label={t("common.loading")} />
      </div>
    );
  }
  if (profileState.phase === "anonymous" || profileState.phase === "missing") {
    return <Redirect to="/auth?role=recycler" />;
  }
  if (!profile || profile.role !== "recycler") {
    return <Redirect to="/app" />;
  }
  // A signed-in recycler whose facility binding is still missing (seed raced
  // the profile creation) renders the portal with empty facility data and a
  // clear note instead of bouncing — the reactive binding repair above fills
  // it in as soon as the facility exists.
  // Distinct facility-binding states — "still loading", "pending sign-in sync"
  // and "confirmed no facility bound" are different situations and must never
  // collapse into one eternal "syncing" message.
  const bindingState: "ready" | "pending" | "unbound" =
    profileState.phase === "pending-sync"
      ? "pending"
      : profile?.recyclerId
        ? "ready"
        : profileState.phase === "ready"
          ? "unbound"
          : "pending";
  const recyclerId = profile.recyclerId ?? null;

  return (
    <div className="min-h-dvh bg-background pt-[env(safe-area-inset-top)]">
      {/* Compact app bar — brand + facility identity + sync state */}
      <header className="sticky top-0 z-40 bg-navy text-white shadow-md shadow-[rgb(11_31_58/0.18)]">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-white">
            <RecycleIcon className="size-5 text-[#00786B]" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-extrabold leading-tight">Aavartan</p>
            <p className="flex items-center gap-1 truncate text-[11px] text-white/70">
              {profile.name}
              <ShieldCheckIcon className="size-3.5 shrink-0 text-[#7BD8CB]" />
            </p>
          </div>
          <SyncIndicator />
          <button
            onClick={() => setTab("profile")}
            aria-label="Open profile"
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white/10 text-[13px] font-extrabold uppercase transition-colors active:bg-white/20"
          >
            {profile.name.trim()[0] ?? "R"}
          </button>
        </div>
      </header>
      <OfflineBanner />

      <main className="mx-auto w-full max-w-2xl px-4 pb-28 pt-4">
        {tab === "home" && <RecyclerDashboard recyclerId={recyclerId} bindingState={bindingState} onGoTab={setTab} />}
        {/* Quotes stay reachable: primary entry from the Home quick action. */}
        {tab === "lots" && <RecyclerLots recyclerId={recyclerId} bindingState={bindingState} />}
        {tab === "deals" && <RecyclerTransactions recyclerId={recyclerId} />}
        {tab === "quotes" && <RecyclerQuotes recyclerId={recyclerId} bindingState={bindingState} />}
        {tab === "facility" && <RecyclerFacility recyclerId={recyclerId} bindingState={bindingState} />}
        {tab === "profile" && <RecyclerProfile name={profile.name} />}
      </main>

      {/* Bottom nav — recycler */}
      <nav
        aria-label="Recycler primary"
        className="sticky bottom-0 z-40 border-t border-white/[0.08] bg-background/95 pb-[max(env(safe-area-inset-bottom),8px)] backdrop-blur"
      >
        <div className="mx-auto grid max-w-2xl grid-cols-5 px-2 py-1.5">
          {(
            [
              { tab: "home" as const, label: t("nav.home"), icon: GridIcon },
              { tab: "lots" as const, label: t("nav.lots"), icon: LayersIcon },
              { tab: "deals" as const, label: t("nav.deals"), icon: RecycleIcon },
              { tab: "facility" as const, label: t("nav.facility"), icon: BuildingIcon },
              { tab: "profile" as const, label: t("nav.profile"), icon: UserIcon },
            ]
          ).map((item) => (
            <button
              key={item.tab}
              onClick={() => setTab(item.tab)}
              aria-current={tab === item.tab ? "page" : undefined}
              className={cn(
                "flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-2xl px-1 clay-pressable transition-colors",
                tab === item.tab ? "tab-active" : "text-muted2 hover:text-navy",
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

/* ------------------------------- Profile -------------------------------- */

function RecyclerProfile({ name }: { name: string }) {
  const { t, lang } = useAppState();
  const { signOut } = useAuthActions();
  const navigate = useNavigate();

  const logout = () => {
    // §1: clear the session and return to login; the facility and all
    // transaction data remain in the cloud.
    void (async () => {
      try {
        await signOut();
      } catch {
        /* session already gone */
      }
      clearPendingProfile();
      clearLastAuth();
      clearCache();
      navigate("/auth", { replace: true });
    })();
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 pb-6 pt-4">
      <div className="flex items-center gap-3.5 rounded-3xl bg-navy p-4 text-white">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-white/15 text-lg font-extrabold uppercase">
          {name.trim()[0] ?? "R"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-extrabold leading-tight">{name}</p>
          <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide">
            Recycler account
          </span>
        </div>
      </div>

      <ClayCard className="rounded-3xl p-0">
        <p className="px-4 pt-3.5 text-[11px] font-bold uppercase tracking-wider text-muted2">Language</p>
        <div className="flex gap-2 p-3">
          {LANGS.map((l) => (
            <button
              key={l}
              onClick={() => applyLang(l)}
              aria-pressed={lang === l}
              className={cn(
                "min-h-11 flex-1 rounded-2xl text-[13px] font-bold clay-pressable transition-colors",
                lang === l ? "bg-navy text-white" : "bg-muted text-muted2",
              )}
            >
              {LANG_LABELS[l]}
            </button>
          ))}
        </div>
      </ClayCard>

      <button
        onClick={logout}
        className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-card text-[15px] font-bold text-[var(--danger)] shadow-[var(--clay-1)] clay-pressable"
      >
        <LogOutIcon className="size-5" /> Log out
      </button>

      <p className="pb-2 text-center text-[11px] text-muted2">Aavartan · prototype build</p>
    </div>
  );
}

/* ------------------------------ Dashboard ------------------------------- */

function RecyclerDashboard({
  recyclerId,
  bindingState,
  onGoTab,
}: {
  recyclerId: Id<"recyclers"> | null;
  bindingState: "ready" | "pending" | "unbound";
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

      {bindingState !== "ready" && (
        <ClayCard className="rounded-3xl border-l-4 border-[var(--gold)]">
          <p className="text-[13px] font-bold text-navy">
            {bindingState === "unbound"
              ? "No facility linked to your account"
              : "Finishing sign-in…"}
          </p>
          <p className="mt-1 text-[12.5px] text-muted2">
            {bindingState === "unbound"
              ? "No facility linked to your account — set one up in Facility settings. Quoting stays disabled until a facility is linked. If you just signed in, re-login links the demo facility automatically."
              : "Your account is still syncing with the cloud. The portal finishes loading automatically — nothing is lost."}
          </p>
        </ClayCard>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
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
                  s.tone === "gold" && "rounded-full bg-[var(--gold)] text-[var(--navy)]",
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
              <div className="h-3 flex-1 overflow-hidden rounded-full clay-track">
                <div
                  className="h-full rounded-full bg-teal"
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
        <ClayButton size="sm" variant="surface" onClick={() => onGoTab("quotes")}>
          Buying quotes
        </ClayButton>
      </div>
      <div className="grid gap-3">
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
                  <p className="truncate text-[11.5px] text-muted2">
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

const FACILITY_MATERIAL_OPTIONS = [
  { code: "pcb", label: "PCB" },
  { code: "lcd", label: "LCD" },
  { code: "crt", label: "CRT" },
  { code: "cable", label: "Cables" },
  { code: "battery", label: "Batteries" },
  { code: "motor", label: "Motors" },
  { code: "plastic", label: "Mixed Plastics" },
];

function RecyclerFacility({
  recyclerId,
  bindingState,
}: {
  recyclerId: Id<"recyclers"> | null;
  bindingState: "ready" | "pending" | "unbound";
}) {
  const { t } = useAppState();
  // Read through the AUTH-AWARE facility query (resolves the signed-in
  // identity server-side); recyclerId prop is display-only now.
  const myFacilityDoc = useQuery(api.facility.myFacility, {});
  const facility = useFacility(recyclerId ?? undefined); // offline-aware mirror
  const { materials } = useMaterials();
  const ensure = useMutation(api.profiles.ensureRecyclerBinding);
  const save = useMutation(api.facility.updateMyFacility);
  const [linking, setLinking] = useState(false);

  // Editable form state, seeded from the loaded facility.
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<{
    name: string; address: string; city: string; contact: string;
    serviceArea: string; timingNote: string; pickupAvailable: boolean;
    materials: string[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedTick, setSavedTick] = useState(0);

  const doc = myFacilityDoc ?? (recyclerId ? facility : null);

  const startEdit = (f: NonNullable<typeof doc>) =>
    setForm({
      name: f.name,
      address: f.address,
      city: f.city,
      contact: f.contact,
      serviceArea: f.serviceArea,
      timingNote: f.timingNote,
      pickupAvailable: f.pickupAvailable,
      materials: [...f.materialsAccepted],
    });

  const saveEdits = () => {
    if (!form) return;
    setBusy(true);
    save({
      name: form.name,
      address: form.address,
      city: form.city,
      contact: form.contact,
      serviceArea: form.serviceArea,
      timingNote: form.timingNote,
      pickupAvailable: form.pickupAvailable,
      materialsAccepted: form.materials,
    })
      .then(() => {
        pushToast("Facility details saved", "success");
        setEditing(false);
        setForm(null);
        setSavedTick((n) => n + 1); // re-seed the form from fresh backend state
      })
      .catch((e) => {
        // Show the real failure, keep the original error in the console log.
        console.error("[facility] update failed:", e);
        pushToast(e instanceof Error ? e.message : "Could not save facility details", "error");
      })
      .finally(() => setBusy(false));
  };

  // Sign-in still syncing: honest loading state, never a dead end.
  if (bindingState === "pending" && doc === undefined) {
    return <LoadingState label="Finishing sign-in…" />;
  }
  if (doc === undefined) return <LoadingState label={t("common.loading")} />;

  // Confirmed no facility bound (or the bound record vanished): actionable
  // repair — re-run the real binding mutation, no fake/default facility.
  if (doc === null || (bindingState === "unbound" && !recyclerId)) {
    return (
      <div className="space-y-5">
        <h1 className="text-2xl font-extrabold tracking-tight text-navy">Facility profile</h1>
        <ClayCard className="rounded-3xl">
          <p className="text-[15px] font-extrabold text-navy">No facility linked to your account</p>
          <p className="mt-1 max-w-md text-[13px] leading-snug text-muted2">
            Set up your facility to enable quoting and transactions. Re-login links the demo facility
            automatically, or link it right now — your account details are kept.
          </p>
          <ClayButton
            className="mt-3"
            disabled={linking}
            onClick={() => {
              setLinking(true);
              void ensure({})
                .then((p) => {
                  if (p?.recyclerId) pushToast("Facility linked — quoting is enabled", "success");
                  else pushToast("Facility not available yet — try re-login", "error");
                })
                .catch(() => pushToast("Could not link facility — check connection", "error"))
                .finally(() => setLinking(false));
            }}
          >
            <BuildingIcon className="size-5" /> Link demo facility now
          </ClayButton>
        </ClayCard>
      </div>
    );
  }

  // Form display value: edits while editing, otherwise a view of the doc.
  const seed: NonNullable<typeof doc> = doc;
  const shown = form ?? {
    name: seed.name,
    address: seed.address,
    city: seed.city,
    contact: seed.contact,
    serviceArea: seed.serviceArea,
    timingNote: seed.timingNote,
    pickupAvailable: seed.pickupAvailable,
    materials: [...seed.materialsAccepted],
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-navy">Facility profile</h1>
          <p className="mt-1 text-sm text-muted2">Your registered facility and accepted materials.</p>
        </div>
        {!editing && (
          <ClayButton size="sm" variant="surface" onClick={() => startEdit(seed)}>
            Edit
          </ClayButton>
        )}
      </div>

      <ClayCard className="rounded-3xl">
        <div className="flex items-start gap-3">
          <span className="clay-sm flex size-12 items-center justify-center text-teal">
            <BuildingIcon className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            {editing ? (
              <div className="space-y-2">
                <input
                  value={shown.name}
                  onChange={(e) => setForm({ ...shown, name: e.target.value })}
                  className="w-full rounded-xl bg-muted px-3 py-2 text-[15px] font-extrabold text-navy outline-none"
                  aria-label="Facility name"
                />
                <input
                  value={shown.address}
                  onChange={(e) => setForm({ ...shown, address: e.target.value })}
                  placeholder="Address"
                  className="w-full rounded-xl bg-muted px-3 py-2 text-[13px] text-navy outline-none"
                  aria-label="Address"
                />
                <input
                  value={shown.city}
                  onChange={(e) => setForm({ ...shown, city: e.target.value })}
                  placeholder="City"
                  className="w-full rounded-xl bg-muted px-3 py-2 text-[13px] text-navy outline-none"
                  aria-label="City"
                />
                <input
                  value={shown.contact}
                  onChange={(e) => setForm({ ...shown, contact: e.target.value })}
                  placeholder="Contact"
                  className="w-full rounded-xl bg-muted px-3 py-2 text-[13px] text-navy outline-none"
                  aria-label="Contact"
                />
                <input
                  value={shown.serviceArea}
                  onChange={(e) => setForm({ ...shown, serviceArea: e.target.value })}
                  placeholder="Service area"
                  className="w-full rounded-xl bg-muted px-3 py-2 text-[13px] text-navy outline-none"
                  aria-label="Service area"
                />
                <input
                  value={shown.timingNote}
                  onChange={(e) => setForm({ ...shown, timingNote: e.target.value })}
                  placeholder="Operating hours"
                  className="w-full rounded-xl bg-muted px-3 py-2 text-[13px] text-navy outline-none"
                  aria-label="Operating hours"
                />
                <label className="flex items-center gap-2 text-[13px] font-semibold text-navy">
                  <input
                    type="checkbox"
                    checked={shown.pickupAvailable}
                    onChange={(e) => setForm({ ...shown, pickupAvailable: e.target.checked })}
                  />
                  Pickup available
                </label>
                <div>
                  <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted2">
                    Accepted materials
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {FACILITY_MATERIAL_OPTIONS.map((m) => {
                      const on = shown.materials.includes(m.code);
                      return (
                        <button
                          key={m.code}
                          type="button"
                          aria-pressed={on}
                          onClick={() =>
                            setForm({
                              ...shown,
                              materials: on
                                ? shown.materials.filter((x) => x !== m.code)
                                : [...shown.materials, m.code],
                            })
                          }
                          className={cn(
                            "rounded-full px-3 py-1.5 text-[12px] font-bold clay-pressable",
                            on ? "bg-navy text-white" : "bg-muted text-muted2",
                          )}
                        >
                          {m.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="flex gap-2 pt-1">
                  <ClayButton size="sm" disabled={busy} onClick={saveEdits}>
                    Save
                  </ClayButton>
                  <ClayButton
                    size="sm"
                    variant="surface"
                    disabled={busy}
                    onClick={() => {
                      setEditing(false);
                      setForm(null);
                    }}
                  >
                    Cancel
                  </ClayButton>
                </div>
              </div>
            ) : (
              <>
                <p className="text-lg font-extrabold text-navy">{seed.name}</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-muted2">
                  <MapPinIcon className="size-4 shrink-0" /> {seed.address}, {seed.area}, {seed.city}
                </p>
                <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-muted2">
                  <PhoneIcon className="size-4 shrink-0" /> {seed.contact}
                </p>
              </>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <ClayBadge tone={seed.verified ? "green" : "amber"}>
            <ShieldCheckIcon className="size-3.5" /> Authorization verified (demo)
          </ClayBadge>
          <ClayBadge tone="gold">
            <StarIcon className="size-3.5" /> {seed.rating} rating
          </ClayBadge>
          {(editing ? shown.pickupAvailable : seed.pickupAvailable) && (
            <ClayBadge tone="teal">
              <TruckIcon className="size-3.5" /> Pickup · {seed.pickupRadiusKm} km radius
            </ClayBadge>
          )}
        </div>
        {!editing && (
          <p className="mt-3 rounded-2xl bg-muted px-3.5 py-2.5 text-[12.5px] text-muted2">
            {seed.serviceArea} · {seed.timingNote}
          </p>
        )}
        <p className="mt-2 text-[11px] text-muted2">
          Demo authorization status — no real CPCB registration IDs are used in this prototype.
          {savedTick > 0 && " Saved changes persist to your cloud account."}
        </p>
      </ClayCard>

      {!editing && (
        <ClayCard className="rounded-3xl">
          <p className="text-[13px] font-bold uppercase tracking-wide text-muted2">Accepted materials & rates</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {seed.materialsAccepted.map((code: string) => {
              const m = materials?.find((x) => x.code === code);
              const rate = seed.rates[code] ?? m?.currentPrice ?? 0;
              return (
                <div key={code} className="clay-sm flex items-center justify-between rounded-2xl px-3.5 py-2.5">
                  <span className="text-[13.5px] font-bold text-navy">{m?.name ?? code}</span>
                  <span className="text-[13.5px] font-extrabold text-teal-deep">{formatINR(rate)}/kg</span>
                </div>
              );
            })}
          </div>
        </ClayCard>
      )}
    </div>
  );
}
