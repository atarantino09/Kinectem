import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { rateLimitMessage } from "@/lib/auth-errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, Lock, ArrowRight, Loader2, ChevronDown, ChevronUp } from "lucide-react";

export interface GuardianPendingInfo {
  email: string;
  password: string;
  message: string;
  expired: boolean;
}

interface SignInFormProps {
  returnTo: string | null;
  onForgot: () => void;
  onSwitchSignup: () => void;
  onError: (msg: string | null) => void;
  onPendingGuardian: (info: GuardianPendingInfo) => void;
}

const DEMO_ACCOUNTS: Array<{
  testid: string;
  label: string;
  sublabel: string;
  email: string;
}> = [
  { testid: "coach", label: "Coach", sublabel: "Mike Davis", email: "coach@kinectem.demo" },
  { testid: "parent", label: "Parent", sublabel: "Lisa Carter", email: "lisa@kinectem.demo" },
  { testid: "athlete", label: "Athlete", sublabel: "Marcus Rivera", email: "marcus@kinectem.demo" },
  { testid: "child-athlete", label: "Athlete (under 13)", sublabel: "Samira Carter", email: "samira@kinectem.demo" },
  { testid: "admin", label: "Admin", sublabel: "Andrew Tarantino", email: "atarantino@kinectem.com" },
];

const DEMO_PASSWORD = "demo1234";

export function SignInForm({
  returnTo,
  onForgot,
  onSwitchSignup,
  onError,
  onPendingGuardian,
}: SignInFormProps) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [demoBusy, setDemoBusy] = useState<string | null>(null);
  const [demoOpen, setDemoOpen] = useState(true);

  const performLogin = async (
    submitEmail: string,
    submitPassword: string,
  ) => {
    onError(null);
    try {
      await customFetch("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: submitEmail.trim().toLowerCase(),
          password: submitPassword,
        }),
      });
      await qc.invalidateQueries();
      const dest = returnTo || "/";
      if (typeof window !== "undefined") {
        const base = import.meta.env.BASE_URL.replace(/\/$/, "");
        window.location.assign(base + (dest.startsWith("/") ? dest : "/" + dest));
      }
    } catch (err) {
      const e = err as {
        message?: string;
        body?: {
          error?: string;
          guardianConfirmUrl?: string;
          pendingGuardianConfirmation?: boolean;
          guardianConfirmExpired?: boolean;
        };
      };
      const rateMsg = rateLimitMessage(err);
      const msg = rateMsg ?? e?.body?.error ?? e?.message ?? "Sign-in failed";
      if (!rateMsg && e?.body?.pendingGuardianConfirmation) {
        onPendingGuardian({
          email: submitEmail.trim().toLowerCase(),
          password: submitPassword,
          message: msg,
          expired: !!e?.body?.guardianConfirmExpired,
        });
      } else {
        onError(msg);
      }
      throw err;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await performLogin(email, password);
    } catch {
      // performLogin already surfaced the error; keep the form interactive.
    } finally {
      setSubmitting(false);
    }
  };

  const signInAsDemo = async (demoEmail: string) => {
    setDemoBusy(demoEmail);
    try {
      await performLogin(demoEmail, DEMO_PASSWORD);
    } catch {
      // performLogin already surfaced the error.
    } finally {
      setDemoBusy(null);
    }
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="space-y-1.5">
        <Label
          htmlFor="email"
          className="text-xs font-semibold uppercase tracking-wide text-slate-600"
        >
          Email
        </Label>
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@school.edu"
            className="rounded-xl h-11 pl-9"
            data-testid="input-signin-email"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label
            htmlFor="password"
            className="text-xs font-semibold uppercase tracking-wide text-slate-600"
          >
            Password
          </Label>
          <button
            type="button"
            className="text-xs font-semibold text-violet-600 hover:underline"
            onClick={onForgot}
            data-testid="btn-forgot-password"
          >
            Forgot?
          </button>
        </div>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="rounded-xl h-11 pl-9"
            data-testid="input-signin-password"
          />
        </div>
      </div>

      <Button
        type="submit"
        variant="brandBlock"
        disabled={submitting}
        data-testid="btn-signin"
      >
        {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
        Sign in
        <ArrowRight className="w-4 h-4 ml-1" />
      </Button>

      <p className="text-center text-sm text-slate-500">
        New to Kinectem?{" "}
        <button
          type="button"
          onClick={onSwitchSignup}
          className="font-bold text-violet-600 hover:underline"
          data-testid="btn-switch-signup"
        >
          Create an account
        </button>
      </p>

      <div
        className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3"
        data-testid="panel-demo-accounts"
      >
        <button
          type="button"
          onClick={() => setDemoOpen((v) => !v)}
          aria-expanded={demoOpen}
          aria-controls="demo-accounts-list"
          data-testid="btn-toggle-demo-panel"
          className="flex w-full items-baseline justify-between gap-2 text-left"
        >
          <span className="flex items-center gap-1.5">
            {demoOpen ? (
              <ChevronUp className="w-3.5 h-3.5 text-slate-500" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
            )}
            <span className="text-xs font-bold uppercase tracking-wide text-slate-700">
              Try a demo account
            </span>
          </span>
          <span className="text-[11px] text-slate-500">
            Password:{" "}
            <code className="font-mono text-slate-700">demo1234</code>
          </span>
        </button>
        {demoOpen && (
          <div
            id="demo-accounts-list"
            className="flex flex-col sm:flex-row sm:flex-wrap gap-2"
          >
            {DEMO_ACCOUNTS.map((acc) => {
              const busy = demoBusy === acc.email;
              return (
                <button
                  key={acc.email}
                  type="button"
                  disabled={!!demoBusy || submitting}
                  onClick={() => signInAsDemo(acc.email)}
                  data-testid={`btn-demo-signin-${acc.testid}`}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-left hover:border-violet-300 hover:bg-violet-50 transition disabled:opacity-50 disabled:cursor-not-allowed sm:flex-1 sm:min-w-[160px]"
                >
                  <div className="flex items-center gap-2">
                    {busy && (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-600" />
                    )}
                    <div className="font-bold text-sm text-slate-900">
                      {acc.label}
                    </div>
                  </div>
                  <div className="text-xs text-slate-500 truncate">
                    {acc.sublabel}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </form>
  );
}
