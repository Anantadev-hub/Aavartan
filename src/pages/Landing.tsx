import { motion } from "framer-motion";
import { useNavigate } from "react-router";
import { RecycleIcon, ShieldCheckIcon, BuildingIcon } from "@/components/icons";
import { useAppState } from "@/lib/app-state";
import { LANGS, LANG_LABELS } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * App launch screen — a full-viewport mobile composition, not a website hero.
 * The two CTAs deep-link into the EXISTING auth flow (/auth?role=…) unchanged.
 */
export default function Landing() {
  const { lang, setLang } = useAppState();
  const navigate = useNavigate();

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-navy text-white">
      {/* Ambient brand depth (decoration only) */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(120%_90%_at_50%_0%,rgb(0_168_150/0.35)_0%,transparent_60%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-24 -right-16 size-72 rounded-full bg-[#F4B942]/10 blur-2xl"
      />

      {/* Compact language row — app-style, top-right */}
      <div className="relative z-10 flex items-center justify-end gap-1.5 px-4 pt-[max(env(safe-area-inset-top),12px)]">
        {LANGS.map((l) => (
          <button
            key={l}
            onClick={() => setLang(l)}
            aria-label={`Switch language to ${LANG_LABELS[l]}`}
            className={cn(
              "min-h-11 rounded-full px-3 text-[12px] font-bold transition-colors",
              lang === l
                ? "bg-white text-[#0B1F3A]"
                : "bg-white/10 text-white/80 active:bg-white/20",
            )}
          >
            {LANG_LABELS[l]}
          </button>
        ))}
      </div>

      {/* Brand block */}
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 pb-6">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="flex w-full max-w-sm flex-col items-center text-center"
        >
          <span className="flex size-20 items-center justify-center rounded-[26px] bg-white shadow-xl">
            <RecycleIcon className="size-11 text-[#00786B]" />
          </span>
          <h1 className="mt-5 text-[34px] font-extrabold tracking-tight">Aavartan</h1>
          <p className="mt-2 text-[15px] leading-snug text-white/75">
            Connecting collectors with responsible recycling.
          </p>

          {/* Flow: Collector → Aavartan → Recycler */}
          <div className="mt-8 flex w-full items-center justify-between gap-1 rounded-3xl bg-white/[0.07] p-4">
            <div className="flex flex-1 flex-col items-center gap-1.5">
              <span className="flex size-11 items-center justify-center rounded-2xl bg-[#F4B942]/20 text-[#F4B942]">
                <RecycleIcon className="size-5" />
              </span>
              <span className="text-[11px] font-bold">Collector</span>
            </div>
            <FlowArrow />
            <div className="flex flex-1 flex-col items-center gap-1.5">
              <span className="flex size-11 items-center justify-center rounded-2xl bg-white text-[#0B1F3A]">
                <RecycleIcon className="size-5" />
              </span>
              <span className="text-[11px] font-extrabold">Aavartan</span>
            </div>
            <FlowArrow />
            <div className="flex flex-1 flex-col items-center gap-1.5">
              <span className="flex size-11 items-center justify-center rounded-2xl bg-teal-500/20 text-teal-300">
                <BuildingIcon className="size-5" />
              </span>
              <span className="text-[11px] font-bold">Recycler</span>
            </div>
          </div>

          <p className="mt-5 flex items-center gap-1.5 text-[12px] font-semibold text-white/60">
            <ShieldCheckIcon className="size-4" />
            Verified handover records · Fair indicative prices
          </p>
        </motion.div>
      </main>

      {/* Actions — docked to the thumb zone like an app */}
      <div className="relative z-10 space-y-3 px-6 pb-[max(env(safe-area-inset-bottom),20px)]">
        <motion.button
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          onClick={() => navigate("/auth?role=collector")}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#F4B942] text-[16px] font-extrabold text-[#0B1F3A] shadow-lg transition-transform active:scale-[0.99]"
        >
          Get Started
        </motion.button>
        <button
          onClick={() => navigate("/auth?role=recycler")}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl border border-white/20 bg-white/5 text-[15px] font-bold text-white transition-colors active:bg-white/10"
        >
          <BuildingIcon className="size-5" />
          Recycler Portal
        </button>
        <p className="pt-1 text-center text-[11px] leading-snug text-white/45">
          Prototype — demo data and mock inference clearly labelled.
        </p>
      </div>
    </div>
  );
}

function FlowArrow() {
  return (
    <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-white/35">
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}
