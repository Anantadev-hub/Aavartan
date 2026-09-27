import type { ReactNode } from "react";
import {
  HomeIcon, LotsIcon, PlusIcon, WalletIcon, UserIcon,
} from "@/components/icons";
import { useAppState } from "@/lib/app-state";
import { SyncIndicator } from "@/components/ui/kit";
import { cn } from "@/lib/utils";

// Phone frame wrapper: full-bleed on mobile, device-like frame on desktop.
export function PhoneFrame({ children }: { children: ReactNode }) {
  return <div className="phone-frame flex flex-col">{children}</div>;
}

export function AppHeader({
  title,
  right,
  onBack,
}: {
  title: string;
  right?: ReactNode;
  onBack?: () => void;
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      {/* min-h-14 + px-4 keeps a 56px compact app bar with ≥44px touch targets */}
      <div className="flex min-h-14 items-center gap-2 px-4 py-2">
        {onBack && (
          <button
            onClick={onBack}
            aria-label="Go back"
            className="flex size-11 items-center justify-center rounded-full text-navy transition-colors hover:bg-muted active:bg-muted clay-pressable"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m15 5-7 7 7 7" />
            </svg>
        </button>
        )}
        <h1 className="flex-1 truncate text-lg font-extrabold tracking-tight text-navy">{title}</h1>
        {right}
      </div>
    </header>
  );
}

export type NavTab = "home" | "prices" | "add" | "lots" | "earnings" | "profile";

export function BottomNav({ active, onNavigate }: { active: NavTab; onNavigate: (tab: NavTab) => void }) {
  const { t } = useAppState();
  const items: Array<{ tab: NavTab; label: string; icon: (p: { className?: string; strokeWidth?: number }) => ReactNode }> = [
    { tab: "home", label: t("nav.home"), icon: HomeIcon },
    { tab: "add", label: t("nav.add"), icon: PlusIcon },
    { tab: "lots", label: t("nav.lots"), icon: LotsIcon },
    { tab: "earnings", label: t("nav.earnings"), icon: WalletIcon },
    { tab: "profile", label: t("nav.profile"), icon: UserIcon },
  ];  return (
    <nav
      aria-label="Primary"
      className="sticky bottom-0 z-40 mt-auto border-t border-[var(--border)] bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-background/85"
    >
      <div className="mx-auto grid max-w-md grid-cols-5 items-end px-2 pt-1.5">
        {items.map((item) =>
          item.tab === "add" ? (
            <div key="add" className="relative -mt-6 flex justify-center">
              {/* Primary action: floating FAB-style tab, 64px — well above the
                  44px minimum touch target. */}
              <button
                onClick={() => onNavigate("add")}
                aria-label={t("home.addEwaste")}
                className="flex size-16 items-center justify-center rounded-[22px] bg-[var(--teal)] text-white shadow-lg shadow-[rgb(0_120_107/0.35)] transition-transform active:scale-[0.98]"
              >
                <PlusIcon className="size-8" strokeWidth={2.6} />
              </button>
              <span className="absolute -bottom-0.5 text-[11px] font-bold text-teal-deep">
                {t("nav.add")}
              </span>
            </div>
          ) : (
            <button
              key={item.tab}
              onClick={() => onNavigate(item.tab)}
              aria-label={item.label}
              aria-current={active === item.tab ? "page" : undefined}
              className={cn(
                "flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-2xl px-1 py-1.5 clay-pressable transition-colors",
                active === item.tab ? "tab-active" : "text-muted2 hover:text-navy",
              )}
            >
              <item.icon className="size-6" strokeWidth={active === item.tab ? 2.4 : 2} />
              <span className={cn("text-[11px] leading-none", active === item.tab ? "font-extrabold" : "font-medium")}>
                {item.label}
              </span>
            </button>
          ),
        )}
      </div>
    </nav>
  );
}
