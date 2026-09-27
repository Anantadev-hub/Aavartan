import { useState } from "react";
import { PriceTagIcon, ShieldCheckIcon } from "@/components/icons";
import {
  ClayBadge, ClayButton, ClayCard, ClayInput, ClaySection, EmptyState, LoadingState,
} from "@/components/ui/kit";
import { useAppState } from "@/lib/app-state";
import { formatINR } from "@/lib/format";
import {
  useMyQuotes, useFacility, useSubmitQuote, useMaterials,
} from "@/hooks/use-kc-data";
import type { Id } from "@/convex/_generated/dataModel";

// ---------------------------------------------------------------------------
// Part 1 §2 — Recyclers submit buying quotes for materials they accept.
// Server enforces: role, facility binding, accepted-materials check. Quotes
// feed the price-discovery engine (median → Price Board reference).
// ---------------------------------------------------------------------------

export default function RecyclerQuotes({ recyclerId }: { recyclerId: string | null }) {
  const { t, toast } = useAppState();
  const quotes = useMyQuotes();
  const facility = useFacility(recyclerId ? (recyclerId as never) : undefined);
  const { materials } = useMaterials();
  const submitQuote = useSubmitQuote();

  const [material, setMaterial] = useState("");
  const [price, setPrice] = useState("");
  const [minQty, setMinQty] = useState("10");
  const [pickup, setPickup] = useState(true);
  const [validDays, setValidDays] = useState("7");
  const [busy, setBusy] = useState(false);

  if (quotes === undefined) return <LoadingState label={t("common.loading")} />;

  const accepted = facility?.materialsAccepted ?? [];
  const acceptedMaterials = (materials ?? []).filter((m) => accepted.includes(m.code));

  const submit = () => {
    if (!material || !price) return;
    setBusy(true);
    submitQuote({
      materialCode: material,
      pricePerKg: Number(price),
      minimumQuantityKg: Number(minQty) || 0,
      pickupAvailable: pickup,
      serviceArea: facility?.serviceArea ?? "Delhi/NCR",
      validDays: Number(validDays) || 7,
    })
      .then(() => {
        toast("Quote published — collectors see your rate", "success");
        setPrice("");
      })
      .catch((e) => toast(e instanceof Error ? e.message : "Could not submit quote", "error"))
      .finally(() => setBusy(false));
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-navy">My buying quotes</h1>
        <p className="mt-1 text-sm text-muted2">
          Your active quotes feed the collector Price Board — the reference price is the median of
          all active recycler quotes.
        </p>
      </div>

      {!recyclerId && (
        <ClayCard className="rounded-3xl border-l-4 border-[var(--pending)]">
          <p className="text-[13px] font-bold text-navy">Facility binding pending</p>
          <p className="mt-1 text-[12.5px] text-muted2">
            Quotes unlock as soon as your facility binding syncs — no action needed.
          </p>
        </ClayCard>
      )}

      {recyclerId && (
        <ClaySection title="Publish a quote">
          <ClayCard className="rounded-3xl">
            {acceptedMaterials.length === 0 ? (
              <p className="text-[13px] text-muted2">Loading accepted materials…</p>
            ) : (
              <div className="space-y-3">
                <div>
                  <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted2">
                    Material (your facility's accepted list)
                  </p>
                  <select
                    value={material}
                    onChange={(e) => setMaterial(e.target.value)}
                    className="clay-sm w-full rounded-2xl bg-background px-3.5 py-2.5 text-[14px] font-bold text-navy outline-none"
                  >
                    <option value="">Select material</option>
                    {acceptedMaterials.map((m) => (
                      <option key={m.code} value={m.code}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted2">
                      Your price (₹/kg)
                    </p>
                    <ClayInput inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="415" />
                  </div>
                  <div>
                    <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted2">
                      Minimum quantity (kg)
                    </p>
                    <ClayInput inputMode="decimal" value={minQty} onChange={(e) => setMinQty(e.target.value)} />
                  </div>
                  <div>
                    <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted2">
                      Valid for (days)
                    </p>
                    <ClayInput inputMode="numeric" value={validDays} onChange={(e) => setValidDays(e.target.value)} />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-[13px] font-semibold text-navy">
                  <input type="checkbox" checked={pickup} onChange={(e) => setPickup(e.target.checked)} className="size-4 accent-teal" />
                  Pickup available for this quote
                </label>
                <ClayButton onClick={submit} disabled={!material || !price || busy} className="w-full sm:w-auto">
                  <PriceTagIcon className="size-5" />
                  {busy ? "Publishing…" : "Publish quote"}
                </ClayButton>
                <p className="text-[11.5px] text-muted2">
                  Only materials your facility accepts can be quoted. Re-publishing replaces your
                  previous active quote for that material.
                </p>
              </div>
            )}
          </ClayCard>
        </ClaySection>
      )}

      <ClaySection title="My quotes">
        {quotes.length === 0 ? (
          <EmptyState title="No quotes yet" sub="Publish your first buying quote above." />
        ) : (
          <div className="space-y-2.5">
            {quotes.map((q) => {
              const expired = q.validUntil <= Date.now();
              return (
                <ClayCard key={q._id} className="rounded-3xl">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-[14.5px] font-extrabold text-navy">
                        {(materials ?? []).find((m) => m.code === q.materialCode)?.name ?? q.materialCode.toUpperCase()}
                      </p>
                      <p className="text-[11.5px] text-muted2">
                        min {q.minimumQuantityKg} kg · {q.pickupAvailable ? "pickup" : "walk-in"} ·{" "}
                        {q.serviceArea}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[16px] font-extrabold text-teal-deep">{formatINR(q.pricePerKg)}/kg</p>
                      <ClayBadge tone={q.quoteStatus === "ACTIVE" && !expired ? "green" : "amber"}>
                        <ShieldCheckIcon className="size-3.5" />
                        {expired ? "Expired" : q.quoteStatus}
                      </ClayBadge>
                    </div>
                  </div>
                  <p className="mt-2 text-[11px] text-muted2">
                    Valid {new Date(q.validFrom).toLocaleDateString("en-IN")} –{" "}
                    {new Date(q.validUntil).toLocaleDateString("en-IN")}
                  </p>
                </ClayCard>
              );
            })}
          </div>
        )}
      </ClaySection>
    </div>
  );
}
