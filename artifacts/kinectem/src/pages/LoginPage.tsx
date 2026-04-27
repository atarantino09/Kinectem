import { useState } from "react";
import { AuthAside } from "@/components/login-page/AuthAside";
import {
  SignInForm,
  type GuardianPendingInfo,
} from "@/components/login-page/SignInForm";
import { SignUpForm, type Role } from "@/components/login-page/SignUpForm";
import { ForgotForm } from "@/components/login-page/ForgotForm";
import {
  ForgotSentPanel,
  SignupPendingPanel,
  GuardianPendingPanel,
} from "@/components/login-page/StatusPanels";

type Mode =
  | "signin"
  | "signup"
  | "forgot"
  | "forgotSent"
  | "signupPending"
  | "guardianPending";

function readQueryParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

const HEADINGS: Record<Mode, { title: string; subtitle: string }> = {
  signin: {
    title: "Welcome back",
    subtitle: "Sign in to keep up with your teams.",
  },
  signup: {
    title: "Create your account",
    subtitle: "Join Kinectem in less than a minute.",
  },
  forgot: {
    title: "Reset your password",
    subtitle: "We'll send you a link to set a new password.",
  },
  forgotSent: {
    title: "Check your email",
    subtitle: "If that email exists, a reset link is on its way.",
  },
  signupPending: {
    title: "One more step",
    subtitle:
      "Your account is ready — once a parent or guardian confirms it.",
  },
  guardianPending: {
    title: "Guardian confirmation needed",
    subtitle:
      "Your account can't sign in yet because a parent or guardian still needs to confirm it.",
  },
};

export default function LoginPage() {
  const initialSignup = readQueryParam("signup");
  const returnTo = readQueryParam("returnTo");
  const [mode, setMode] = useState<Mode>(initialSignup ? "signup" : "signin");
  const [error, setError] = useState<string | null>(null);
  const [forgotSentEmail, setForgotSentEmail] = useState("");
  const [signupGuardianEmail, setSignupGuardianEmail] = useState("");
  const [guardianInfo, setGuardianInfo] = useState<GuardianPendingInfo | null>(
    null,
  );

  const switchMode = (next: Mode) => {
    setError(null);
    setMode(next);
  };

  const initialRole: Role =
    initialSignup === "parent" ? "parent" : "athlete";
  const heading = HEADINGS[mode];

  return (
    <div className="min-h-screen grid grid-cols-1 md:grid-cols-2 bg-white text-slate-900">
      <AuthAside />
      <main className="flex items-center justify-center p-8 md:p-12">
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-2">
            <h2
              className="font-black tracking-tight text-3xl"
              data-testid="text-auth-heading"
            >
              {heading.title}
            </h2>
            <p className="text-sm text-slate-500">{heading.subtitle}</p>
          </div>

          {error && (
            <div
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
              data-testid="text-auth-error"
            >
              {error}
            </div>
          )}

          {mode === "signin" && (
            <SignInForm
              returnTo={returnTo}
              onForgot={() => switchMode("forgot")}
              onSwitchSignup={() => switchMode("signup")}
              onError={setError}
              onPendingGuardian={(info) => {
                setGuardianInfo(info);
                setMode("guardianPending");
              }}
            />
          )}

          {mode === "signup" && (
            <SignUpForm
              initialRole={initialRole}
              returnTo={returnTo}
              onSwitchSignin={() => switchMode("signin")}
              onError={setError}
              onPending={(email) => {
                setSignupGuardianEmail(email);
                setMode("signupPending");
              }}
            />
          )}

          {mode === "forgot" && (
            <ForgotForm
              onBack={() => switchMode("signin")}
              onError={setError}
              onSent={(email) => {
                setForgotSentEmail(email);
                setMode("forgotSent");
              }}
            />
          )}

          {mode === "forgotSent" && (
            <ForgotSentPanel
              email={forgotSentEmail}
              onBack={() => switchMode("signin")}
            />
          )}

          {mode === "guardianPending" && guardianInfo && (
            <GuardianPendingPanel
              info={guardianInfo}
              onError={setError}
              onBack={() => switchMode("signin")}
            />
          )}

          {mode === "signupPending" && (
            <SignupPendingPanel
              guardianEmail={signupGuardianEmail}
              onBack={() => switchMode("signin")}
            />
          )}

          <p className="text-center text-xs text-slate-400 pt-2">
            By continuing you agree to our{" "}
            <a className="font-semibold underline">Terms</a> and{" "}
            <a className="font-semibold underline">Privacy Policy</a>.
          </p>
        </div>
      </main>
    </div>
  );
}
