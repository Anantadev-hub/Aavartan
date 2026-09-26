import type { ReactNode } from "react";
import {
  HomeIcon, LotsIcon, PlusIcon, PriceTagIcon, WalletIcon,
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
    <header className="sticky top-0 z-40 border-b border-white/[0.08] bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="flex min-h-14 items-center gap-2 px-4 py-2">
        {onBack && (
          <button
            onClick={onBack}
            aria-label="Go back"
            className="clay-sm flex size-10 items-center justify-center text-navy clay-pressable"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
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

export type NavTab = "home" | "prices" | "add" | "lots" | "earnings";

export function BottomNav({ active, onNavigate }: { active: NavTab; onNavigate: (tab: NavTab) => void }) {
  const { t } = useAppState();
  const items: Array<{ tab: NavTab; label: string; icon: (p: { className?: string; strokeWidth?: number }) => ReactNode }> = [
    { tab: "home", label: t("nav.home"), icon: HomeIcon },
    { tab: "prices", label: t("nav.prices"), icon: PriceTagIcon },
    { tab: "add", label: t("nav.add"), icon: PlusIcon },
    { tab: "lots", label: t("nav.lots"), icon: LotsIcon },
    { tab: "earnings", label: t("nav.earnings"), icon: WalletIcon },
  ];
  return (
    <nav
      aria-label="Primary"
      className="sticky bottom-0 z-40 mt-auto border-t border-white/[0.08] bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-background/85"
    >
      <div className="mx-auto grid max-w-md grid-cols-5 items-end px-2 pt-1.5">
        {items.map((item) =>
          item.tab === "add" ? (
            <div key="add" className="relative -mt-6 flex justify-center">
              <button
                onClick={() => onNavigate("add")}
                aria-label={t("home.addEwaste")}
                className="clay-btn-primary flex size-16 items-center justify-center rounded-[22px] clay-pressable"
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
                "flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-2xl px-1 py-1.5 clay-pressable",
                active === item.tab ? "text-teal-deep" : "text-muted2",
              )}
            >
              <item.icon className={cn("size-6", active === item.tab && "drop-shadow-sm")} strokeWidth={active === item.tab ? 2.4 : 2} />
              <span className={cn("text-[11px]", active === item.tab ? "font-extrabold" : "font-medium")}>
                {item.label}
              </span>
            </button>
          ),
        )}
      </div>
    </nav>
  );
}
