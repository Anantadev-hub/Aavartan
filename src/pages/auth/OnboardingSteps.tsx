import { ShieldCheckIcon } from "@/components/icons";
import { cn } from "@/lib/utils";
import {
  DEMO_AREAS, FACILITY_MATERIALS, LANGUAGE_OPTIONS, type OnboardData,
} from "@/lib/auth-service";
import { ErrorNote, InputField, PrimaryButton } from "./AuthFlow";

// ---------------------------------------------------------------------------
// CollectorOnboarding + RecyclerOnboarding — lightweight final steps.
// ---------------------------------------------------------------------------

function ChipToggle({
  selected,
  onClick,
  children,
  tone = "teal",
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  tone?: "teal" | "navy";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "min-h-11 rounded-2xl border-2 px-3.5 text-[13.5px] font-bold clay-pressable",
        selected
          ? tone === "teal"
            ? "border-teal bg-mint text-[var(--teal)]"
            : "border-teal bg-mint text-[var(--navy)]"
          : "border-[#E2E8F0] bg-card text-muted2",
      )}
    >
      {children}
    </button>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[12.5px] font-bold uppercase tracking-wide text-muted2">{children}</span>
  );
}

/* -------------------------- CollectorOnboarding --------------------------- */

export function CollectorOnboarding({
  data,
  onChange,
  mobile,
  busy,
  error,
  onSubmit,
}: {
  data: OnboardData;
  onChange: (d: OnboardData) => void;
  mobile: string;
  busy: boolean;
  error: string | null;
  onSubmit: () => void;
}) {
  return (
    <div className="space-y-4">
      <InputField
        label="Name"
        value={data.name}
        onChange={(e) => onChange({ ...data, name: e.target.value })}
        placeholder="e.g. Rahul Kumar"
        autoComplete="name"
      />
      <InputField label="Mobile number" value={mobile} readOnly className="bg-muted text-muted2" />

      <div>
        <FieldLabel>Preferred language</FieldLabel>
        <div className="mt-1.5 grid grid-cols-3 gap-2">
          {LANGUAGE_OPTIONS.map((l) => (
            <ChipToggle
              key={l.code}
              tone="navy"
              selected={data.language === l.code}
              onClick={() => onChange({ ...data, language: l.code })}
            >
              {l.label}
            </ChipToggle>
          ))}
        </div>
      </div>

      <div>
        <FieldLabel>Collection area</FieldLabel>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {DEMO_AREAS.map((a) => (
            <ChipToggle
              key={a}
              selected={data.area === a}
              onClick={() => onChange({ ...data, area: a })}
            >
              {a}
            </ChipToggle>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-muted2">
          Demo location list — real GPS/geocoding arrives with the mobile build.
        </p>
      </div>

      <ErrorNote message={error} />
      <PrimaryButton loading={busy} disabled={busy || !data.name.trim()} onClick={onSubmit}>
        Start Collecting
      </PrimaryButton>
    </div>
  );
}

/* -------------------------- RecyclerOnboarding ---------------------------- */

export function RecyclerOnboarding({
  data,
  onChange,
  mobile,
  busy,
  error,
  onSubmit,
}: {
  data: OnboardData;
  onChange: (d: OnboardData) => void;
  mobile: string;
  busy: boolean;
  error: string | null;
  onSubmit: () => void;
}) {
  const materials = data.facilityMaterials ?? [];
  const toggleMaterial = (code: string) => {
    onChange({
      ...data,
      facilityMaterials: materials.includes(code)
        ? materials.filter((x) => x !== code)
        : [...materials, code],
    });
  };

  return (
    <div className="space-y-4">
      <InputField
        label="Facility name"
        value={data.name}
        onChange={(e) => onChange({ ...data, name: e.target.value })}
        placeholder="e.g. GreenCycle Recycling"
      />
      <InputField label="Contact number" value={mobile} readOnly className="bg-muted text-muted2" />

      <div>
        <FieldLabel>Facility location</FieldLabel>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {DEMO_AREAS.map((a) => (
            <ChipToggle
              key={a}
              selected={data.area === a}
              onClick={() => onChange({ ...data, area: a })}
            >
              {a}
            </ChipToggle>
          ))}
        </div>
      </div>

      <div>
        <FieldLabel>Materials accepted</FieldLabel>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {FACILITY_MATERIALS.map((m) => (
            <ChipToggle
              key={m.code}
              selected={materials.includes(m.code)}
              onClick={() => toggleMaterial(m.code)}
            >
              {m.label}
            </ChipToggle>
          ))}
        </div>
      </div>

      <div>
        <FieldLabel>Pickup availability</FieldLabel>
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          <ChipToggle
            selected={data.pickupAvailable === true}
            onClick={() => onChange({ ...data, pickupAvailable: true })}
          >
            We offer pickup
          </ChipToggle>
          <ChipToggle
            selected={data.pickupAvailable === false}
            onClick={() => onChange({ ...data, pickupAvailable: false })}
          >
            Drop-off only
          </ChipToggle>
        </div>
      </div>

      <div className="clay-sm flex items-start gap-2.5 rounded-2xl bg-mint px-4 py-3">
        <ShieldCheckIcon className="mt-0.5 size-5 shrink-0 text-[var(--verified)]" />
        <div>
          <p className="text-[13.5px] font-extrabold text-navy">Authorization status</p>
          <p className="mt-0.5 text-[12px] leading-snug text-muted2">
            ✓ Demo Authorized Recycler — mock status for the prototype. No government license numbers
            are used or implied.
          </p>
        </div>
      </div>

      <ErrorNote message={error} />
      <PrimaryButton loading={busy} disabled={busy || !data.name.trim()} onClick={onSubmit}>
        Open Recycler Portal
      </PrimaryButton>
    </div>
  );
}
