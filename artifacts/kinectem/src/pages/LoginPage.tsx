import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Trophy, Mail, Lock, ArrowRight, ArrowLeft, Loader2, CheckCircle2 } from "lucide-react";

type Mode =
  | "signin"
  | "signup"
  | "forgot"
  | "forgotSent"
  | "signupPending"
  | "guardianPending";
type Role = "athlete" | "coach" | "admin" | "parent";

function readQueryParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

function ageInYears(dob: string): number | null {
  if (!dob) return null;
  const t = new Date(dob).getTime();
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / (365.25 * 24 * 3600 * 1000);
}

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const initialSignup = readQueryParam("signup");
  const returnTo = readQueryParam("returnTo");
  const [mode, setMode] = useState<Mode>(initialSignup ? "signup" : "signin");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Sign in
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Sign up
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [role, setRole] = useState<Role>(
    initialSignup === "parent" ? "parent" : "athlete",
  );
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [dob, setDob] = useState("");
  const [guardianEmail, setGuardianEmail] = useState("");
  const [guardianConsent, setGuardianConsent] = useState(false);
  const [pendingGuardianUrl, setPendingGuardianUrl] = useState<string | null>(null);

  // Guardian pending (after sign-in attempt)
  const [guardianPendingMessage, setGuardianPendingMessage] = useState<string>("");
  const [guardianPendingExpired, setGuardianPendingExpired] = useState(false);
  const [guardianResendUrl, setGuardianResendUrl] = useState<string | null>(null);

  // Forgot
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotResetUrl, setForgotResetUrl] = useState<string | null>(null);

  const age = ageInYears(dob);
  const isUnder13 = role === "athlete" && age !== null && age < 13;

  const switchMode = (next: Mode) => {
    setError(null);
    setMode(next);
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await customFetch("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      await qc.invalidateQueries();
      const dest = returnTo || "/";
      if (typeof window !== "undefined") {
        window.location.assign(dest);
      } else {
        setLocation(dest);
      }
    } catch (err) {
      const e = err as {
        status?: number;
        message?: string;
        body?: {
          error?: string;
          guardianConfirmUrl?: string;
          pendingGuardianConfirmation?: boolean;
          guardianConfirmExpired?: boolean;
        };
      };
      const msg = e?.body?.error ?? e?.message ?? "Sign-in failed";
      if (e?.body?.pendingGuardianConfirmation) {
        setGuardianPendingMessage(msg);
        setGuardianPendingExpired(!!e?.body?.guardianConfirmExpired);
        setGuardianResendUrl(null);
        setMode("guardianPending");
      } else {
        setError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendGuardian = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = (await customFetch("/api/v1/auth/guardian-resend", {
        method: "POST",
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
        }),
      })) as { guardianConfirmUrl?: string };
      setGuardianResendUrl(res?.guardianConfirmUrl ?? null);
      setGuardianPendingExpired(false);
      setGuardianPendingMessage(
        "We sent a fresh confirmation link to your parent or guardian. It expires in 7 days.",
      );
    } catch (err) {
      const e = err as { message?: string; body?: { error?: string } };
      setError(e?.body?.error ?? e?.message ?? "Could not resend confirmation");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (signupPassword.length < 8) {
        throw new Error("Password must be at least 8 characters.");
      }
      if (isUnder13 && (!guardianEmail.trim() || !guardianConsent)) {
        throw new Error(
          "Athletes under 13 need a guardian email and confirmation before signing up.",
        );
      }
      const res = (await customFetch("/api/v1/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          role,
          email: signupEmail.trim().toLowerCase(),
          password: signupPassword,
          dateOfBirth: dob || null,
          guardianEmail: isUnder13 ? guardianEmail.trim().toLowerCase() : null,
          guardianConsent: isUnder13 ? guardianConsent : undefined,
        }),
      })) as { pendingGuardianConfirmation?: boolean; guardianConfirmUrl?: string };
      if (res?.pendingGuardianConfirmation) {
        setPendingGuardianUrl(res.guardianConfirmUrl ?? null);
        setMode("signupPending");
        return;
      }
      await qc.invalidateQueries();
      const dest = returnTo || "/";
      if (typeof window !== "undefined") {
        window.location.assign(dest);
      } else {
        setLocation(dest);
      }
    } catch (err) {
      const e = err as { message?: string; body?: { error?: string } };
      setError(e?.body?.error ?? e?.message ?? "Sign-up failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = (await customFetch("/api/v1/auth/password-reset/request", {
        method: "POST",
        body: JSON.stringify({ email: forgotEmail.trim().toLowerCase() }),
      })) as { resetUrl?: string };
      setForgotResetUrl(res?.resetUrl ?? null);
      setMode("forgotSent");
    } catch (err) {
      const e = err as { message?: string; body?: { error?: string } };
      setError(e?.body?.error ?? e?.message ?? "Could not request password reset");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen grid grid-cols-1 md:grid-cols-2 bg-white text-slate-900">
      <aside className="relative hidden md:flex flex-col justify-between p-10 bg-gradient-to-br from-violet-600 via-purple-600 to-blue-600 text-white overflow-hidden">
        <div className="absolute -top-24 -right-24 w-80 h-80 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 w-80 h-80 rounded-full bg-blue-300/20 blur-3xl" />

        <div className="relative flex items-center gap-2">
          <div className="w-10 h-10 rounded-xl bg-white/15 backdrop-blur flex items-center justify-center">
            <Trophy className="w-5 h-5" />
          </div>
          <span className="font-black text-2xl tracking-tight">
            Kinect<span className="brand-gradient-text">em</span>
          </span>
        </div>

        <div className="relative space-y-6">
          <h1 className="font-black tracking-tight text-4xl leading-tight">
            Where the next generation of athletes gets seen.
          </h1>
          <p className="text-white/85 text-lg leading-relaxed max-w-md">
            Follow your team, share highlights, and connect with coaches,
            parents, and journalists — all in one place.
          </p>
          <div className="flex items-center gap-3 text-sm text-white/80">
            <div className="flex -space-x-2">
              <div className="w-8 h-8 rounded-full bg-amber-300 border-2 border-violet-600 flex items-center justify-center text-xs font-black text-amber-900">
                DO
              </div>
              <div className="w-8 h-8 rounded-full bg-emerald-300 border-2 border-violet-600 flex items-center justify-center text-xs font-black text-emerald-900">
                TC
              </div>
              <div className="w-8 h-8 rounded-full bg-pink-300 border-2 border-violet-600 flex items-center justify-center text-xs font-black text-pink-900">
                MR
              </div>
            </div>
            <span>Joined by 12,400+ athletes this season</span>
          </div>
        </div>

        <div className="relative text-xs text-white/70">
          © 2026 Kinectem · Made for youth sports
        </div>
      </aside>

      <main className="flex items-center justify-center p-8 md:p-12">
        <div className="w-full max-w-sm space-y-6">
          {/* Header */}
          <div className="space-y-2">
            <h2 className="font-black tracking-tight text-3xl" data-testid="text-auth-heading">
              {mode === "signin" && "Welcome back"}
              {mode === "signup" && "Create your account"}
              {mode === "forgot" && "Reset your password"}
              {mode === "forgotSent" && "Check your email"}
              {mode === "signupPending" && "One more step"}
              {mode === "guardianPending" && "Guardian confirmation needed"}
            </h2>
            <p className="text-sm text-slate-500">
              {mode === "signin" && "Sign in to keep up with your teams."}
              {mode === "signup" && "Join Kinectem in less than a minute."}
              {mode === "forgot" && "We'll send you a link to set a new password."}
              {mode === "forgotSent" && "If that email exists, a reset link is on its way."}
              {mode === "signupPending" &&
                "Your account is ready — once a parent or guardian confirms it."}
              {mode === "guardianPending" &&
                "Your account can't sign in yet because a parent or guardian still needs to confirm it."}
            </p>
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
            <form className="space-y-4" onSubmit={handleSignIn}>
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
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
                  <Label htmlFor="password" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Password
                  </Label>
                  <button
                    type="button"
                    className="text-xs font-semibold text-violet-600 hover:underline"
                    onClick={() => switchMode("forgot")}
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
                disabled={submitting}
                className="w-full h-11 rounded-xl font-bold bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-700 hover:to-blue-700 text-white"
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
                  onClick={() => switchMode("signup")}
                  className="font-bold text-violet-600 hover:underline"
                  data-testid="btn-switch-signup"
                >
                  Create an account
                </button>
              </p>
            </form>
          )}

          {mode === "signup" && (
            <form className="space-y-4" onSubmit={handleSignUp}>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="first" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                    First name
                  </Label>
                  <Input
                    id="first"
                    required
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Tyler"
                    className="rounded-xl h-11"
                    data-testid="input-signup-first"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="last" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Last name
                  </Label>
                  <Input
                    id="last"
                    required
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Chen"
                    className="rounded-xl h-11"
                    data-testid="input-signup-last"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="role" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  I am a...
                </Label>
                <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                  <SelectTrigger id="role" className="rounded-xl h-11" data-testid="select-signup-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="athlete">Athlete</SelectItem>
                    <SelectItem value="coach">Coach</SelectItem>
                    <SelectItem value="parent">Parent / Guardian</SelectItem>
                    <SelectItem value="admin">Org admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="signup-email" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Email
                </Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    id="signup-email"
                    type="email"
                    autoComplete="email"
                    required
                    value={signupEmail}
                    onChange={(e) => setSignupEmail(e.target.value)}
                    placeholder="you@school.edu"
                    className="rounded-xl h-11 pl-9"
                    data-testid="input-signup-email"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="signup-password" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Password
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    id="signup-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={signupPassword}
                    onChange={(e) => setSignupPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    className="rounded-xl h-11 pl-9"
                    data-testid="input-signup-password"
                  />
                </div>
              </div>

              {role === "athlete" && (
                <div className="space-y-1.5">
                  <Label htmlFor="dob" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Date of birth
                  </Label>
                  <Input
                    id="dob"
                    type="date"
                    value={dob}
                    onChange={(e) => setDob(e.target.value)}
                    className="rounded-xl h-11"
                    data-testid="input-signup-dob"
                  />
                  <p className="text-xs text-slate-500">
                    Athletes under 13 will need a parent or guardian to confirm.
                  </p>
                </div>
              )}

              {isUnder13 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 space-y-3" data-testid="block-guardian">
                  <div className="text-xs font-bold uppercase tracking-wider text-amber-700">
                    Guardian required
                  </div>
                  <p className="text-xs text-amber-900">
                    We'll send a one-time confirmation link to your parent or
                    guardian's email so they can approve and link your account.
                  </p>
                  <div className="space-y-1.5">
                    <Label htmlFor="guardian-email" className="text-xs font-semibold uppercase tracking-wide text-amber-900">
                      Parent or guardian email
                    </Label>
                    <Input
                      id="guardian-email"
                      type="email"
                      required
                      value={guardianEmail}
                      onChange={(e) => setGuardianEmail(e.target.value)}
                      placeholder="parent@email.com"
                      className="rounded-xl h-11 bg-white border-amber-300"
                      data-testid="input-guardian-email"
                    />
                  </div>
                  <label className="flex items-start gap-2 text-xs text-amber-900 cursor-pointer">
                    <Checkbox
                      checked={guardianConsent}
                      onCheckedChange={(v) => setGuardianConsent(v === true)}
                      className="mt-0.5"
                      data-testid="checkbox-guardian-consent"
                    />
                    <span>
                      I confirm my parent or guardian has agreed to receive a
                      confirmation email and approve my account.
                    </span>
                  </label>
                </div>
              )}

              <Button
                type="submit"
                disabled={submitting}
                className="w-full h-11 rounded-xl font-bold bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-700 hover:to-blue-700 text-white"
                data-testid="btn-create-account"
              >
                {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Create account
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>

              <p className="text-center text-sm text-slate-500">
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => switchMode("signin")}
                  className="font-bold text-violet-600 hover:underline"
                  data-testid="btn-switch-signin"
                >
                  Sign in
                </button>
              </p>
            </form>
          )}

          {mode === "forgot" && (
            <form className="space-y-4" onSubmit={handleForgot}>
              <button
                type="button"
                onClick={() => switchMode("signin")}
                className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700"
                data-testid="btn-forgot-back"
              >
                <ArrowLeft className="w-3 h-3" /> Back to sign in
              </button>
              <div className="space-y-1.5">
                <Label htmlFor="forgot-email" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Email
                </Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    id="forgot-email"
                    type="email"
                    required
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    placeholder="you@school.edu"
                    className="rounded-xl h-11 pl-9"
                    data-testid="input-forgot-email"
                  />
                </div>
              </div>
              <Button
                type="submit"
                disabled={submitting}
                className="w-full h-11 rounded-xl font-bold bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-700 hover:to-blue-700 text-white"
                data-testid="btn-send-reset"
              >
                {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Send reset link
              </Button>
            </form>
          )}

          {mode === "forgotSent" && (
            <div className="space-y-4">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-900 flex gap-3">
                <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Reset link sent.</p>
                  <p className="mt-1">
                    If an account exists for {forgotEmail}, we sent instructions
                    to reset the password. The link expires in 1 hour.
                  </p>
                </div>
              </div>
              {forgotResetUrl && (
                <div
                  className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600 space-y-2"
                  data-testid="block-dev-reset-link"
                >
                  <p className="font-bold uppercase tracking-wider text-slate-500">
                    Demo helper
                  </p>
                  <p>
                    No real email is sent in this environment. Use this link to
                    set a new password:
                  </p>
                  <a
                    href={forgotResetUrl}
                    className="block break-all font-mono text-violet-700 hover:underline"
                    data-testid="link-reset-url"
                  >
                    {forgotResetUrl}
                  </a>
                </div>
              )}
              <Button
                type="button"
                onClick={() => switchMode("signin")}
                variant="outline"
                className="w-full h-11 rounded-xl font-bold"
              >
                Back to sign in
              </Button>
            </div>
          )}

          {mode === "guardianPending" && (
            <div className="space-y-4" data-testid="block-guardian-pending">
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
                <p data-testid="text-guardian-pending-message">{guardianPendingMessage}</p>
              </div>
              <Button
                type="button"
                onClick={handleResendGuardian}
                disabled={submitting}
                className="w-full h-11 rounded-xl font-bold bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-700 hover:to-blue-700 text-white"
                data-testid="btn-guardian-resend"
              >
                {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {guardianPendingExpired
                  ? "Send a new confirmation link"
                  : "Resend confirmation link"}
              </Button>
              {guardianResendUrl && (
                <div
                  className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600 space-y-2"
                  data-testid="block-dev-guardian-resend-link"
                >
                  <p className="font-bold uppercase tracking-wider text-slate-500">
                    Demo helper
                  </p>
                  <p>
                    No real email is sent in this environment. Share this link
                    with your guardian:
                  </p>
                  <a
                    href={guardianResendUrl}
                    className="block break-all font-mono text-violet-700 hover:underline"
                    data-testid="link-guardian-resend-url"
                  >
                    {guardianResendUrl}
                  </a>
                </div>
              )}
              <Button
                type="button"
                onClick={() => switchMode("signin")}
                variant="outline"
                className="w-full h-11 rounded-xl font-bold"
              >
                Back to sign in
              </Button>
            </div>
          )}

          {mode === "signupPending" && (
            <div className="space-y-4" data-testid="block-signup-pending">
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
                <p className="font-bold">Awaiting guardian confirmation.</p>
                <p className="mt-1">
                  Your account is created but you can't sign in until your
                  parent or guardian confirms it. We sent a confirmation link
                  to {guardianEmail}.
                </p>
              </div>
              {pendingGuardianUrl && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600 space-y-2">
                  <p className="font-bold uppercase tracking-wider text-slate-500">
                    Demo helper
                  </p>
                  <p>
                    No real email is sent in this environment. Share this link
                    with your guardian:
                  </p>
                  <a
                    href={pendingGuardianUrl}
                    className="block break-all font-mono text-violet-700 hover:underline"
                    data-testid="link-guardian-url"
                  >
                    {pendingGuardianUrl}
                  </a>
                </div>
              )}
              <Button
                type="button"
                onClick={() => switchMode("signin")}
                variant="outline"
                className="w-full h-11 rounded-xl font-bold"
              >
                Back to sign in
              </Button>
            </div>
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
