import {
  ChevronRightIcon, ClockIcon, LayersIcon, LotsIcon, MapPinIcon, PriceTagIcon, ShieldCheckIcon, SpeakerIcon,
  TrendUpIcon, WalletIcon, WarningIcon,
} from "@/components/icons";
import { ClayButton, ClayCard, ClaySection } from "@/components/ui/kit";
import { useAppState, speak } from "@/lib/app-state";
import { formatINR } from "@/lib/format";
import { spokenPriceSentence } from "@/lib/i18n";
import { useMaterials, useProfile, useEarnings } from "@/hooks/use-kc-data";

export default function CollectorHome({ onNavigate, onOpenSafety, onOpenRecyclers, onOpenPooling }: {
  onNavigate: (tab: "prices" | "lots" | "earnings" | "add") => void;
  onOpenSafety: () => void;
  onOpenRecyclers: (materialCode?: string) => void;
  onOpenPooling: () => void;
}) {
  const { t, lang } = useAppState();
  const profile = useProfile();
  const { materials } = useMaterials();
  const { summary } = useEarnings(profile?._id);

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning 👋";
    if (h < 17) return "Good afternoon 👋";
    return "Good evening 👋";
  })();

  const pcb = materials?.find((m) => m.code === "pcb");

  return (
    <div className="space-y-5 px-4 pt-4">
      {/* Greeting + hero */}
      <div>
        <p className="text-sm font-semibold text-muted2">{greeting}</p>
        <h1 className="mt-0.5 text-[26px] font-extrabold leading-tight tracking-tight text-navy">
          {t("home.greeting")}
        </h1>
        <p className="mt-1.5 text-sm leading-snug text-muted2">{t("home.sub")}</p>
      </div>

      {/* Stat row — dashboard cards (lots / earnings / pending) */}
      <div className="grid grid-cols-3 gap-2.5">
        {[
          { label: t("home.lotsSold"), value: summary ? String(summary.lotsSold) : "…", icon: <LotsIcon className="size-4" /> },
          { label: t("home.totalEarned"), value: summary ? formatINR(summary.totalEarnings, { compact: true }) : "…", icon: <WalletIcon className="size-4" /> },
          { label: t("home.pendingLots"), value: summary ? String(summary.pendingLots) : "…", icon: <ClockIcon className="size-4" /> },
        ].map((s) => (
          <div key={s.label} className="clay-sm rounded-2xl px-2 py-3 text-center">
            <span className="mx-auto mb-1.5 flex size-7 items-center justify-center rounded-full bg-mint text-[var(--teal)]">
              {s.icon}
            </span>
            <p className="text-lg font-extrabold leading-none text-navy">{s.value}</p>
            <p className="mt-1 text-[10.5px] font-semibold leading-tight text-muted2">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Primary CTA */}
      <ClayButton
        className="w-full"
        onClick={() => onNavigate("add")}
        aria-label={t("home.addEwaste")}
      >
        <CameraCTA />
        {t("home.addEwaste")}
      </ClayButton>

      {/* Quick actions */}
      <ClaySection title="Quick actions">
        <div className="grid grid-cols-3 gap-2.5">
          {[
            { label: t("home.qa.prices"), icon: <PriceTagIcon className="size-6" />, go: () => onNavigate("prices") },
            { label: t("home.qa.lots"), icon: <LotsIcon className="size-6" />, go: () => onNavigate("lots") },
            { label: t("home.qa.earnings"), icon: <WalletIcon className="size-6" />, go: () => onNavigate("earnings") },
            { label: t("home.qa.recyclers"), icon: <MapPinIcon className="size-6" />, go: () => onOpenRecyclers(undefined) },
            { label: t("home.qa.safety"), icon: <ShieldCheckIcon className="size-6" />, go: onOpenSafety },
            { label: t("home.qa.trends"), icon: <TrendUpIcon className="size-6" />, go: () => onNavigate("prices") },
          ].map((qa) => (
            <button
              key={qa.label}
              onClick={qa.go}
              className="clay-sm flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-2xl px-1 py-2.5 clay-pressable"
            >
              <span className="text-teal">{qa.icon}</span>
              <span className="px-0.5 text-center text-[10.5px] font-bold leading-tight text-navy">{qa.label}</span>
            </button>
          ))}
        </div>
      </ClaySection>

      {/* Smart Scrap Pooling card (Part 2 §16) */}
      <ClayCard className="rounded-3xl">
        <div className="flex items-start gap-3">
          <span className="clay-sm flex size-10 shrink-0 items-center justify-center text-teal">
            <LayersIcon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-extrabold text-navy">Smart Scrap Pooling</p>
            <p className="mt-1 text-[13px] leading-snug text-muted2">
              Have a small quantity? Pool with nearby collectors so shared transport becomes viable.
            </p>
            <button
              onClick={onOpenPooling}
              className="mt-2 inline-flex items-center gap-1 text-[13px] font-bold text-teal-deep"
            >
              Find nearby collectors <ChevronRightIcon className="size-4" />
            </button>
          </div>
        </div>
      </ClayCard>

      {/* Today's rate + voice */}
      {pcb && (
        <ClayCard className="rounded-3xl">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted2">Today's PCB rate</p>
              <p className="text-2xl font-extrabold text-navy">
                {formatINR(pcb.currentPrice)}
                <span className="text-sm font-bold text-muted2">/kg</span>
              </p>
            </div>
            <button
              onClick={() =>
                speak(spokenPriceSentence("PCB", pcb.currentPrice, pcb.unit, lang), lang)
              }
              aria-label="Hear today's PCB price"
              className="clay-sm flex size-12 items-center justify-center text-teal clay-pressable"
            >
              <SpeakerIcon className="size-6" />
            </button>
          </div>
          <p className="mt-2 text-[12px] text-muted2">
            Tap the speaker to hear the price. Prices are indicative.
          </p>
        </ClayCard>
      )}

      {/* Safety card */}
      <ClayCard className="rounded-3xl border-l-4 border-[var(--gold)]">
        <div className="flex items-start gap-3">
          <span className="clay-sm flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--gold)] text-[var(--navy)]">
            <WarningIcon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-extrabold text-navy">{t("home.safety")}</p>
            <p className="mt-1 text-[13px] leading-snug text-muted2">{t("home.safetyTip")}</p>
            <button
              onClick={onOpenSafety}
              className="mt-2 inline-flex items-center gap-1 text-[13px] font-bold text-teal-deep"
            >
              Open safety guide <ChevronRightIcon className="size-4" />
            </button>
          </div>
        </div>
      </ClayCard>
    </div>
  );
}

function CameraCTA() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 8h2.5L9 5h6l2.5 3H20a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
      <circle cx="12" cy="14" r="3.5" />
    </svg>
  );
}
