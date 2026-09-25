import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useMutation } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@/convex/_generated/api";
import {
  BuildingIcon, ChevronLeftIcon, RecycleIcon, ShieldCheckIcon, TruckIcon,
} from "@/components/icons";
import { ClayButton, ClayCard } from "@/components/ui/kit";
import { useAppState } from "@/lib/app-state";
import { LANGS, LANG_LABELS } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Role = "collector" | "recycler";

function AuthInner() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returnTo = params.get("returnTo");
  const preselected = params.get("role") === "recycler" ? "recycler" : "collector";
  const { lang, setLang } = useAppState();

  const [role, setRole] = useState<Role>(preselected);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const signIn = useAuthActions().signIn;
  const createProfile = useMutation(api.profiles.createProfile);


  const enter = async (r: Role) => {
    setBusy(true);
    try {
      // Mock authentication: anonymous Convex auth session. Structure supports
      // phone/OTP later — clearly labelled demo.
      await signIn("anonymous");
      await createProfile({ role: r, name: name.trim() || (r === "collector" ? "Rahul Kumar" : "GreenCycle Recycling") });
      navigate(r === "collector" ? "/app" : "/recycler", { replace: true });
    } catch (e) {
      console.error(e);
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <div className="mx-auto flex w-full max-w-md items-center gap-2 px-4 pt-4">
        <button
          onClick={() => navigate("/")}
          aria-label="Back to home"
          className="clay-sm flex size-10 items-center justify-center text-navy clay-pressable"
        >
          <ChevronLeftIcon className="size-5" />
        </button>
        <div className="flex-1" />
        {LANGS.map((l) => (
          <button
            key={l}
            onClick={() => setLang(l)}
            className={cn(
              "rounded-xl px-2.5 py-1.5 text-xs font-bold clay-pressable",
              lang === l ? "bg-navy text-mint shadow-[var(--clay-1)]" : "bg-card text-muted2 shadow-[var(--clay-1)]",
            )}
          >
            {LANG_LABELS[l]}
          </button>
        ))}
    </div>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 pb-10 pt-2">
        <span className="clay mx-auto flex size-14 items-center justify-center text-teal">
          <RecycleIcon className="size-8" />
        </span>
        <h1 className="mt-4 text-center text-2xl font-extrabold tracking-tight text-navy">
          Kabadiwala Connect
        </h1>
        <p className="mt-1 text-center text-sm text-muted2">
          Bringing informal collectors into the formal recycling chain.
        </p>

        <ClayCard className="mt-6 rounded-3xl p-5">
          <p className="text-xs font-bold uppercase tracking-wider text-muted2">Continue as</p>
          <div className="mt-3 grid gap-3">
            <RoleCard
              selected={role === "collector"}
              onSelect={() => setRole("collector")}
              icon={<RecycleIcon className="size-6" />}
              title="KABADIWALA"
              sub="Collector"
              tone="teal"
            />
            <RoleCard
              selected={role === "recycler"}
              onSelect={() => setRole("recycler")}
              icon={<BuildingIcon className="size-6" />}
              title="RECYCLER"
              sub="Authorized buyer"
              tone="gold"
            />
          </div>

          <div className="mt-5">
            <label htmlFor="demo-name" className="text-xs font-bold uppercase tracking-wide text-muted2">
              Your name <span className="font-medium normal-case">(optional)</span>
            </label>
            <input
              id="demo-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={role === "collector" ? "Rahul Kumar" : "GreenCycle Recycling"}
              className="clay-flat mt-1.5 w-full bg-card px-4 py-3.5 text-[15px] text-foreground placeholder:text-muted-foreground/50"
            />
          </div>

          <ClayButton
            className="mt-5 w-full"
            disabled={busy}
            onClick={() => enter(role)}
          >
            {busy ? "Signing in…" : "Continue"}
            {!busy && <TruckIcon className="size-5" />}
          </ClayButton>
        </ClayCard>

        <div className="clay-sm mt-5 rounded-2xl px-4 py-3">
          <p className="flex items-start gap-2 text-[13px] leading-snug text-muted2">
            <ShieldCheckIcon className="mt-0.5 size-4.5 shrink-0 text-teal" />
            <span>
              Demo mode: sign-in is mocked for the prototype. In production this screen collects a mobile
              number and OTP, clearly separated from role selection.
            </span>
          </p>
        </div>

        <p className="mt-4 text-center text-xs text-muted2">
          By continuing you agree to use this prototype responsibly. Demo data only.
        </p>
      </main>
    </div>
  );
}

function RoleCard({
  selected,
  onSelect,
  icon,
  title,
  sub,
  tone,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  sub: string;
  tone: "teal" | "gold";
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex items-center gap-3.5 rounded-2xl p-4 text-left clay-pressable transition-shadow",
        selected
          ? tone === "teal"
            ? "bg-mint shadow-[var(--clay-2)] ring-2 ring-teal"
            : "bg-amber-50 shadow-[var(--clay-2)] ring-2 ring-[var(--gold)]"
          : "bg-muted shadow-[var(--clay-inset)]",
      )}
    >
      <span
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-xl",
          tone === "teal" ? "bg-teal text-white" : "bg-[var(--gold)] text-amber-900",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-extrabold tracking-wide text-navy">{title}</span>
        <span className="block text-[13px] text-muted2">{sub}</span>
      </span>
      <span
        aria-hidden
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full border-2",
          selected ? "border-teal bg-teal text-white" : "border-slate-300 bg-white",
        )}
      >
        {selected && (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m5 13 4.5 4.5L19 7" />
          </svg>
        )}
      </span>
    </button>
  );
}

export default function AuthPage() {
  return <AuthInner />;
}
