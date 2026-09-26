import { cva, type VariantProps } from "class-variance-authority";
import { CheckCircleIcon, CloudOffIcon, CloudUpIcon, RefreshIcon } from "@/components/icons";
import { useAppState } from "@/lib/app-state";
import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

// ---------------------------------------------------------------------------
// Clay UI kit — shared tactile components built on the claymorphism utilities.
// ---------------------------------------------------------------------------

/* ----------------------------- Buttons ---------------------------------- */

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 font-semibold select-none clay-pressable disabled:opacity-50 disabled:pointer-events-none",
  {
    variants: {
      variant: {
        primary: "clay-btn-primary",
        gold: "clay-btn-gold",
        navy: "clay-btn-navy",
        surface:
          "bg-card text-foreground rounded-2xl shadow-[var(--clay-1)] hover:brightness-[1.02]",
        ghost:
          "bg-transparent text-foreground rounded-2xl hover:bg-muted shadow-none active:bg-muted",
        danger: "bg-card text-[var(--danger)] rounded-2xl shadow-[var(--clay-1)] hover:bg-[#7F1D1D]/25",
      },
      size: {
        sm: "h-10 px-4 text-sm rounded-xl",
        md: "h-12 px-5 text-[15px]",
        lg: "h-14 px-6 text-base",
        icon: "size-11 rounded-2xl",
      },
    },
    defaultVariants: { variant: "primary", size: "lg" },
  },
);

export interface ClayButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function ClayButton({ className, variant, size, ...props }: ClayButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

/* ------------------------------ Cards ----------------------------------- */

export function ClayCard({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { children?: ReactNode }) {
  return (
    <div className={cn("clay p-4", className)} {...props}>
      {children}
    </div>
  );
}

export function ClaySection({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-2">
          {title && <h2 className="text-[15px] font-bold tracking-wide text-navy uppercase">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/* ----------------------------- Badges ----------------------------------- */

export function ClayBadge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "teal" | "gold" | "green" | "amber" | "red" | "blue" | "navy";
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: "bg-muted text-muted-foreground",
    teal: "bg-[#064E3B] text-[var(--teal)]",
    gold: "bg-[#451A03] text-[var(--gold)]",
    green: "bg-[#064E3B] text-[var(--verified)]",
    amber: "bg-[#451A03] text-[var(--pending)]",
    red: "bg-[#7F1D1D]/40 text-[var(--danger)]",
    blue: "bg-[#1E3A8A] text-[var(--info)]",
    navy: "bg-navy text-teal",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

type PillStatus =
  | "draft" | "created" | "sent" | "accepted" | "rejected" | "handed_over" | "completed"
  | "pending" | "completed_payment" | "none";

export function StatusPill({ status }: { status: string }) {
  const { t } = useAppState();
  const map: Record<string, { tone: Parameters<typeof ClayBadge>[0]["tone"]; label: string }> = {
    draft: { tone: "neutral", label: t("status.draft") },
    created: { tone: "blue", label: t("status.created") },
    sent: { tone: "amber", label: t("status.sent") },
    accepted: { tone: "teal", label: t("status.accepted") },
    rejected: { tone: "red", label: t("status.rejected") },
    handed_over: { tone: "blue", label: t("status.handed_over") },
    completed: { tone: "green", label: t("status.completed") },
    pending: { tone: "amber", label: "Pending" },
    completed_payment: { tone: "green", label: t("payment.completed") },
    none: { tone: "neutral", label: "—" },
  };
  const v = map[status] ?? map.none;
  return <ClayBadge tone={v.tone}>{v.label}</ClayBadge>;
}

/* ----------------------------- Inputs ----------------------------------- */

export function ClayInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "clay-flat w-full px-4 py-3.5 text-[15px] text-foreground placeholder:text-muted-foreground/60",
        "focus-visible:outline-2 focus-visible:outline-teal bg-card",
        className,
      )}
      {...props}
    />
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-bold uppercase tracking-wide text-muted2">{label}</span>
      {children}
    </label>
  );
}

/* ------------------------ Empty / loading ------------------------------- */

export function EmptyState({
  icon,
  title,
  sub,
  action,
}: {
  icon?: ReactNode;
  title: string;
  sub?: string;
  action?: ReactNode;
}) {
  return (
    <div className="clay-flat flex flex-col items-center gap-2 rounded-3xl px-6 py-10 text-center">
      {icon && <div className="text-teal">{icon}</div>}
      <p className="font-bold text-navy">{title}</p>
      {sub && <p className="max-w-xs text-sm text-muted2">{sub}</p>}
      {action}
    </div>
  );
}

export function LoadingState({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-14 text-muted2">
      <div className="size-10 animate-spin rounded-full border-4 border-teal/25 border-t-teal" />
      <p className="text-sm">{label ?? "Loading…"}</p>
    </div>
  );
}

/* ---------------------- Offline / sync chrome ---------------------------- */

export function OfflineBanner() {
  const { online, t, queue } = useAppState();
  if (online) return null;
  return (
    <div className="mx-4 mb-2 flex items-center gap-2 rounded-2xl bg-amber-50 px-3.5 py-2.5 text-[13px] font-semibold text-amber-700 shadow-[var(--clay-1)]">
      <CloudOffIcon className="size-4.5" />
      <span>
        {t("common.offline")} — {t("add.offlineNote")}
        {queue.length > 0 ? ` (${queue.length} queued)` : ""}
      </span>
    </div>
  );
}

export function SyncIndicator() {
  const { online, queue, syncState, lastSyncMessage } = useAppState();
  if (syncState === "syncing") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal">
        <RefreshIcon className="size-4 animate-spin" /> Syncing…
      </span>
    );
  }
  if (syncState === "done" && lastSyncMessage) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--verified)]">
        <CheckCircleIcon className="size-4" /> {lastSyncMessage}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-semibold",
        online ? "text-[var(--verified)]" : "text-[var(--pending)]",
      )}
    >
      {online ? <CloudUpIcon className="size-4" /> : <CloudOffIcon className="size-4" />}
      {online ? t0onlineLabel() : t0offlineLabel(queue)}
    </span>
  );
}

function t0onlineLabel() {
  return "Online";
}

function t0offlineLabel(queue: unknown[]) {
  return queue.length > 0 ? `Offline — ${queue.length} waiting` : "Offline";
}

/* ------------------------------ Toasts ---------------------------------- */

export function Toasts() {
  const { toasts, dismissToast } = useAppState();
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-100 flex flex-col items-center gap-2 px-4">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          onClick={() => dismissToast(toast.id)}
          className={cn(
            "pointer-events-auto max-w-sm rounded-2xl px-4 py-3 text-sm font-semibold text-white shadow-[var(--clay-3)] transition-all",
            toast.tone === "success" && "bg-[var(--verified)]",
            toast.tone === "info" && "bg-navy",
            toast.tone === "error" && "bg-[var(--danger)]",
          )}
        >
          {toast.message}
        </button>
      ))}
    </div>
  );
}
