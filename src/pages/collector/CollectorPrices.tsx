import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { SpeakerIcon, TrendUpIcon, TrendDownIcon } from "@/components/icons";
import { ClayCard, ClaySection, EmptyState } from "@/components/ui/kit";
import { TrendChart } from "@/components/ui/timeline";
import { useAppState, speak } from "@/lib/app-state";
import { formatINR, percentChange } from "@/lib/format";
import { spokenPriceSentence } from "@/lib/i18n";
import { useMaterials, usePriceTrends } from "@/hooks/use-kc-data";
import { cn } from "@/lib/utils";

export default function CollectorPrices() {
  const { t, lang } = useAppState();
  const { materials, cached } = useMaterials();
  const [selected, setSelected] = useState<string>("pcb");
  const [days, setDays] = useState<7 | 30 | 90>(30);

  const trends = useQuery(api.materials.priceTrends, { materialCode: selected, days });
  const rows = materials ?? cached?.data ?? [];
  const isOfflineView = !materials && !!cached;
  const current = rows.find((m) => m.code === selected) ?? rows[0];

  const speakPrice = (name: string, price: number, unit: string) =>
    speak(spokenPriceSentence(name, price, unit, lang), lang);

  return (
    <div className="space-y-5 px-4 pt-4">
      <div>
        <h1 className="text-[26px] font-extrabold tracking-tight text-navy">{t("prices.title")}</h1>
        <p className="mt-1 text-sm text-muted2">{t("prices.disclaimer")}</p>
      </div>

      {rows.length === 0 && (
        <EmptyState
          title="No prices loaded"
          sub="Connect once to load the indicative price board."
        />
      )}

      {/* Price cards */}
      <div className="space-y-2.5">
        {rows.map((m) => {
          const change = percentChange(m.currentPrice, m.prevPrice);
          const up = change >= 0;
          return (
            <button
              key={m.code}
              onClick={() => setSelected(m.code)}
              aria-pressed={selected === m.code}
              className={cn(
                "clay-sm flex w-full items-center gap-3 rounded-2xl p-3.5 text-left clay-pressable",
                selected === m.code && "ring-2 ring-teal",
              )}
            >
              <span className="clay-flat flex size-11 shrink-0 items-center justify-center text-teal-deep">
                <span className="text-[15px] font-extrabold">{m.code.slice(0, 2).toUpperCase()}</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-extrabold text-navy">{m.name}</span>
                <span className="block text-[11.5px] text-muted2">{t("prices.updated")}</span>
              </span>
              <span className="text-right">
                <span className="block text-[15px] font-extrabold text-navy">
                  {formatINR(m.currentPrice)}
                  <span className="text-[11px] font-bold text-muted2">/{m.unit}</span>
                </span>
                <span
                  className={cn(
                    "mt-0.5 inline-flex items-center gap-0.5 text-[11.5px] font-bold",
                    up ? "text-[var(--verified)]" : "text-[var(--danger)]",
                  )}
                >
                  {up ? <TrendUpIcon className="size-3.5" /> : <TrendDownIcon className="size-3.5" />}
                  {up ? "+" : ""}{change}%
                </span>
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  speakPrice(m.name, m.currentPrice, m.unit);
                }}
                aria-label={`Hear price for ${m.name}`}
                className="clay-flat ml-1 flex size-10 shrink-0 items-center justify-center text-teal clay-pressable"
              >
                <SpeakerIcon className="size-5" />
              </button>
            </button>
          );
        })}
      </div>

      {/* Trends */}
      {current && (
        <ClaySection title={t("prices.trends")}>
          <ClayCard className="rounded-3xl">
            <div className="flex items-center justify-between">
              <p className="text-[15px] font-extrabold text-navy">{current.name}</p>
              <div className="flex gap-1">
                {([7, 30, 90] as const).map((d) => (
                  <button
                    key={d}
                    onClick={() => setDays(d)}
                    aria-pressed={days === d}
                    className={cn(
                      "rounded-xl px-2.5 py-1.5 text-[11.5px] font-bold clay-pressable",
                      days === d ? "bg-navy text-mint" : "bg-muted text-muted2",
                    )}
                  >
                    {d}d
                  </button>
                ))}
              </div>
            </div>
            {isOfflineView ? (
              <p className="mt-3 text-sm text-muted2">Showing cached prices — connect for trends.</p>
            ) : trends === undefined ? (
              <div className="clay-track mt-3 h-[120px]" />
            ) : (
              <div className="mt-3">
                <TrendChart points={trends.map((p) => p.price)} />
                <div className="mt-2 flex items-center justify-between text-[12px] text-muted2">
                  <span>Low {formatINR(Math.min(...trends.map((p) => p.price)))}</span>
                  <span>High {formatINR(Math.max(...trends.map((p) => p.price)))}</span>
                </div>
                <p className="mt-2 text-[12px] text-muted2">{t("prices.disclaimer")}</p>
              </div>
            )}
          </ClayCard>
        </ClaySection>
      )}
    </div>
  );
}
