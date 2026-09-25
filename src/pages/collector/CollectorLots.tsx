import { LotsIcon, ChevronRightIcon } from "@/components/icons";
import { EmptyState, LoadingState, StatusPill } from "@/components/ui/kit";
import { useAppState } from "@/lib/app-state";
import { formatINR, formatKg, timeAgo } from "@/lib/format";
import { useMaterials, useMyLots, useProfile } from "@/hooks/use-kc-data";

export default function CollectorLots({ onOpenLot }: { onOpenLot: (id: string) => void }) {
  const { t } = useAppState();
  const profile = useProfile();
  const lots = useMyLots(profile?._id);
  const { materials } = useMaterials();

  if (lots === undefined) return <LoadingState label={t("common.loading")} />;

  return (
    <div className="space-y-4 px-4 pt-4">
      <h1 className="text-[26px] font-extrabold tracking-tight text-navy">{t("lots.title")}</h1>

      {lots.length === 0 ? (
        <EmptyState
          icon={<LotsIcon className="size-10" />}
          title={t("lots.empty")}
          sub={t("lots.emptySub")}
        />
      ) : (
        <div className="space-y-2.5">
          {lots.map((lot) => {
            const mat = materials?.find((m) => m.code === lot.materialCode);
            return (
              <button
                key={lot._id}
                onClick={() => onOpenLot(lot._id)}
                className="clay-sm flex w-full items-center gap-3 rounded-2xl p-3 text-left clay-pressable"
              >
                {lot.photoDataUrl ? (
                  <img src={lot.photoDataUrl} alt="" className="size-14 shrink-0 rounded-xl object-cover" />
                ) : (
                  <span className="clay-flat flex size-14 shrink-0 items-center justify-center text-[13px] font-extrabold text-teal-deep">
                    {lot.materialCode.slice(0, 2).toUpperCase()}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[15px] font-extrabold text-navy">
                      {mat?.name ?? lot.materialCode}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[12px] text-muted2">
                    {lot.referenceId} · {formatKg(lot.weight)} · {timeAgo(lot.createdAt)}
                  </span>
                  <span className="mt-1.5 block">
                    <StatusPill status={lot.status} />
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-[15px] font-extrabold text-navy">
                    {lot.finalSaleValue ? formatINR(lot.finalSaleValue) : formatINR(lot.estimatedValue)}
                  </span>
                  <ChevronRightIcon className="size-4 text-muted2" />
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
