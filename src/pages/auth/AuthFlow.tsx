import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  CheckIcon, ChevronLeftIcon, ShieldCheckIcon, RecycleIcon, TrendUpIcon, LotsIcon,
} from "@/components/icons";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Reusable auth step primitives (LoginScreen / OtpVerification / RoleCards…)
// ---------------------------------------------------------------------------

/* --------------------------- PrimaryButton ------------------------------- */

export function PrimaryButton({
  children,
  variant = "navy",
  loading,
  className,
  ...props
}: {
  children: React.ReactNode;
  variant?: "navy" | "teal" | "surface" | "ghost";
  loading?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const styles: Record<string, string> = {
    navy: "bg-navy text-white hover:bg-[var(--navy-hover)] active:bg-navy",
    teal: "bg-teal text-white hover:brightness-105",
    surface: "bg-card text-navy shadow-[var(--clay-1)]",
    ghost: "bg-transparent text-navy",
  };
  return (
    <button
      className={cn(
        "inline-flex h-13 min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl px-5 text-[15px] font-bold clay-pressable disabled:opacity-45 disabled:pointer-events-none",
        styles[variant],
        className,
      )}
      {...props}
    >
      {loading && (
        <span
          aria-hidden
          className="size-4 animate-spin rounded-full border-2 border-white/35 border-t-white"
        />
      )}
      {children}
    </button>
  );
}

/* ----------------------------- InputField -------------------------------- */

export function InputField({
  label,
  error,
  hint,
  className,
  ...props
}: {
  label: string;
  error?: string | null;
  hint?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="text-[12.5px] font-bold uppercase tracking-wide text-muted2">{label}</span>
      <input
        aria-invalid={!!error}
        className={cn(
          "mt-1.5 h-13 min-h-[52px] w-full rounded-2xl border bg-white px-4 text-[15.5px] font-medium text-foreground",
          "transition-colors placeholder:text-slate-400",
          error
            ? "border-[var(--danger)] focus:border-[var(--danger)]"
            : "border-border focus:border-teal focus:ring-2 focus:ring-teal/25",
          "focus:outline-none",
          className,
        )}
        {...props}
      />
      {hint && !error && <span className="mt-1 block text-[11.5px] text-muted2">{hint}</span>}
      {error && (
        <span role="alert" className="mt-1 block text-[12.5px] font-semibold text-[var(--danger)]">
          {error}
        </span>
      )}
    </label>
  );
}

/* -------------------------- MobileNumberInput ----------------------------- */

export function MobileNumberInput({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
}) {
  return (
    <div>
      <span className="text-[12.5px] font-bold uppercase tracking-wide text-muted2">
        Mobile number
      </span>
      <div
        className={cn(
          "mt-1.5 flex h-13 min-h-[52px] items-stretch overflow-hidden rounded-2xl border bg-white transition-colors",
          error ? "border-[var(--danger)]" : "border-border focus-within:border-teal focus-within:ring-2 focus-within:ring-teal/25",
        )}
      >
        <span
          aria-hidden
          className="flex items-center border-r border-border bg-muted px-3.5 text-[15px] font-bold text-navy"
        >
          +91
        </span>
        <input
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          maxLength={11}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 10))}
          placeholder="Enter 10-digit mobile number"
          aria-label="Mobile number"
          aria-invalid={!!error}
          className="min-w-0 flex-1 bg-transparent px-3.5 text-[16px] font-semibold tracking-wide text-foreground placeholder:text-[13.5px] placeholder:font-medium placeholder:text-slate-400 focus:outline-none"
        />
      </div>
      {error && (
        <span role="alert" className="mt-1 block text-[12.5px] font-semibold text-[var(--danger)]">
          {error}
        </span>
      )}
    </div>
  );
}

/* --------------------------- OtpVerification ------------------------------ */

export function OtpBoxes({
  value,
  onChange,
  onComplete,
  error,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  error?: string | null;
  disabled?: boolean;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const LEN = 6;

  useEffect(() => {
    refs.current[0]?.focus();
  }, []);

  const setDigit = (i: number, digit: string) => {
    // Build the digit array with blanks for unfilled positions, then join.
    const chars = value.padEnd(LEN, " ").split("");
    chars[i] = digit || " ";
    const cleaned = chars.map((c) => (c === " " ? "" : c)).join("");
    onChange(cleaned);
    if (digit && i < LEN - 1) refs.current[i + 1]?.focus();
    if (cleaned.length === LEN) onComplete?.(cleaned);
  };

  return (
    <div>
      <div
        className="grid grid-cols-6 gap-2"
        role="group"
        aria-label="6 digit verification code"
      >
        {Array.from({ length: LEN }).map((_, i) => {
          const digit = value[i] ?? "";
          const active = value.length === i;
          return (
            <input
              key={i}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="text"
              inputMode="numeric"
              autoComplete={i === 0 ? "one-time-code" : "off"}
              maxLength={1}
              disabled={disabled}
              value={digit}
              aria-label={`Digit ${i + 1}`}
              onChange={(e) => setDigit(i, e.target.value.replace(/\D/g, "").slice(0, 1))}
              onKeyDown={(e) => {
                if (e.key === "Backspace") {
                  if (!value[i] && i > 0) {
                    refs.current[i - 1]?.focus();
                    const chars = value.split("");
                    chars.splice(i - 1, 1);
                    onChange(chars.join(""));
                  }
                }
                if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
                if (e.key === "ArrowRight" && i < LEN - 1) refs.current[i + 1]?.focus();
              }}
              className={cn(
                "aspect-square w-full rounded-2xl border text-center text-[22px] font-extrabold text-navy transition-colors",
                "disabled:opacity-50",
                error
                  ? "border-[var(--danger)] bg-red-50/40"
                  : digit
                    ? "border-teal bg-mint/50"
                    : "border-border bg-white focus:border-teal focus:ring-2 focus:ring-teal/25 focus:outline-none",
              )}
            />
          );
        })}
      </div>
      {error && (
        <p role="alert" className="mt-2.5 text-center text-[13px] font-semibold text-[var(--danger)]">
          {error}
        </p>
      )}
    </div>
  );
}

/* ------------------------------ RoleCard ---------------------------------- */

export function RoleCard({
  emoji,
  title,
  sub,
  description,
  selected,
  onSelect,
}: {
  emoji: string;
  title: string;
  sub: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "w-full rounded-3xl border-2 bg-white p-4 text-left transition-all clay-pressable",
        selected
          ? "border-navy bg-mint/60 shadow-[var(--clay-1)]"
          : "border-border hover:border-slate-300",
      )}
    >
      <div className="flex items-start gap-3.5">
        <span
          aria-hidden
          className={cn(
            "flex size-12 shrink-0 items-center justify-center rounded-2xl text-[22px]",
            selected ? "bg-teal text-white" : "bg-muted",
          )}
        >
          {emoji}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-[16px] font-extrabold text-navy">{title}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted2">
              {sub}
            </span>
          </span>
          <span className="mt-1 block text-[13px] leading-snug text-muted2">{description}</span>
        </span>
        <span
          aria-hidden
          className={cn(
            "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
            selected ? "border-teal bg-teal text-white" : "border-slate-300 bg-white",
          )}
        >
          {selected && <CheckIcon className="size-3.5" strokeWidth={3.4} />}
        </span>
      </div>
    </button>
  );
}

/* -------------------------- ProgressIndicator ----------------------------- */

export function ProgressIndicator({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex items-center gap-1.5" aria-label={`Step ${step} of ${total}`}>
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          aria-hidden
          className={cn(
            "h-1.5 rounded-full transition-all",
            i < step ? "w-6 bg-teal" : i === step ? "w-6 bg-teal/40" : "w-3 bg-border",
          )}
        />
      ))}
    </div>
  );
}

/* --------------------------- TrustFeatures -------------------------------- */

export function TrustFeatures() {
  const items = [
    { icon: <ShieldCheckIcon className="size-4" />, label: "Verified recyclers" },
    { icon: <TrendUpIcon className="size-4" />, label: "Transparent prices" },
    { icon: <RecycleIcon className="size-4" />, label: "Traceable transactions" },
  ];
  return (
    <section aria-label="Trust features" className="clay-flat rounded-3xl px-4 py-4">
      <p className="text-center text-[11.5px] font-semibold text-muted2">
        Built for safer, more transparent e-waste recycling.
      </p>
      <div className="mt-2.5 flex items-center justify-center gap-4">
        {items.map((it) => (
          <span key={it.label} className="inline-flex items-center gap-1.5 text-[11.5px] font-bold text-navy">
            <span className="text-[var(--verified)]">{it.icon}</span>
            {it.label}
          </span>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------ StepShell --------------------------------- */

export function StepHeader({
  title,
  sub,
  onBack,
}: {
  title: string;
  sub?: string;
  onBack?: () => void;
}) {
  return (
    <div className="flex items-start gap-2">
      {onBack && (
        <button
          onClick={onBack}
          aria-label="Go back"
          className="clay-sm -ml-1 flex size-10 shrink-0 items-center justify-center text-navy clay-pressable"
        >
          <ChevronLeftIcon className="size-5" />
        </button>
      )}
      <div className="min-w-0">
        <h1 className="text-[24px] font-extrabold leading-tight tracking-tight text-navy">{title}</h1>
        {sub && <p className="mt-1 text-[13.5px] leading-snug text-muted2">{sub}</p>}
      </div>
    </div>
  );
}

export function StepFade({ children, k }: { children: React.ReactNode; k: string }) {
  return (
    <motion.div
      key={k}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

/* --------------------------- Offline helpers ------------------------------ */

export function OfflineNote({ offline }: { offline: boolean }) {
  if (!offline) return null;
  return (
    <p className="flex items-center justify-center gap-1.5 rounded-2xl bg-amber-50 px-3.5 py-2.5 text-[12.5px] font-semibold text-amber-700">
      <span aria-hidden className="size-2 rounded-full bg-[var(--pending)]" />
      You're offline. Some features may be unavailable.
    </p>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-2xl bg-red-50 px-3.5 py-2.5 text-[12.5px] font-semibold text-[var(--danger)]">
      {message}
    </p>
  );
}
