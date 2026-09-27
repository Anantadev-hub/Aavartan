import { useNavigate } from "react-router";
import { useConvexAuth } from "convex/react";
import { motion } from "framer-motion";
import {
  ChevronRightIcon, ClockIcon, LayersIcon, LotsIcon, MapPinIcon, PriceTagIcon, RecycleIcon,
  ShieldCheckIcon, SpeakerIcon, TrendUpIcon, WalletIcon, WarningIcon, CameraIcon,
} from "@/components/icons";
import { ClayButton, ClayCard, ClaySection } from "@/components/ui/kit";
import { useAppState, speak } from "@/lib/app-state";
import { formatINR, formatKg } from "@/lib/format";
import { spokenPriceSentence } from "@/lib/i18n";
import { useMaterials, useProfile, useEarnings, useMyLots, hasBackendId } from "@/hooks/use-kc-data";

export default function CollectorHome({ onNavigate, onOpenSafety, onOpenRecyclers, onOpenPooling }: {
  onNavigate: (tab: "prices" | "lots" | "earnings" | "add") => void;
  onOpenSafety: () => void;
  onOpenRecyclers: (materialCode?: string) => void;
  onOpenPooling: () => void;
}) {
  const { t, lang } = useAppState();
  const navigate = useNavigate();
  const { isAuthenticated } = useConvexAuth();
  const profile = useProfile();
  const { materials } = useMaterials();
  const { summary } = useEarnings(hasBackendId(profile) ? profile._id : undefined);
  const lots = useMyLots(hasBackendId(profile) ? profile._id : undefined);

  const name = profile?.name ?? "";
  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  })();
  const firstName = name.split(" ")[0];

  const pcb = materials?.find((m) => m.code === "pcb");
  const recentLots = (lots ?? []).slice(0, 3);
  const pendingValue = (lots ?? [])
    .filter((l) => ["created", "sent", "accepted", "handed_over"].includes(l.status))
    .reduce((s, l) => s + (l.estimatedValue ?? 0), 0);

  return (
    <div className="pb-2">
      {/* ---------- Compact app bar ---------- */}
      <div className="bg-navy px-4 pb-5 pt-3 text-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex size-10 items-center justify-center rounded-2xl bg-white">
              <RecycleIcon className="size-5 text-[#00786B]" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[15px] font-extrabold leading-tight">Aavartan</p>
              <p className="text-[11px] text-white/60">Collector</p>
            </div>
          </div>
          <button
            onClick={() => navigate("/app?tab=profile")}
            aria-label="Open profile"
            className="flex size-11 items-center justify-center rounded-full bg-white/10 text-[13px] font-extrabold uppercase transition-colors active:bg-white/20"
          >
            {(name.trim()[0] ?? "A")}
          </button>
        </div>
        <p className="mt-4 text-[22px] font-extrabold leading-tight tracking-tight">
          {greeting}, {firstName || t("home.greeting")}
        </p>
        <p className="mt-0.5 text-[13px] text-white/70">{t("home.sub")}</p>
      </div>

      <div className="space-y-5 px-4 pt-5">
        {/* ---------- Earnings + pending stats ---------- */}
        <div className="grid grid-cols-2 gap-2.5">
          <div className="col-span-2 flex items-center justify-between rounded-3xl bg-[var(--teal)] p-4 text-white shadow-md shadow-[rgb(0_120_107/0.25)]">
            <div className="flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-2xl bg-white/15">
                <WalletIcon className="size-5" />
              </span>
              <div>
                <p className="text-[10.5px] font-bold uppercase tracking-wider text-white/70">
                  {t("home.totalEarned")}
                </p>
                <p className="text-2xl font-extrabold leading-tight">
                  {summary ? formatINR(summary.totalEarnings) : "…"}
                </p>
              </div>
            </div>
            <button
              onClick={() => onNavigate("earnings")}
              aria-label="Open earnings"
              className="flex size-11 items-center justify-center rounded-full bg-white/15 transition-colors active:bg-white/25"
            >
              <ChevronRightIcon className="size-5" />
            </button>
          </div>

          <button
            onClick={() => onNavigate("lots")}
            className="clay-sm flex items-center justify-between rounded-2xl p-3.5 text-left clay-pressable"
          >
            <div>
              <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted2">{t("home.lotsSold")}</p>
              <p className="mt-0.5 text-xl font-extrabold text-navy">
                {summary ? String(summary.lotsSold) : "…"}
              </p>
            </div>
            <span className="flex size-9 items-center justify-center rounded-full bg-mint text-[var(--teal)]">
              <LotsIcon className="size-4" />
            </span>
          </button>
          <button
            onClick={() => onNavigate("lots")}
            className="clay-sm flex items-center justify-between rounded-2xl p-3.5 text-left clay-pressable"
          >
            <div>
              <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted2">
                {t("home.pendingLots")}
              </p>
              <p className="mt-0.5 text-xl font-extrabold text-navy">
                {summary ? String(summary.pendingLots) : "…"}
              </p>
              <p className="text-[10px] font-semibold text-muted2">
                {pendingValue > 0 ? `${formatINR(pendingValue)} in progress` : ""}
              </p>
            </div>
            <span className="flex size-9 items-center justify-center rounded-full bg-[var(--gold)]/25 text-[var(--warning)]">
              <ClockIcon className="size-4" />
            </span>
          </button>
        </div>

        {/* ---------- MAIN ACTION: scan CTA ---------- */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
          <button
            onClick={() => onNavigate("add")}
            className="flex w-full items-center gap-3.5 rounded-3xl bg-navy p-4 text-left text-white shadow-lg shadow-[rgb(11_31_58/0.25)] transition-transform active:scale-[0.99]"
          >
            <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-[#F4B942] text-[#0B1F3A]">
              <CameraIcon className="size-7" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[16px] font-extrabold">{t("home.addEwaste")}</span>
              <span className="mt-0.5 block text-[12px] leading-snug text-white/70">
                Identify material and get an instant value estimate
              </span>
            </span>
            <ChevronRightIcon className="size-5 shrink-0 text-white/50" />
          </button>
        </motion.div>

        {/* ---------- Quick actions ---------- */}
        <ClaySection title="Quick actions">
          <div className="grid grid-cols-4 gap-2.5">
            {[
              { label: t("home.qa.prices"), icon: <PriceTagIcon className="size-5" />, go: () => onNavigate("prices") },
              { label: t("home.qa.recyclers"), icon: <MapPinIcon className="size-5" />, go: () => onOpenRecyclers(undefined) },
              { label: t("home.qa.safety"), icon: <ShieldCheckIcon className="size-5" />, go: onOpenSafety },
              { label: t("home.qa.trends"), icon: <TrendUpIcon className="size-5" />, go: () => onNavigate("prices") },
            ].map((qa) => (
              <button
                key={qa.label}
                onClick={qa.go}
                className="clay-sm flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-2xl px-1 py-2.5 clay-pressable"
              >
                <span className="flex size-9 items-center justify-center rounded-full bg-mint text-[var(--teal)]">{qa.icon}</span>
                <span className="px-0.5 text-center text-[10px] font-bold leading-tight text-navy">{qa.label}</span>
              </button>
            ))}
          </div>
        </ClaySection>

        {/* ---------- Smart Scrap Pooling — core feature, prominent ---------- */}
        <button
          onClick={onOpenPooling}
          className="flex w-full items-center gap-3.5 rounded-3xl border border-[rgb(0_120_107/0.25)] bg-mint p-4 text-left clay-pressable"
        >
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--teal)] text-white">
            <LayersIcon className="size-6" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-extrabold text-navy">Smart Scrap Pooling</span>
            <span className="mt-0.5 block text-[12px] leading-snug text-muted2">
              Have a small quantity? Pool with nearby collectors so shared transport becomes viable.
            </span>
          </span>
          <ChevronRightIcon className="size-5 shrink-0 text-[var(--teal)]" />
        </button>

        {/* ---------- Recent lots ---------- */}
        {recentLots.length > 0 && (
          <ClaySection
            title="Recent lots"
            action={
              <button onClick={() => onNavigate("lots")} className="text-[12px] font-bold text-[var(--teal)]">
                View all
              </button>
            }
          >
            <div className="space-y-2">
              {recentLots.map((lot) => {
                const mat = materials?.find((m) => m.code === lot.materialCode);
                return (
                  <button
                    key={lot._id}
                    onClick={() => onNavigate("lots")}
                    className="clay-sm flex w-full items-center gap-3 rounded-2xl p-2.5 text-left clay-pressable"
                  >
                    {lot.photoDataUrl ? (
                      <img src={lot.photoDataUrl} alt="" className="size-12 shrink-0 rounded-xl object-cover" />
                    ) : (
                      <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-muted text-[12px] font-extrabold text-[var(--teal)]">
                        {lot.materialCode.slice(0, 2).toUpperCase()}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-extrabold text-navy">{mat?.name ?? lot.materialCode}</span>
                      <span className="mt-0.5 block text-[11px] text-muted2">
                        {formatKg(lot.weight)} · {lot.referenceId}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-[14px] font-extrabold text-navy">
                        {formatINR(lot.finalSaleValue ?? lot.estimatedValue)}
                      </span>
                      <span className="block text-[10.5px] font-semibold text-muted2">{lot.status}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </ClaySection>
        )}

        {/* ---------- Today's rate + voice (existing behavior preserved) ---------- */}
        {pcb && (
          <ClayCard className="rounded-3xl">
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted2">Today's PCB rate</p>
                <p className="text-2xl font-extrabold text-navy">
                  {formatINR(pcb.currentPrice)}
                  <span className="text-sm font-bold text-muted2">/kg</span>
                </p>
              </div>
              <button
                onClick={() => speak(spokenPriceSentence("PCB", pcb.currentPrice, pcb.unit, lang), lang)}
                aria-label="Hear today's PCB price"
                className="flex size-12 shrink-0 items-center justify-center rounded-full bg-mint text-[var(--teal)] clay-pressable"
              >
                <SpeakerIcon className="size-6" />
              </button>
            </div>
          </ClayCard>
        )}

        {/* ---------- Safety tip card (existing copy preserved) ---------- */}
        <ClayCard className="rounded-3xl border-l-4 border-[var(--gold)]">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--gold)] text-[var(--navy)]">
              <WarningIcon className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-extrabold text-navy">{t("home.safety")}</p>
              <p className="mt-1 text-[13px] leading-snug text-muted2">{t("home.safetyTip")}</p>
              <button
                onClick={onOpenSafety}
                className="mt-2 inline-flex min-h-11 items-center gap-1 text-[13px] font-bold text-[var(--teal)]"
              >
                Open safety guide <ChevronRightIcon className="size-4" />
              </button>
            </div>
          </div>
        </ClayCard>
      </div>
    </div>
  );
}


