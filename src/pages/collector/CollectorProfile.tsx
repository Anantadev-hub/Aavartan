import { useNavigate } from "react-router";
import { useAuthActions } from "@convex-dev/auth/react";
import {
  ChevronRightIcon, LogOutIcon, MapPinIcon, ShieldCheckIcon, SpeakerIcon, UserIcon,
} from "@/components/icons";
import { ClayCard } from "@/components/ui/kit";
import { useAppState, setLang as applyLang } from "@/lib/app-state";
import { LANGS, LANG_LABELS } from "@/lib/i18n";
import { clearPendingProfile, clearLastAuth } from "@/lib/auth-service";
import { clearCache } from "@/lib/offline-cache";
import { useProfile } from "@/hooks/use-kc-data";
import type { AppProfile } from "@/hooks/use-kc-data";
import { cn } from "@/lib/utils";

/**
 * Collector Profile tab. Pure presentation: reads the existing profile state
 * and reuses the existing language, safety and logout handlers. No new logic.
 */
export default function CollectorProfile({ onOpenSafety }: { onOpenSafety: () => void }) {
  const { t, lang } = useAppState();
  const navigate = useNavigate();
  const { signOut } = useAuthActions();
  const profile = useProfile() as AppProfile | null | undefined;

  const name = profile?.name ?? "—";
  const phone = profile && "phone" in profile ? profile.phone : undefined;
  const area = profile && "collectionArea" in profile ? profile.collectionArea : undefined;
  const role = profile?.role ?? "collector";

  const logout = () => {
    // §1: clear the session, return to login. Account + data stay in the
    // cloud; the phone number re-links the account on next login.
    void (async () => {
      try {
        await signOut();
      } catch {
        /* session already gone */
      }
      clearPendingProfile();
      clearLastAuth();
      clearCache();
      navigate("/auth", { replace: true });
    })();
  };

  return (
    <div className="space-y-4 px-4 pb-6 pt-4">
      {/* Identity header */}
      <div className="flex items-center gap-3.5 rounded-3xl bg-navy p-4 text-white">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-white/15 text-lg font-extrabold uppercase">
          {name.trim()[0] ?? "A"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-extrabold leading-tight">{name}</p>
          <p className="mt-0.5 truncate text-[12.5px] text-white/70">{phone ?? "—"}</p>
          <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide">
            {role}
          </span>
        </div>
      </div>

      {/* Account group */}
      <ClayCard className="rounded-3xl p-0">
        <p className="px-4 pt-3.5 text-[11px] font-bold uppercase tracking-wider text-muted2">My profile</p>
        <div className="mt-1 divide-y divide-[var(--border)]">
          <div className="flex items-center gap-3 px-4 py-3">
            <span className="flex size-9 items-center justify-center rounded-full bg-mint text-[var(--teal)]">
              <UserIcon className="size-4.5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-bold text-navy">{name}</p>
              <p className="text-[11.5px] text-muted2">{phone ?? "No phone on file"}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 px-4 py-3">
            <span className="flex size-9 items-center justify-center rounded-full bg-mint text-[var(--teal)]">
              <MapPinIcon className="size-4.5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-bold text-navy">Collection area</p>
              <p className="text-[11.5px] text-muted2">{area ?? "—"}</p>
            </div>
          </div>
        </div>
      </ClayCard>

      {/* Language group — existing setLang */}
      <ClayCard className="rounded-3xl p-0">
        <p className="px-4 pt-3.5 text-[11px] font-bold uppercase tracking-wider text-muted2">Language</p>
        <div className="flex gap-2 p-3">
          {LANGS.map((l) => (
            <button
              key={l}
              onClick={() => applyLang(l)}
              aria-pressed={lang === l}
              className={cn(
                "min-h-11 flex-1 rounded-2xl text-[13px] font-bold clay-pressable transition-colors",
                lang === l ? "bg-navy text-white" : "bg-muted text-muted2",
              )}
            >
              {LANG_LABELS[l]}
            </button>
          ))}
        </div>
      </ClayCard>

      {/* Support group */}
      <ClayCard className="rounded-3xl p-0">
        <p className="px-4 pt-3.5 text-[11px] font-bold uppercase tracking-wider text-muted2">Help & safety</p>
        <div className="mt-1 divide-y divide-[var(--border)]">
          <button
            onClick={onOpenSafety}
            className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left clay-pressable"
          >
            <span className="flex size-9 items-center justify-center rounded-full bg-mint text-[var(--teal)]">
              <ShieldCheckIcon className="size-4.5" />
            </span>
            <span className="flex-1 text-[14px] font-bold text-navy">{t("home.qa.safety")}</span>
            <ChevronRightIcon className="size-4 text-muted2" />
          </button>
          <div className="flex items-center gap-3 px-4 py-3">
            <span className="flex size-9 items-center justify-center rounded-full bg-mint text-[var(--teal)]">
              <SpeakerIcon className="size-4.5" />
            </span>
            <span className="flex-1 text-[14px] font-bold text-navy">Voice prices</span>
            <span className="text-[11.5px] font-semibold text-muted2">On tap</span>
          </div>
        </div>
      </ClayCard>

      {/* Logout — same handler the Earnings page uses */}
      <button
        onClick={logout}
        className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-card text-[15px] font-bold text-[var(--danger)] shadow-[var(--clay-1)] clay-pressable"
      >
        <LogOutIcon className="size-5" /> Log out
      </button>

      <p className="pb-2 text-center text-[11px] text-muted2">Aavartan · prototype build</p>
    </div>
  );
}
