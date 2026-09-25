import { motion } from "framer-motion";
import { useNavigate } from "react-router";
import {
  CheckIcon, ChevronRightIcon, CloudUpIcon, RecycleIcon, ShieldCheckIcon, SpeakerIcon, TrendUpIcon,
} from "@/components/icons";
import { ClayButton, ClayCard } from "@/components/ui/kit";
import { useAppState } from "@/lib/app-state";
import { LANGS, LANG_LABELS } from "@/lib/i18n";
import { formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function Landing() {
  const { lang, setLang } = useAppState();
  const navigate = useNavigate();

  return (
    <div className="min-h-dvh bg-background">
      {/* Top bar */}
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <span className="clay flex size-11 items-center justify-center text-teal">
            <RecycleIcon className="size-6" />
          </span>
          <div>
            <p className="text-[15px] font-extrabold leading-tight text-navy">Kabadiwala Connect</p>
            <p className="text-[11px] font-medium text-muted2">SIH 2026 · SIH26229</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {LANGS.map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              aria-label={`Switch language to ${LANG_LABELS[l]}`}
              className={cn(
                "rounded-xl px-2.5 py-1.5 text-xs font-bold clay-pressable",
                lang === l
                  ? "bg-navy text-mint shadow-[var(--clay-1)]"
                  : "bg-card text-muted2 shadow-[var(--clay-1)]",
              )}
            >
              {LANG_LABELS[l]}
            </button>
          ))}
        </div>
      </header>

      {/* Hero */}
      <main className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        <div className="grid items-center gap-10 py-8 lg:grid-cols-2 lg:py-14">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <span className="clay-sm inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-xs font-bold text-teal-deep">
              <ShieldCheckIcon className="size-4" />
              Digital verification · Traceable lots · Fair prices
            </span>
            <h1 className="mt-5 text-4xl font-extrabold leading-[1.08] tracking-tight text-navy sm:text-5xl">
              Bringing informal collectors into the{" "}
              <span className="relative inline-block">
                <span className="relative z-10">formal recycling chain</span>
                <span
                  aria-hidden
                  className="absolute inset-x-0 bottom-0.5 z-0 h-3.5 -rotate-1 rounded-full bg-mint"
                />
              </span>
              .
            </h1>
            <p className="mt-4 max-w-xl text-lg text-muted2">
              Kabadiwala Connect helps kabadiwalas identify e-waste, see fair indicative prices and sell to
              verified recyclers — with a verified digital handover record for every transaction.
            </p>

            <div className="mt-7 flex flex-wrap gap-3">
              <ClayButton size="lg" onClick={() => navigate("/auth?role=collector")}>
                Start selling — Collector app
                <ChevronRightIcon className="size-5" />
              </ClayButton>
              <ClayButton variant="navy" size="lg" onClick={() => navigate("/auth?role=recycler")}>
                Recycler Portal
              </ClayButton>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm font-semibold text-muted2">
              <span className="inline-flex items-center gap-1.5">
                <CheckIcon className="size-4.5 text-[var(--verified)]" /> Offline-first
              </span>
              <span className="inline-flex items-center gap-1.5">
                <SpeakerIcon className="size-4.5 text-teal" /> Hindi · मराठी · Voice prices
              </span>
              <span className="inline-flex items-center gap-1.5">
                <TrendUpIcon className="size-4.5 text-[var(--gold)]" /> Transparent price trends
              </span>
            </div>
          </motion.div>

          {/* Phone mock */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.12 }}
            className="mx-auto w-full max-w-[400px]"
          >
            <div className="clay-lg rounded-[40px] p-3">
              <div className="rounded-[32px] bg-background p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-muted2">
                      Good afternoon 👋
                    </p>
                    <p className="text-lg font-extrabold text-navy">Turn your e-waste into value.</p>
                  </div>
                  <span className="clay-sm flex size-9 items-center justify-center text-teal">
                    <RecycleIcon className="size-5" />
                  </span>
                </div>
                <div className="clay mt-4 rounded-3xl p-4">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-muted2">
                    PCB — indicative
                  </p>
                  <div className="mt-1 flex items-end justify-between">
                    <p className="text-3xl font-extrabold text-navy">
                      {formatINR(410)}
                      <span className="text-base font-bold text-muted2">/kg</span>
                    </p>
                    <span className="rounded-full bg-green-50 px-2.5 py-1 text-xs font-bold text-[var(--verified)]">
                      +4.2%
                    </span>
                  </div>
                  <div className="mt-3 flex h-12 items-end gap-1.5">
                    {[38, 44, 41, 50, 47, 55, 60].map((v, i) => (
                      <span
                        key={i}
                        aria-hidden
                        className="flex-1 rounded-lg bg-teal/70"
                        style={{ height: `${(v / 60) * 100}%` }}
                      />
                    ))}
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {[
                    { l: "Lots sold", v: "18" },
                    { l: "Earned", v: "₹41.2K" },
                    { l: "Pending", v: "2" },
                  ].map((s) => (
                    <div key={s.l} className="clay-sm rounded-2xl px-2 py-2.5 text-center">
                      <p className="text-[15px] font-extrabold text-navy">{s.v}</p>
                      <p className="text-[10px] font-semibold text-muted2">{s.l}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Value props */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              icon: <RecycleIcon className="size-6" />,
              title: "AI material ID",
              body: "Photograph e-waste and get a material + confidence score (demo inference).",
            },
            {
              icon: <TrendUpIcon className="size-6" />,
              title: "Fair prices",
              body: "Live indicative rates, daily movement and 7/30/90-day trends.",
            },
            {
              icon: <ShieldCheckIcon className="size-6" />,
              title: "Verified handover",
              body: "Two-sided digital handover record with reference + checksum.",
            },
            {
              icon: <CloudUpIcon className="size-6" />,
              title: "Offline-first",
              body: "Capture lots with no network; auto-sync when you're back online.",
            },
          ].map((f) => (
            <ClayCard key={f.title} className="rounded-3xl">
              <div className="clay-sm mb-3 flex size-11 items-center justify-center text-teal">
                {f.icon}
              </div>
              <p className="font-extrabold text-navy">{f.title}</p>
              <p className="mt-1 text-sm text-muted2">{f.body}</p>
            </ClayCard>
          ))}
        </div>

        {/* Entry cards */}
        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          <ClayCard className="rounded-3xl">
            <p className="text-xs font-bold uppercase tracking-wider text-teal-deep">For collectors</p>
            <p className="mt-1 text-xl font-extrabold text-navy">Kabadiwala app</p>
            <p className="mt-1.5 text-sm text-muted2">
              Photo → AI material ID → indicative value → recycler quotes → digital handover → earnings.
            </p>
            <ClayButton className="mt-4 w-full" onClick={() => navigate("/auth?role=collector")}>
              Enter as Kabadiwala
            </ClayButton>
          </ClayCard>
          <ClayCard className="rounded-3xl">
            <p className="text-xs font-bold uppercase tracking-wider text-[var(--gold)]">For business</p>
            <p className="mt-1 text-xl font-extrabold text-navy">Recycler portal</p>
            <p className="mt-1.5 text-sm text-muted2">
              Review incoming lots, send quotes, confirm handovers and complete payments.
            </p>
            <ClayButton variant="navy" className="mt-4 w-full" onClick={() => navigate("/auth?role=recycler")}>
              Enter as Recycler
            </ClayButton>
          </ClayCard>
        </div>

        <p className="mt-10 text-center text-xs text-muted2">
          Prototype — demo data and mock inference clearly labelled. No real government authorization IDs are
          used anywhere in this build.
        </p>
      </main>
    </div>
  );
}
