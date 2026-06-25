import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { rateLimitMessage } from "@/lib/auth-errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, Lock, ArrowRight, Loader2, ShieldCheck } from "lucide-react";

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

const ADMIN_ACCOUNT = {
  label: "Andrew Tarantino",
  email: "atarantino@kinectem.com",
  password: "demo1234",
};

function adminQueryFlag(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("admin") === "1";
}

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
  const [adminRevealed, setAdminRevealed] = useState(adminQueryFlag);
  const lockClicks = useRef(0);

  const handleLockClick = () => {
    lockClicks.current += 1;
    if (lockClicks.current >= 3) {
      lockClicks.current = 0;
      setAdminRevealed(true);
    }
  };

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

  const signInAsAdmin = async () => {
    setDemoBusy(ADMIN_ACCOUNT.email);
    try {
      await performLogin(ADMIN_ACCOUNT.email, ADMIN_ACCOUNT.password);
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
          <button
            type="button"
            onClick={handleLockClick}
            tabIndex={-1}
            aria-hidden="true"
            data-testid="btn-admin-reveal"
            className="absolute left-3 top-1/2 -translate-y-1/2 cursor-default"
          >
            <Lock className="w-4 h-4 text-slate-400" />
          </button>
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

      {adminRevealed && (
        <button
          type="button"
          disabled={!!demoBusy || submitting}
          onClick={signInAsAdmin}
          data-testid="btn-admin-signin"
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5 text-sm font-semibold text-violet-700 hover:bg-violet-100 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {demoBusy === ADMIN_ACCOUNT.email ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <ShieldCheck className="w-4 h-4" />
          )}
          Sign in as {ADMIN_ACCOUNT.label}
        </button>
      )}
    </form>
  );
}
