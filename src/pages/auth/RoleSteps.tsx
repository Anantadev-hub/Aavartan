import { useState } from "react";
import { PrimaryButton, RoleCard, StepHeader } from "./AuthFlow";
import { ErrorNote } from "./AuthFlow";
import type { Role } from "@/lib/auth-service";

export function RoleStep({
  onBack,
  onContinue,
  preselect,
}: {
  onBack: () => void;
  onContinue: (r: Role) => void;
  preselect?: Role | null;
}) {
  const [role, setRole] = useState<Role | null>(preselect ?? null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <StepHeader title="What do you do?" sub="Choose your role to continue." onBack={onBack} />
      <div className="mt-5 space-y-3">
        <RoleCard
          emoji="🛵"
          title="Collector"
          sub="E-waste Collector"
          description="Collect, identify and sell e-waste to authorized recyclers."
          selected={role === "collector"}
          onSelect={() => {
            setRole("collector");
            setError(null);
          }}
        />
        <RoleCard
          emoji="🏭"
          title="Recycler"
          sub="Authorized Buyer"
          description="Discover collector lots, quote prices and manage transactions."
          selected={role === "recycler"}
          onSelect={() => {
            setRole("recycler");
            setError(null);
          }}
        />
      </div>
      {error && (
        <div className="mt-4">
          <ErrorNote message={error} />
        </div>
      )}
      <PrimaryButton
        className="mt-5"
        onClick={() => {
          if (!role) {
            setError("Please select how you use Aavartan.");
            return;
          }
          onContinue(role);
        }}
      >
        Continue
      </PrimaryButton>
    </div>
  );
}

export function ConfirmStep({
  role,
  onBack,
  onContinue,
}: {
  role: Role;
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <div>
      <StepHeader title="You're joining as" onBack={onBack} />
      <div className="clay mt-5 flex items-center justify-center rounded-3xl px-4 py-9">
        <div className="text-center">
          <span aria-hidden className="text-[34px]">
            {role === "collector" ? "🛵" : "🏭"}
          </span>
          <p className="mt-1 text-[22px] font-extrabold text-navy">
            {role === "collector" ? "Collector" : "Recycler"}
          </p>
          <p className="text-[12.5px] font-bold uppercase tracking-wide text-teal-deep">
            {role === "collector" ? "E-waste Collector" : "Authorized Buyer"}
          </p>
        </div>
      </div>
      <PrimaryButton className="mt-5" onClick={onContinue}>
        Continue
      </PrimaryButton>
    </div>
  );
}
