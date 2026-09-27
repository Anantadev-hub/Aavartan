import { WalletIcon, ChevronRightIcon, SparkleIcon, LogOutIcon, ShieldCheckIcon, MapPinIcon } from "@/components/icons";
import { EmptyState, LoadingState, ClayCard, ClaySection, StatusPill, ClayButton, ClayBadge } from "@/components/ui/kit";
import { useAppState, pushToast, speak } from "@/lib/app-state";
import { useAuthActions } from "@convex-dev/auth/react";
import { LANG_LABELS } from "@/lib/i18n";
import { clearPendingProfile, clearLastAuth } from "@/lib/auth-service";
import { formatINR, formatDate, formatKg } from "@/lib/format";
import {
  useEarnings, useMaterials, useMyLots, useProfile, useEarningsSimulator,
  useEarningsLedger, useWeeklyReport, type AppProfile,
} from "@/hooks/use-kc-data";
import { useState } from "react";
import { useNavigate } from "react-router";
import { cn } from "@/lib/utils";

export default function CollectorEarnings() {
  const { t, lang } = useAppState();
  const navigate = useNavigate();
  const { signOut } = useAuthActions();
  const profile = useProfile() as AppProfile | null | undefined;
  const { summary, monthly } = useEarnings(
    profile && "_id" in profile ? profile._id : undefined,
  );
  const lots = useMyLots(profile?._id);
  const { materials } = useMaterials();

  // Sell Smarter (§33): mixed vs sorted comparison — a labelled estimate.
  const [simWeight, setSimWeight] = useState(10);
  const sim = useEarningsSimulator(simWeight);
  const ledger = useEarningsLedger(profile?._id);
  // §11/§12 weekly net earnings report (completed + PAID lots only).
  const weekly = useWeeklyReport(profile?._id);

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

      {/* §1/§4 Account card — cloud-persistent profile details + Logout. */}
      <ClayCard className="rounded-3xl">
        <div className="flex items-start gap-3">
          <span className="clay-sm flex size-11 shrink-0 items-center justify-center text-teal">
            <ShieldCheckIcon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[16px] font-extrabold text-navy">{profile?.name ?? "—"}</p>
            <p className="mt-0.5 truncate text-[12.5px] text-muted2">{profile?.phone ?? ""}</p>
          </div>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <ClayBadge tone="teal">{profile?.role === "collector" ? "Collector" : (profile?.role ?? "—")}</ClayBadge>
          {(() => {
            const p = profile as AppProfile | null | undefined;
            if (!p) return null;
            const area = "collectionArea" in p ? (p as { collectionArea?: string }).collectionArea : undefined;
            const language = "preferredLanguage" in p ? (p as { preferredLanguage?: "en" | "hi" | "mr" }).preferredLanguage : undefined;
            return (
              <>
                {area && (
                  <ClayBadge tone="neutral">
                    <MapPinIcon className="size-3" /> {area}
                  </ClayBadge>
                )}
                {language && <ClayBadge tone="neutral">{LANG_LABELS[language]}</ClayBadge>}
              </>
            );
          })()}
        </div>
        <ClayButton
          variant="surface"
          className="mt-3 w-full"
          onClick={() => {
            // §1: clear the session, return to login. Account + data stay in
            // the cloud; the phone number re-links the account on next login.
            void (async () => {
              try {
                await signOut();
              } catch {
                /* session already gone */
              }
              clearPendingProfile();
              clearLastAuth();
              navigate("/auth", { replace: true });
            })();
          }}
        >
          <LogOutIcon className="size-5" /> Logout
        </ClayButton>
      </ClayCard>

      {/* Summary */}
      <ClayCard className="rounded-3xl border border-white/10 bg-[linear-gradient(135deg,#0B1F3A_0%,#00564E_50%,#00786B_100%)] text-white">
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

      {/* §11/§12 Weekly Report — completed + PAID sales only. */}
      <ClaySection title="Weekly Report">
        <ClayCard className="rounded-3xl">
          {weekly ? (
            <>
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-muted2">Net earnings this week</p>
                  <p className="mt-0.5 text-3xl font-extrabold text-navy">{formatINR(weekly.net)}</p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-muted2">Previous week</p>
                  <p className="text-[15px] font-extrabold text-muted2">{formatINR(weekly.prevGross)}</p>
                  <p
                    className={cn(
                      "mt-0.5 text-[12.5px] font-extrabold",
                      weekly.change > 0
                        ? "text-[var(--verified)]"
                        : weekly.change < 0
                          ? "text-[var(--danger)]"
                          : "text-muted2",
                    )}
                  >
                    {weekly.change > 0 ? "+" : ""}{formatINR(weekly.change)}
                    {weekly.changePct != null ? ` (${weekly.change > 0 ? "+" : ""}${weekly.changePct}%)` : ""}
                  </p>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2">
                {[
                  { l: "Completed sales", v: String(weekly.completedSales) },
                  { l: "Material sold", v: formatKg(weekly.materialSoldKg) },
                  { l: "Avg per sale", v: formatINR(weekly.avgSale) },
                ].map((s) => (
                  <div key={s.l} className="clay-sm rounded-2xl px-2 py-2.5 text-center">
                    <p className="text-[15px] font-extrabold text-navy">{s.v}</p>
                    <p className="mt-0.5 text-[9.5px] font-semibold leading-tight text-muted2">{s.l}</p>
                  </div>
                ))}
              </div>

              {/* Trend visualization — per-day earnings this week. */}
              <div className="mt-3 flex h-16 items-end gap-1.5">
                {weekly.daily.map((d) => {
                  const max = Math.max(1, ...weekly.daily.map((x) => x.amount));
                  return (
                    <div key={d.day} className="flex flex-1 flex-col items-center gap-1">
                      <div
                        className={cn("w-full rounded-t-lg", d.amount > 0 ? "bg-teal/75" : "bg-muted")}
                        style={{ height: `${Math.max(6, (d.amount / max) * 44)}px` }}
                      />
                      <span className="text-[8.5px] font-semibold text-muted2">{d.day}</span>
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 text-[11px] text-muted2">{weekly.note}</p>
            </>
          ) : (
            <p className="text-sm text-muted2">Loading weekly report…</p>
          )}
        </ClayCard>
      </ClaySection>

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
                  simWeight === w ? "bg-navy text-white" : "bg-card text-muted2 shadow-[var(--clay-1)]",
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
                <div className="rounded-2xl bg-mint px-3 py-2.5 text-center">
                  <p className="text-[10px] font-bold uppercase text-[var(--teal)]/80">Sorted sale</p>
                  <p className="text-lg font-extrabold text-teal">{formatINR(sim.sortedSale)}</p>
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between rounded-2xl bg-[var(--gold)] px-3.5 py-2.5">
                <p className="text-[12.5px] font-semibold text-[var(--navy)]">
                  Potential extra by sorting
                </p>
                <p className="text-[15px] font-extrabold text-[var(--navy)]">
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
