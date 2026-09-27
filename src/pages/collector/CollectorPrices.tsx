import { useEffect, useRef, useState } from "react";
import { SpeakerIcon, TrendUpIcon, TrendDownIcon, RefreshIcon } from "@/components/icons";
import { ClayCard, ClaySection, EmptyState } from "@/components/ui/kit";
import { TrendChart } from "@/components/ui/timeline";
import { useAppState, speak } from "@/lib/app-state";
import { formatINR, formatDateTime } from "@/lib/format";
import { spokenPriceSentence } from "@/lib/i18n";
import {
  useCurrentMarketPrices,
  useMarketPriceHistory,
  useFairPriceRange,
  useRefreshPrices,
} from "@/hooks/use-kc-data";
import { cn } from "@/lib/utils";

export default function CollectorPrices() {
  const { t, lang } = useAppState();
  // §7: the board reads ONLY stored backend market records — no hardcoded
  // prices, no frontend calls to external market sites. The hook transparently
  // serves the last fetched copy when offline (§11 "Latest available").
  const payload = useCurrentMarketPrices();
  const [selected, setSelected] = useState<string>("pcb");
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [refreshing, setRefreshing] = useState(false);
  const refreshPrices = useRefreshPrices();

  // §14: fetch on board open / app resume — throttled so we don't run the
  // provider on every visit; the reactive backend query keeps the view fresh.
  const autoFetched = useRef(false);
  useEffect(() => {
    if (autoFetched.current) return;
    autoFetched.current = true;
    const last = payload?.provider?.lastAttemptAt ?? 0;
    if (Date.now() - last > 60 * 60 * 1000) {
      void refreshPrices();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const history = useMarketPriceHistory(selected, days);
  const fairRange = useFairPriceRange(selected);

  const rows = payload?.prices ?? [];
  const current = rows.find((r) => r.materialCode === selected) ?? rows[0];

  const speakPrice = (name: string, price: number, unit: string) =>
    speak(spokenPriceSentence(name, price, unit, lang), lang);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshPrices();
    } finally {
      setRefreshing(false);
    }
  };

  const formatDay = (day: string) =>
    new Date(day + "T00:00:00Z").toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });

  return (
    <div className="space-y-5 px-4 pt-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-extrabold tracking-tight text-navy">{t("prices.title")}</h1>
          <p className="mt-1 text-sm text-muted2">{t("prices.disclaimer")}</p>
        </div>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="Refresh prices"
          className={cn(
            "clay-flat mt-1 flex size-11 shrink-0 items-center justify-center text-teal clay-pressable",
            refreshing && "animate-pulse opacity-60",
          )}
        >
          <RefreshIcon className="size-5" />
        </button>
      </div>

      {/* Honest terminology (§8) — derived from the provider's real cadence */}
      {(current ?? payload?.provider) && (
        <div className="clay-sm rounded-2xl px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-teal-deep">
            {current?.terminology.headline ?? "Reference price"}
          </p>
          <p className="mt-0.5 text-[12px] leading-snug text-muted2">
            {current?.terminology.note ??
              payload?.provider?.lastError ??
              "Stored backend records with source and timestamp."}
          </p>
        </div>
      )}

      {rows.length === 0 && (
        <EmptyState
          title="No prices loaded yet"
          sub="Connect once and tap refresh — the backend ingests and stores market records."
        />
      )}

      {/* Price cards — every value comes from a stored market record (§7) */}
      <div className="space-y-2.5">
        {rows.map((p) => {
          const up = (p.changePerKg ?? 0) >= 0;
          return (
            <button
              key={p.materialCode}
              onClick={() => setSelected(p.materialCode)}
              aria-pressed={selected === p.materialCode}
              className={cn(
                "clay-sm flex w-full items-center gap-3 rounded-2xl p-3.5 text-left clay-pressable",
                selected === p.materialCode && "ring-2 ring-teal",
              )}
            >
              <span className="clay-flat flex size-11 shrink-0 items-center justify-center text-teal-deep">
                <span className="text-[15px] font-extrabold">{p.materialCode.slice(0, 2).toUpperCase()}</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-extrabold text-navy">{p.name}</span>
                <span className="block truncate text-[11.5px] text-muted2">
                  Updated {formatDay(p.day)} · {p.sourceName}
                </span>
              </span>
              <span className="text-right">
                <span className="block text-[15px] font-extrabold text-navy">
                  {formatINR(p.pricePerKg)}
                  <span className="text-[11px] font-bold text-muted2">/{p.unit}</span>
                </span>
                {p.changePerKg !== null && p.changePct !== null && (
                  <span
                    className={cn(
                      "mt-0.5 inline-flex items-center gap-0.5 text-[11.5px] font-bold",
                      up ? "text-[var(--verified)]" : "text-[var(--danger)]",
                    )}
                  >
                    {up ? <TrendUpIcon className="size-3.5" /> : <TrendDownIcon className="size-3.5" />}
                    {up ? "+" : "−"}₹{Math.abs(p.changePerKg)} ({up ? "+" : "−"}
                    {Math.abs(p.changePct)}%)
                  </span>
                )}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  speakPrice(p.name, p.pricePerKg, p.unit);
                }}
                aria-label={`Hear price for ${p.name}`}
                className="clay-flat ml-1 flex size-10 shrink-0 items-center justify-center text-teal clay-pressable"
              >
                <SpeakerIcon className="size-5" />
              </button>
            </button>
          );
        })}
      </div>

      {/* §17 Source transparency — from the stored record only */}
      {current && (
        <ClaySection title="Price source">
          <ClayCard className="rounded-3xl p-4">
            <div className="flex items-baseline justify-between">
              <p className="text-2xl font-extrabold text-navy">
                {formatINR(current.pricePerKg)}
                <span className="text-sm font-bold text-muted2">/{current.unit}</span>
              </p>
              {current.changePerKg !== null && (
                <span
                  className={cn(
                    "text-[12.5px] font-bold",
                    current.changePerKg >= 0 ? "text-[var(--verified)]" : "text-[var(--danger)]",
                  )}
                >
                  Today's change: {current.changePerKg >= 0 ? "+" : "−"}₹{Math.abs(current.changePerKg)}
                  {current.changePct !== null
                    ? ` (${current.changePerKg >= 0 ? "+" : "−"}${Math.abs(current.changePct)}%)`
                    : ""}
                </span>
              )}
            </div>
            <dl className="mt-3 space-y-1.5 text-[13px]">
              <div className="flex justify-between gap-3">
                <dt className="text-muted2">Material</dt>
                <dd className="font-bold text-navy">{current.name}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted2">Location</dt>
                <dd className="font-bold text-navy">{current.location}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted2">Grade</dt>
                <dd className="font-bold text-navy">{current.grade}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted2">Last updated</dt>
                <dd className="font-bold text-navy">{formatDateTime(current.recordedAt)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted2">Source</dt>
                <dd className="max-w-[60%] text-right font-bold text-navy">{current.sourceName}</dd>
              </div>
              {fairRange && fairRange.records > 1 && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted2">Recent range</dt>
                  <dd className="font-bold text-navy">
                    {formatINR(fairRange.low)}–{formatINR(fairRange.high)}/kg
                  </dd>
                </div>
              )}
            </dl>
            {fairRange && fairRange.records > 1 && (
              <p className="mt-2 text-[11.5px] leading-snug text-muted2">
                Range from {fairRange.records} stored records — a neutral reference, not a price you
                must accept.
              </p>
            )}
          </ClayCard>
        </ClaySection>
      )}

      {/* Trends — plotted strictly from stored backend records (§15) */}
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
                      days === d ? "bg-navy text-teal" : "bg-muted text-muted2",
                    )}
                  >
                    {d}d
                  </button>
                ))}
              </div>
            </div>
            {history === undefined ? (
              <div className="clay-track mt-3 h-[120px]" />
            ) : history.length === 0 ? (
              <p className="mt-3 text-sm text-muted2">
                No stored records yet for this window — the daily job builds history over time.
              </p>
            ) : (
              <div className="mt-3">
                <TrendChart points={history.map((p) => p.pricePerKg)} />
                <div className="mt-2 flex items-center justify-between text-[12px] text-muted2">
                  <span>Low {formatINR(Math.min(...history.map((p) => p.pricePerKg)))}</span>
                  <span>High {formatINR(Math.max(...history.map((p) => p.pricePerKg)))}</span>
                </div>
                <p className="mt-2 text-[12px] text-muted2">
                  {history.length} stored record{history.length > 1 ? "s" : ""} · source{" "}
                  {history[history.length - 1].sourceName}. {t("prices.disclaimer")}
                </p>
              </div>
            )}
          </ClayCard>
        </ClaySection>
      )}
    </div>
  );
}
