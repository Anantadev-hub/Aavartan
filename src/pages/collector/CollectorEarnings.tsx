import { WalletIcon, ChevronRightIcon, SparkleIcon } from "@/components/icons";
import { EmptyState, LoadingState, ClayCard, ClaySection, StatusPill, ClayButton } from "@/components/ui/kit";
import { useAppState, pushToast } from "@/lib/app-state";
import { speak } from "@/lib/app-state";
import { formatINR, formatDate, formatKg } from "@/lib/format";
import { useEarnings, useMaterials, useMyLots, useProfile, useEarningsSimulator, useEarningsLedger } from "@/hooks/use-kc-data";
import { useState } from "react";
import { cn } from "@/lib/utils";

export default function CollectorEarnings() {
  const { t, lang } = useAppState();
  const profile = useProfile();
  const { summary, monthly } = useEarnings(profile?._id);
  const lots = useMyLots(profile?._id);
  const { materials } = useMaterials();

  // Sell Smarter (§33): mixed vs sorted comparison — a labelled estimate.
  const [simWeight, setSimWeight] = useState(10);
  const sim = useEarningsSimulator(simWeight);
  const ledger = useEarningsLedger(profile?._id);

  if (summary === undefined || lots === undefined) {
    return <LoadingState label={t("common.loading")} />;
  }

  const sold = lots
    .filter((l) => l.paymentStatus === "completed")
    .sort((a, b) => (b.paymentAt ?? 0) - (a.paymentAt ?? 0));

  const maxMonthly = Math.max(1, ...(monthly ?? []).map((m) => m.amount));

  return (
    <div className="space-y-5 px-4 pt-4">
      <h1 className="text-[26px] font-extrabold tracking-tight text-navy">{t("earnings.title")}</h1>

      {/* Summary */}
      <ClayCard className="rounded-3xl border border-white/10 bg-[linear-gradient(135deg,#064E3B_0%,#047857_50%,#10B981_100%)] text-white">
        <p className="text-[11px] font-bold uppercase tracking-wider text-white/70">{t("earnings.total")}</p>
        <p className="mt-1 text-4xl font-extrabold">
          {formatINR(summary.totalEarnings)}
        </p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {[
            { l: t("earnings.thisMonth"), v: formatINR(summary.thisMonth, { compact: true }) },
            { l: t("earnings.lotsSold"), v: String(summary.lotsSold) },
            { l: t("earnings.avg"), v: formatINR(summary.avgLotValue) },
          ].map((s) => (
            <div key={s.l} className="rounded-2xl bg-white/10 px-2.5 py-2.5 text-center">
              <p className="text-[15px] font-extrabold">{s.v}</p>
              <p className="mt-0.5 text-[10px] font-semibold leading-tight text-white/75">{s.l}</p>
            </div
            >
          ))}
        </div>
      </ClayCard>

      {/* Sell Smarter (§33) — clearly labelled estimate */}
      <ClaySection title="Sell Smarter">
        <ClayCard className="rounded-3xl">
          <div className="flex items-center gap-2">
            <SparkleIcon className="size-4.5 text-teal" />
            <p className="text-[13.5px] font-extrabold text-navy">Mixed vs sorted sale (estimate)</p>
          </div>
          <div className="mt-3 flex items-center gap-2">
            {[5, 10, 25, 50].map((w) => (
              <button
                key={w}
                onClick={() => setSimWeight(w)}
                aria-pressed={simWeight === w}
                className={cn(
                  "min-h-10 rounded-xl px-3.5 text-[12.5px] font-bold clay-pressable",
                  simWeight === w ? "bg-navy text-teal" : "bg-card text-muted2 shadow-[var(--clay-1)]",
                )}
              >
                {w} kg
              </button>
            ))}
          </div>
          {sim && (
            <>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="clay-flat rounded-2xl px-3 py-2.5 text-center">
                  <p className="text-[10px] font-bold uppercase text-muted2">Mixed sale</p>
                  <p className="text-lg font-extrabold text-navy">{formatINR(sim.mixedSale)}</p>
                </div>
                <div className="rounded-2xl bg-[#064E3B] px-3 py-2.5 text-center">
                  <p className="text-[10px] font-bold uppercase text-teal/80">Sorted sale</p>
                  <p className="text-lg font-extrabold text-teal">{formatINR(sim.sortedSale)}</p>
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between rounded-2xl bg-[#451A03] px-3.5 py-2.5">
                <p className="text-[12.5px] font-semibold text-[var(--pending)]">
                  Potential extra by sorting
                </p>
                <p className="text-[15px] font-extrabold text-[var(--gold)]">
                  +{formatINR(sim.potentialDifference)}
                </p>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <p className="text-[10.5px] text-muted2">{sim.note}</p>
                <button
                  onClick={() =>
                    speak(
                      `Sorted sale estimate ${Math.round(sim.sortedSale / 10) * 10} rupees for ${simWeight} kilograms. Mixed sale about ${Math.round(sim.mixedSale / 10) * 10} rupees.`,
                      lang,
                    )
                  }
                  aria-label="Play estimate aloud"
                  className="clay-sm flex size-9 shrink-0 items-center justify-center text-teal"
                >
                  🔊
                </button>
              </div>
            </>
          )}
        </ClayCard>
      </ClaySection>

      {/* Monthly bars */}
      {(monthly?.length ?? 0) > 0 && (
        <ClaySection title="Monthly">
          <ClayCard className="rounded-3xl">
            <div className="flex h-28 items-end gap-2">
              {(monthly ?? []).slice(-8).map((m) => (
                <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-[9px] font-bold text-muted2">{formatINR(m.amount, { compact: true })}</span>
                  <div
                    className="w-full rounded-t-xl bg-teal/75"
                    style={{ height: `${Math.max(6, (m.amount / maxMonthly) * 88)}px` }}
                  />
                  <span className="text-[9.5px] font-semibold text-muted2">{m.month.slice(5)}</span>
                </div>
              ))}
            </div>
          </ClayCard>
          </ClaySection>
      )}

      {/* History */}
      <ClaySection title="Transactions">
        {sold.length === 0 ? (
          <EmptyState
            icon={<WalletIcon className="size-10" />}
            title="No completed sales yet"
            sub="Once a lot is handed over and paid, it appears here."
          />
        ) : (
          <div className="space-y-2.5">
            {sold.map((lot) => {
              const mat = materials?.find((m) => m.code === lot.materialCode);
              return (
                <div key={lot._id} className="clay-sm rounded-2xl p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-extrabold text-navy">
                        {mat?.name ?? lot.materialCode} · {formatKg(lot.weight)}
                      </p>
                      <p className="mt-0.5 text-[11.5px] text-muted2">
                        {lot.referenceId} · {formatDate(lot.paymentAt)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[15px] font-extrabold text-[var(--verified)]">
                        +{formatINR(lot.finalSaleValue ?? 0)}
                      </p>
                      <span className="mt-1 inline-block"><StatusPill status="completed_payment" /></span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ClaySection>
    </div>
  );
}
