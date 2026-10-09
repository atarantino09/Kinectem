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
  const claimOrgName = readQueryParam("claimOrg")?.trim() || null;
  // Task #864 — visitors arriving from a public game recap get a warm
  // invitation banner explaining why they're here.
  const gate = readQueryParam("gate");
  const familyInvite = initialSignup === "family" ||
    (readQueryParam("familyInvite") === "1" && returnTo === "/family") ||
    /^\/family-invites\/(contact|guardian)\/[0-9a-f-]+$/i.test(returnTo ?? "");
  const [mode, setMode] = useState<Mode>(initialSignup ? "signup" : "signin");
  const [error, setError] = useState<string | null>(null);
  const [forgotSentEmail, setForgotSentEmail] = useState("");
  const [signupGuardianEmail, setSignupGuardianEmail] = useState("");
  const [guardianInfo, setGuardianInfo] = useState<GuardianPendingInfo | null>(
    null,
  );
  // Tracks which path the visitor chose on the signup path-picker step,
  // so we can show context-appropriate headings throughout the form.
  const [signupPath, setSignupPath] = useState<
    "org_admin" | "general" | null
  >(null);

  const switchMode = (next: Mode) => {
    setError(null);
    setMode(next);
    if (next !== "signup") setSignupPath(null);
  };

  const initialRole: Role =
    initialSignup === "parent" ? "parent" : familyInvite ? "fan" : "athlete";

  const heading = (() => {
    if (familyInvite && (mode === "signup" || mode === "signin")) {
      return { title: mode === "signup" ? "Create your account" : "Sign in for your invitation",
        subtitle: "Use the email address that received the family invitation. You'll review it before deciding." };
    }
    if (claimOrgName && mode === "signup") {
      return {
        title: "Create your individual account",
        subtitle: `You're about to become the owner of ${claimOrgName}.`,
      };
    }
    if (claimOrgName && mode === "signin") {
      return {
        title: "Sign in to claim your organization",
        subtitle: `You're about to become the owner of ${claimOrgName}.`,
      };
    }
    if (mode === "signup" && initialSignup === "parent") {
      return {
        title: "Create your guardian account",
        subtitle:
          "This account is for you, the adult. Each parent signs up separately and shares one player profile.",
      };
    }
    if (mode === "signup") {
      if (signupPath === "org_admin") {
        return {
          title: "Set up your organization",
          subtitle: "Step 1 of 2 — Create your account, then name your org.",
        };
      }
      if (signupPath === "general") {
        return {
          title: "Create your account",
          subtitle: "Join Kinectem in less than a minute.",
        };
      }
      // Path picker is showing — neutral prompt
      return {
        title: "Get started",
        subtitle: "Choose the account type that fits you.",
      };
    }
    return HEADINGS[mode];
  })();

  return (
    <div className="min-h-screen grid grid-cols-1 md:grid-cols-2 text-foreground bg-background">
      <AuthAside />
      <main className="flex flex-col items-center justify-center p-8 md:p-12 relative min-h-screen">
        <div className="w-full max-w-[420px] mb-8 md:hidden">
          <img
            src={`${import.meta.env.BASE_URL}logo-horizontal.png`}
            alt="Kinectem"
            className="block h-7 w-auto dark:hidden"
          />
          <img
            src={`${import.meta.env.BASE_URL}logo-horizontal-mono-white-transparent.png`}
            alt="Kinectem"
            className="hidden h-7 w-auto dark:block"
          />
        </div>
        <div className="w-full max-w-[420px] space-y-8">
          <div className="space-y-3">
            <h2
              className="font-black tracking-tight text-4xl"
              data-testid="text-auth-heading"
            >
              {heading.title}
            </h2>
            <p className="text-base text-muted-foreground">{heading.subtitle}</p>
          </div>

          {gate === "recap" && (mode === "signup" || mode === "signin") && (
            <div
              className="rounded-xl border border-primary/25 bg-primary/5 px-4 py-3 text-sm"
              data-testid="text-recap-gate-message"
            >
              <p className="font-bold">You've caught the highlights 🎉</p>
              <p className="mt-0.5 text-muted-foreground">
                Create your free account to cheer, comment, and follow this
                team all season — you'll land right back on the recap.
              </p>
            </div>
          )}
          {familyInvite && (mode === "signup" || mode === "signin") && (
            <div className="rounded-xl border border-primary/25 bg-primary/5 px-4 py-3 text-sm">
              Your invitation will be waiting after {mode === "signup" ? "account creation" : "sign-in"}.
              Use the same email address that received the invitation.
            </div>
          )}

          {claimOrgName &&
            (mode === "signup" || mode === "signin") && (
              <div
                className="rounded-xl border border-primary/25 bg-primary/5 px-4 py-3 text-sm"
                data-testid="text-org-claim-signup-message"
              >
                <p className="font-bold">Claim {claimOrgName}</p>
                <p className="mt-0.5 text-muted-foreground">
                  {mode === "signup"
                    ? "Create your individual Kinectem account. We'll make you the organization owner and take you directly to its page."
                    : "Sign in to become the organization owner and continue directly to its page."}
                </p>
              </div>
            )}

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
              initialRole={claimOrgName ? "coach" : initialRole}
              returnTo={returnTo}
              onSwitchSignin={() => switchMode("signin")}
              onError={setError}
              onPending={(email) => {
                setSignupGuardianEmail(email);
                setMode("signupPending");
              }}
              skipPathStep={initialSignup === "parent" || familyInvite || !!claimOrgName}
              claimingOrganizationName={claimOrgName}
              onPathChange={(path) => setSignupPath(path)}
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
