// ---------------------------------------------------------------------------
// Auth service — pure logic for the login/onboarding flow, kept separate from
// UI. The prototype uses a configurable demo OTP and mock send/verify; no real
// credentials or secrets live here. Swap the mock seams for a real OTP
// provider (e.g. FastAPI + SMS gateway) without touching the step components.
// ---------------------------------------------------------------------------

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

/** Configurable demo verification code (not a secret; demo-mode only). */
export const DEMO_OTP: string = env.VITE_DEMO_OTP ?? "482913";

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
