// ---------------------------------------------------------------------------
// Auth service — pure logic for the login/onboarding flow, kept separate from
// UI. The prototype uses a configurable demo OTP and mock send/verify; no real
// credentials or secrets live here. Swap the mock seams for a real OTP
// provider (e.g. FastAPI + SMS gateway) without touching the step components.
// ---------------------------------------------------------------------------

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

/**
 * Demo verification code (spec §14: OTP = 123456, clearly DEMO — no real SMS).
 * VITE_DEMO_OTP can still override it for the SIH stage environment.
 */
export const DEMO_OTP: string = env.VITE_DEMO_OTP ?? "123456";

export type Role = "collector" | "recycler";

export function onlyDigits(v: string, max = 10): string {
  return v.replace(/\D/g, "").slice(0, max);
}

/** Indian mobile numbers: 10 digits starting 6–9. */
export function isValidMobile(v: string): boolean {
  return /^[6-9]\d{9}$/.test(v);
}

export function formatMasked(mobile: string): string {
  if (mobile.length !== 10) return "+91 ••••• •••••";
  return `+91 ${mobile.slice(0, 5)} ${mobile.slice(5)}`;
}

// ---- Last-auth cache (powers "Continue offline" on weak connectivity) ------

const LAST_AUTH_KEY = "kc.lastAuth";

export function saveLastAuth(v: { role: Role; name: string }) {
  try {
    localStorage.setItem(LAST_AUTH_KEY, JSON.stringify(v));
  } catch {
    /* private mode */
  }
}

export function loadLastAuth(): { role: Role; name: string } | null {
  try {
    const raw = localStorage.getItem(LAST_AUTH_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { role: Role; name: string };
    if (v && (v.role === "collector" || v.role === "recycler") && typeof v.name === "string") {
      return v;
    }
    return null;
  } catch {
    return null;
  }
}

// ---- Onboarding option constants -------------------------------------------

export const LANGUAGE_OPTIONS = [
  { code: "en", label: "English" },
  { code: "hi", label: "हिन्दी" },
  { code: "mr", label: "मराठी" },
] as const;

/** Demo collection areas around Delhi's real e-waste hubs (static prototype data). */
export const DEMO_AREAS = [
  "Okhla",
  "Seelampur",
  "Kirti Nagar",
  "Transport Nagar",
  "Nangloi",
] as const;

export const FACILITY_MATERIALS = [
  { code: "pcb", label: "PCB" },
  { code: "lcd", label: "LCD" },
  { code: "crt", label: "CRT" },
  { code: "cable", label: "Cables" },
  { code: "battery", label: "Batteries" },
  { code: "motor", label: "Motors" },
  { code: "plastic", label: "Mixed Plastics" },
] as const;

// ---- Onboarding payload carried from the steps to profile creation ---------

export type OnboardData = {
  name: string;
  language?: string;
  area?: string;
  phone?: string;
  facilityMaterials?: string[];
  pickupAvailable?: boolean;
};

// ---- Local pending profile (offline-first onboarding) ----------------------
// Onboarding is ALWAYS saved locally first so the flow works with zero
// connectivity. When the backend is reachable, the profile is created in the
// background and the pending record is cleared. "Pending Sync" is an internal
// state only — it never changes the UI.

const PENDING_KEY = "kc.pendingProfile";

export type PendingProfile = {
  role: Role;
  name: string;
  phone?: string;
  language?: string;
  area?: string;
  facilityMaterials?: string[];
  pickupAvailable?: boolean;
  savedAt: number;
  synced: boolean;
};

export function savePendingProfile(
  v: Omit<PendingProfile, "savedAt" | "synced">,
) {
  try {
    localStorage.setItem(
      PENDING_KEY,
      JSON.stringify({ ...v, savedAt: Date.now(), synced: false }),
    );
  } catch {
    /* private mode */
  }
}

export function loadPendingProfile(): PendingProfile | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as PendingProfile;
    if (v && (v.role === "collector" || v.role === "recycler")) return v;
    return null;
  } catch {
    return null;
  }
}

export function markPendingProfileSynced() {
  try {
    const p = loadPendingProfile();
    if (p) {
      localStorage.setItem(
        PENDING_KEY,
        JSON.stringify({ ...p, synced: true } satisfies PendingProfile),
      );
    }
  } catch {
    /* private mode */
  }
}

export function clearPendingProfile() {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    /* private mode */
  }
}
