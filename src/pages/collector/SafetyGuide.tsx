import { useState } from "react";
import { ChevronLeftIcon, SpeakerIcon, WarningIcon } from "@/components/icons";
import { ClayCard, LoadingState, ClayBadge } from "@/components/ui/kit";
import { useAppState, speak } from "@/lib/app-state";
import { useSafetyGuides } from "@/hooks/use-kc-data";
import { cn } from "@/lib/utils";

export default function SafetyGuide({ onClose }: { onClose: () => void }) {
  const { t, lang } = useAppState();
  const guides = useSafetyGuides(); // offline-aware (same return shape)
  const [openCode, setOpenCode] = useState<string | null>("battery");

  if (guides === undefined) {
    return (
      <div className="flex flex-1 flex-col">
        <div className="px-4 pt-4">
          <HeaderBlock onClose={onClose} title={t("home.qa.safety")} />
        </div>
        <LoadingState label={t("common.loading")} />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="px-4 pt-4">
        <HeaderBlock onClose={onClose} title={t("home.qa.safety")} />
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-4 pb-6 pt-3">
        {guides.map((g) => {
          const title = lang === "hi" ? g.titleHi : lang === "mr" ? g.titleMr : g.title;
          const tips = lang === "hi" ? g.tipsHi : lang === "mr" ? g.tipsMr : g.tips;
          const open = openCode === g.materialCode;
          const riskTone =
            g.materialCode === "battery" || g.materialCode === "crt" ? "red" : "gold";
          return (
            <ClayCard key={g._id} className="rounded-3xl">
              <button
                onClick={() => setOpenCode(open ? null : g.materialCode)}
                aria-expanded={open}
                className="flex w-full items-center gap-3 text-left"
              >
                <span
                  className={cn(
                    "clay-sm flex size-10 shrink-0 items-center justify-center",
                    riskTone === "red" ? "text-[var(--danger)]" : "text-[var(--gold)]",
                  )}
                >
                  <WarningIcon className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-extrabold text-navy">{title}</span>
                  <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted2">
                    {tips.length} safety rules
                  </span>
                </span>
                <ChevronLeftIcon className={cn("size-4.5 shrink-0 text-muted2 transition-transform", open ? "-rotate-90" : "rotate-90")} />
              </button>
              {open && (
                <div className="mt-3 space-y-2">
                  {tips.map((tip, i) => (
                    <div key={i} className="flex items-start justify-between gap-2 rounded-2xl bg-muted px-3.5 py-2.5">
                      <p className="text-[13px] leading-snug text-foreground">{tip}</p>
                      <button
                        onClick={() => speak(tip, lang)}
                        aria-label={`Read aloud: ${tip}`}
                        className="clay-flat flex size-9 shrink-0 items-center justify-center text-teal clay-pressable"
                      >
                        <SpeakerIcon className="size-4.5" />
                      </button>
                    </div>
                  ))}
                  <p className="flex items-center gap-1.5 pt-1 text-[10.5px] text-muted2">
                    <WarningIcon className="size-3.5 shrink-0 text-[var(--gold)]" />
                    Demo content — validate with CPCB/EPA guidance before production use.
                  </p>
                </div>
              )}
            </ClayCard>
          );
        })}
      </div>
    </div>
  );
}

function HeaderBlock({ onClose, title }: { onClose: () => void; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onClose}
        aria-label="Back"
        className="clay-sm flex size-10 items-center justify-center text-navy clay-pressable"
      >
        <ChevronLeftIcon className="size-5" />
      </button>
      <h1 className="text-[22px] font-extrabold tracking-tight text-navy">{title}</h1>
    </div>
  );
}
