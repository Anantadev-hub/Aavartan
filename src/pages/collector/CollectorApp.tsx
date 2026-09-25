import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppHeader, BottomNav, PhoneFrame, type NavTab } from "@/components/shell";
import { OfflineBanner, LoadingState, Toasts, SyncIndicator } from "@/components/ui/kit";
import { useAppState, useSyncWorker, setOnline } from "@/lib/app-state";
import { useProfile, hasBackendId, usePendingProfileSync } from "@/hooks/use-kc-data";
import CollectorHome from "./CollectorHome";
import CollectorPrices from "./CollectorPrices";
import AddFlow from "./AddFlow";
import CollectorLots from "./CollectorLots";
import CollectorEarnings from "./CollectorEarnings";
import SafetyGuide from "./SafetyGuide";
import FindRecycler from "./FindRecycler";
import LotDetail from "./LotDetail";

type Overlay =
  | null
  | { kind: "safety" }
  | { kind: "recyclers"; materialCode?: string; weightKg?: number };

function Redirect({ to }: { to: string }) {
  const navigate = useNavigate();
  useEffect(() => {
    navigate(to, { replace: true });
  }, [navigate, to]);
  return null;
}

export default function CollectorApp() {
  const { t } = useAppState();
  const profile = useProfile();
  const [tab, setTab] = useState<NavTab>("home");
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [openLotId, setOpenLotId] = useState<Id<"lots"> | null>(null);

  // Seed reference data once at bootstrap (public mutation; no-op after first run).
  const seed = useMutation(api.seed.seedIfEmpty);
  useEffect(() => {
    seed({}).catch(() => undefined);
  }, [seed]);

  // Online/offline listeners drive the offline-first UX.
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    setOnline(navigator.onLine);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  // If onboarding happened offline, sync the profile in the background once
  // connectivity is available ("Pending Sync" is invisible in the UI).
  usePendingProfileSync();

  // Flush the offline queue whenever we are online and items are waiting.
  // A locally onboarded (Pending Sync) profile has no backend id yet, so the
  // worker stays paused until the background profile sync completes.
  const syncQueue = useMutation(api.sync.syncQueue);
  useSyncWorker(
    async (drafts) => {
      if (!hasBackendId(profile)) throw new Error("Profile not ready");
      const res = await syncQueue({ collectorId: profile._id, drafts });
      return { synced: res.synced };
    },
    hasBackendId(profile), // only when a backend profile actually exists
  );

  if (profile === undefined) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <LoadingState label={t("common.loading")} />
      </div>
    );
  }
  if (profile === null) {
    return <Redirect to="/auth" />;
  }
  if (profile.role !== "collector") {
    return <Redirect to="/recycler" />;
  }

  if (openLotId) {
    return (
      <PhoneFrame>
        <LotDetail lotId={openLotId} onBack={() => setOpenLotId(null)} />
        <Toasts />
      </PhoneFrame>
    );
  }

  if (overlay?.kind === "safety") {
    return (
      <PhoneFrame>
        <SafetyGuide onClose={() => setOverlay(null)} />
      </PhoneFrame>
    );
  }

  if (overlay?.kind === "recyclers") {
    return (
      <PhoneFrame>
        <FindRecycler
          materialCode={overlay.materialCode}
          weightKg={overlay.weightKg}
          onClose={() => setOverlay(null)}
          onCreated={(lotId) => {
            setOverlay(null);
            setTab("lots");
            setOpenLotId(lotId);
          }}
        />
        <Toasts />
      </PhoneFrame>
    );
  }

  return (
    <PhoneFrame>
      <AppHeader title="Kabadiwala Connect" right={<SyncIndicator />} />
      <OfflineBanner />
      <main className="flex-1 overflow-y-auto">
        {tab === "home" && (
          <CollectorHome
            onNavigate={(next) => setTab(next)}
            onOpenSafety={() => setOverlay({ kind: "safety" })}
            onOpenRecyclers={(materialCode) => setOverlay({ kind: "recyclers", materialCode })}
          />
        )}
        {tab === "prices" && <CollectorPrices />}
        {tab === "add" && (
          <AddFlow
            onDone={(lotId) => {
              setTab("lots");
              setOpenLotId(lotId);
            }}
            onCancel={() => setTab("home")}
            onFindRecycler={(materialCode, weightKg) =>
              setOverlay({ kind: "recyclers", materialCode, weightKg })
            }
          />
        )}
        {tab === "lots" && <CollectorLots onOpenLot={(id) => setOpenLotId(id as Id<"lots">)} />}
        {tab === "earnings" && <CollectorEarnings />}
      </main>
      <BottomNav active={tab} onNavigate={setTab} />
      <Toasts />
    </PhoneFrame>
  );
}
