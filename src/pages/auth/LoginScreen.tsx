import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate, useSearchParams } from "react-router";
import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { RecycleIcon } from "@/components/icons";
import { cn } from "@/lib/utils";
import { useAppState, setLang as applyLang } from "@/lib/app-state";
import {
  DEMO_OTP,
  formatMasked,
  isValidMobile,
  loadLastAuth,
  markPendingProfileSynced,
  saveLastAuth,
  savePendingProfile,
  type OnboardData,
  type Role,
} from "@/lib/auth-service";
import {
  ErrorNote,
  MobileNumberInput,
  OfflineNote,
  OtpBoxes,
  PrimaryButton,
  ProgressIndicator,
  StepFade,
  StepHeader,
  TrustFeatures,
} from "./AuthFlow";
import { CollectorOnboarding, RecyclerOnboarding } from "./OnboardingSteps";
import { ConfirmStep, RoleStep } from "./RoleSteps";

type Step =
  | { s: "login" }
  | { s: "otp"; mobile: string }
  | { s: "role" }
  | { s: "confirm"; role: Role }
  | { s: "collector" }
  | { s: "recycler" };

const TOTAL_STEPS = 5;

export default function LoginScreen() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Landing page CTAs deep-link a preselected role (/auth?role=collector|recycler).
  const preselectRole: Role | null =
    params.get("role") === "recycler" ? "recycler" : params.get("role") === "collector" ? "collector" : null;
  const { online } = useAppState();
  const { signIn, signOut } = useAuthActions();
  const createProfile = useMutation(api.profiles.createProfile);

  const [step, setStep] = useState<Step>({ s: "login" });
  const [mobile, setMobile] = useState("");
  const [otp, setOtp] = useState("");
  const [otpError, setOtpError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(30);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [onboard, setOnboard] = useState<OnboardData>({ name: "" });

  const lastAuth = useMemo(() => loadLastAuth(), []);

  // Resend countdown while on the OTP step.
  useEffect(() => {
    if (step.s !== "otp" || resendIn <= 0) return;
    const id = setInterval(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [step.s, resendIn]);

  const verifyOtp = (code: string) => {
    if (code !== DEMO_OTP) {
      setOtpError("Incorrect code. Please try again.");
      setOtp("");
      return;
    }
    setOtpError(null);
    setStep({ s: "role" });
  };

  // Offline-first onboarding: ALWAYS save locally and navigate immediately.
  // The backend is only touched opportunistically in the background; a failure
  // never blocks navigation and never surfaces a connection error on this
  // screen. Collection area comes from the local demo list (no network).
  const finish = async (r: Role, data: OnboardData) => {
    const name =
      data.name.trim() || (r === "collector" ? "Rahul Kumar" : "GreenCycle Recycling");

    // 1) Save onboarding locally (name, phone, language, area, role).
    savePendingProfile({
      role: r,
      name,
      phone: data.phone ?? mobile,
      language: data.language,
      area: data.area,
      facilityMaterials: data.facilityMaterials,
      pickupAvailable: data.pickupAvailable,
    });
    saveLastAuth({ role: r, name });
    applyLang((data.language as "en" | "hi" | "mr") ?? "en");

    // 2) Navigate to the app without any network dependency.
    navigate(r === "collector" ? "/app" : "/recycler", { replace: true });

    // 3) Best-effort background sync when actually reachable.
    if (navigator.onLine) {
      void (async () => {
        try {
          try {
            await signOut();
          } catch {
            /* no existing session — fine */
          }
          await signIn("anonymous");
          await createProfile({ role: r, name });
          markPendingProfileSynced();
        } catch {
          // Backend unreachable (e.g. Wi-Fi off but navigator.onLine true):
          // the profile stays "Pending Sync" locally. Never blocks the user.
        }
      })();
    }
  };

  const stepIndex =
    step.s === "login"
      ? 0
      : step.s === "otp"
        ? 1
        : step.s === "role"
          ? 2
          : step.s === "confirm"
            ? 3
            : 4;

  const demoMobile = "98••• ••210 (demo)";

  return (
    <div className="flex min-h-dvh flex-col bg-navy">
      <div className="mx-auto flex w-full max-w-[440px] flex-1 flex-col overflow-hidden bg-background sm:my-6 sm:min-h-[760px] sm:rounded-[36px] sm:shadow-[0_24px_70px_-18px_rgb(0_0_0/0.55)]">
        <main className="flex-1 overflow-y-auto px-5 pb-6 pt-7 sm:pt-9">
          {/* ------------------------------ LOGIN ------------------------------ */}
          {step.s === "login" && (
            <StepFade k="login">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45 }}
                className="flex flex-col items-center text-center"
              >
                <span
                  aria-hidden
                  className="flex size-14 items-center justify-center rounded-2xl bg-navy text-teal shadow-[var(--clay-2)]"
                >
                  <RecycleIcon className="size-7" />
                </span>
                <p className="mt-3 text-[17px] font-extrabold tracking-wide text-navy">
                  KABADIWALA CONNECT
                </p>
                <p className="mt-1 max-w-[300px] text-[12.5px] leading-snug text-muted2">
                  Bringing informal collectors into the formal recycling chain.
                </p>
              </motion.div>

              <h1 className="mt-7 text-[26px] font-extrabold tracking-tight text-navy">
                Welcome back
              </h1>
              <p className="mt-1 text-[14px] text-muted2">
                Sign in to continue to Kabadiwala Connect.
              </p>

              <div className="mt-6 space-y-4">
                <MobileNumberInput
                  value={mobile}
                  onChange={(v) => {
                    setMobile(v);
                    setLoginError(null);
                  }}
                />
                <ErrorNote message={loginError} />
                <PrimaryButton
                  disabled={mobile.length !== 10}
                  onClick={() => {
                    if (!isValidMobile(mobile)) {
                      setLoginError("Please enter a valid 10-digit mobile number.");
                      return;
                    }
                    setOtp("");
                    setOtpError(null);
                    setResendIn(30);
                    setStep({ s: "otp", mobile });
                  }}
                >
                  Continue
                </PrimaryButton>

                {lastAuth && (
                  <div>
                    <PrimaryButton
                      variant="surface"
                      disabled={busy}
                      onClick={() => {
                        if (!online) {
                          navigate(lastAuth.role === "collector" ? "/app" : "/recycler", {
                            replace: true,
                          });
                          return;
                        }
                        void finish(lastAuth.role, { name: lastAuth.name });
                      }}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "size-2 rounded-full",
                          online ? "bg-[var(--verified)]" : "bg-[var(--pending)]",
                        )}
                      />
                      Continue offline
                    </PrimaryButton>
                    <p className="mt-1.5 text-center text-[11px] text-muted2">
                      Last session: {lastAuth.name}
                    </p>
                  </div>
                )}
              </div>

              {/* Demo mode — subtle */}
              <details className="mt-6 rounded-2xl border border-[#2A2F3D] bg-[#1A1D24] px-4 py-3">
                <summary className="cursor-pointer list-none text-[11.5px] font-bold uppercase tracking-wider text-muted2">
                  Demo Mode
                </summary>
                <p className="mt-2 text-[12px] text-muted2">
                  For SIH presentation: bypass OTP with demo profiles. No real SMS is sent.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <PrimaryButton
                    variant="surface"
                    onClick={() => void finish("collector", { name: "Rahul Kumar" })}
                  >
                    Demo Collector
                  </PrimaryButton>
                  <PrimaryButton
                    variant="surface"
                    onClick={() => void finish("recycler", { name: "GreenCycle Recycling" })}
                  >
                    Demo Recycler
                  </PrimaryButton>
                </div>
                <p className="mt-2.5 text-[11px] text-muted2">
                  Demo OTP for the manual flow:{" "}
                  <span className="font-extrabold text-teal">{DEMO_OTP}</span>
                </p>
              </details>

              <div className="mt-6">
                <TrustFeatures />
              </div>
            </StepFade>
          )}

          {/* ------------------------------- OTP ------------------------------- */}
          {step.s === "otp" && (
            <StepFade k="otp">
              <StepHeader
                title="Verify your number"
                sub={`We've sent a 6-digit verification code to ${formatMasked(step.mobile)}.`}
                onBack={() => setStep({ s: "login" })}
              />
              <div className="mt-6 space-y-5">
                <OtpBoxes
                  value={otp}
                  onChange={(v) => {
                    setOtp(v);
                    setOtpError(null);
                  }}
                  onComplete={verifyOtp}
                  error={otpError}
                />
                <PrimaryButton disabled={otp.length !== 6} onClick={() => verifyOtp(otp)}>
                  Verify &amp; Continue
                </PrimaryButton>
                <div className="text-center">
                  <p className="text-[13px] text-muted2">Didn't receive the code?</p>
                  {resendIn > 0 ? (
                    <p className="mt-0.5 text-[13px] font-bold text-navy">Resend in {resendIn}s</p>
                  ) : (
                    <button
                      onClick={() => {
                        setOtp("");
                        setOtpError(null);
                        setResendIn(30);
                      }}
                      className="mt-0.5 text-[13px] font-bold text-teal-deep underline-offset-2 hover:underline"
                    >
                      Resend OTP
                    </button>
                  )}
                </div>
              </div>
              <div className="mt-6 space-y-3">
                <OfflineNote offline={!online} />
                <p className="text-center text-[11px] text-muted2">
                  Prototype: verification is mocked — the demo OTP is accepted without an SMS.
                </p>
              </div>
            </StepFade>
          )}

          {/* ---------------------------- ROLE SELECT -------------------------- */}
          {step.s === "role" && (
            <StepFade k="role">
              <RoleStep
                preselect={preselectRole}
                onBack={() => setStep({ s: "otp", mobile })}
                onContinue={(r) => setStep({ s: "confirm", role: r })}
              />
            </StepFade>
          )}

          {/* --------------------------- ROLE CONFIRM -------------------------- */}
          {step.s === "confirm" && (
            <StepFade k="confirm">
              <ConfirmStep
                role={step.role}
                onBack={() => setStep({ s: "role" })}
                onContinue={() =>
                  setStep(step.role === "collector" ? { s: "collector" } : { s: "recycler" })
                }
              />
            </StepFade>
          )}

          {/* ------------------------ COLLECTOR ONBOARD ------------------------ */}
          {step.s === "collector" && (
            <StepFade k="collector">
              <StepHeader
                title="Let's get you started"
                sub="Just the basics — you can add more later."
                onBack={() => setStep({ s: "confirm", role: "collector" })}
              />
              <div className="mt-5">
                <CollectorOnboarding
                  data={onboard}
                  onChange={setOnboard}
                  mobile={mobile || demoMobile}
                  busy={busy}
                  error={networkError}
                  onSubmit={() => void finish("collector", onboard)}
                />
              </div>
            </StepFade>
          )}

          {/* ------------------------- RECYCLER ONBOARD ------------------------ */}
          {step.s === "recycler" && (
            <StepFade k="recycler">
              <StepHeader
                title="Set up your recycling facility"
                sub="Facility details power your portal profile."
                onBack={() => setStep({ s: "confirm", role: "recycler" })}
              />
              <div className="mt-5">
                <RecyclerOnboarding
                  data={onboard}
                  onChange={setOnboard}
                  mobile={mobile || demoMobile}
                  busy={busy}
                  error={networkError}
                  onSubmit={() => void finish("recycler", onboard)}
                />
              </div>
            </StepFade>
          )}
        </main>

        <div className="border-t border-border/60 bg-background px-5 py-3.5">
          <ProgressIndicator step={stepIndex} total={TOTAL_STEPS} />
        </div>
      </div>
    </div>
  );
}
