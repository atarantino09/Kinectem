import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { rateLimitMessage } from "@/lib/auth-errors";
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
import { Mail, Lock, ArrowRight, Loader2 } from "lucide-react";
import {
  DOB_MONTHS,
  DOB_DAYS,
  DOB_YEARS,
  composeDob,
  isValidDob,
} from "@/lib/dob";

export type Role = "athlete" | "coach" | "admin" | "parent";

function ageInYears(dob: string): number | null {
  if (!dob) return null;
  const t = new Date(dob).getTime();
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / (365.25 * 24 * 3600 * 1000);
}

interface SignUpFormProps {
  initialRole?: Role;
  returnTo: string | null;
  onSwitchSignin: () => void;
  onError: (msg: string | null) => void;
  onPending: (guardianEmail: string) => void;
}

export function SignUpForm({
  initialRole = "athlete",
  returnTo,
  onSwitchSignin,
  onError,
  onPending,
}: SignUpFormProps) {
  const qc = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  // Task #359 — neutral age-gate: the user first sees ONLY a date-of-
  // birth field, with no role-related copy that would tip them off to
  // lie. Once they submit, the server tells us whether they are
  // under-13 and we render the appropriate branch.
  const [step, setStep] = useState<"age" | "form">("age");
  const [serverIsUnder13, setServerIsUnder13] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [role, setRole] = useState<Role>(initialRole);
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  // Task #506 — Composed from three dropdowns instead of a native
  // <input type="date">. Same pattern as the profile editor (Task
  // #432): the native picker silently dropped values on some
  // browsers / was hard to use on mobile for older years.
  const [dobMonth, setDobMonth] = useState("");
  const [dobDay, setDobDay] = useState("");
  const [dobYear, setDobYear] = useState("");
  const dobParts = { m: dobMonth, d: dobDay, y: dobYear };
  const dobComplete = Boolean(dobMonth && dobDay && dobYear);
  const dobValid = dobComplete && isValidDob(dobParts);
  const dob = dobValid ? composeDob(dobParts) : "";
  const [guardianEmail, setGuardianEmail] = useState("");
  const [guardianConsent, setGuardianConsent] = useState(false);

  const age = ageInYears(dob);
  const clientUnder13 = age !== null && age < 13;
  // Once the server has classified the visitor, trust that flag — the
  // age gate is sticky on the server side, so it can never downgrade.
  const isUnder13 = serverIsUnder13 || clientUnder13;
  // For adults, role is selectable; under-13 is athlete-only because no
  // other role makes sense for an under-13 visitor.
  const effectiveRole: Role = isUnder13 ? "athlete" : role;

  const handleAgeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    onError(null);
    try {
      if (!dobComplete) {
        throw new Error("Pick a month, day, and year.");
      }
      if (!dobValid) {
        throw new Error("That date doesn't look right — please double-check.");
      }
      // Hit the neutral /auth/age-check first. The server returns
      // { requiresParentalConsent: true|false } and sets the signed
      // `kinectem_age_gate` cookie; the signup call later requires it.
      const probe = (await customFetch("/api/v1/auth/age-check", {
        method: "POST",
        body: JSON.stringify({ dateOfBirth: dob }),
      })) as { requiresParentalConsent?: boolean };
      setServerIsUnder13(Boolean(probe?.requiresParentalConsent));
      setStep("form");
    } catch (err) {
      const e = err as { message?: string; body?: { error?: string } };
      onError(e?.body?.error ?? e?.message ?? "Could not continue. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    onError(null);
    try {
      if (signupPassword.length < 8) {
        throw new Error("Password must be at least 8 characters.");
      }
      if (isUnder13 && (!guardianEmail.trim() || !guardianConsent)) {
        throw new Error(
          "We need a parent or guardian's email and their confirmation to continue.",
        );
      }
      const res = (await customFetch("/api/v1/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          role: effectiveRole,
          email: signupEmail.trim().toLowerCase(),
          password: signupPassword,
          dateOfBirth: dob || null,
          guardianEmail: isUnder13 ? guardianEmail.trim().toLowerCase() : null,
          guardianConsent: isUnder13 ? guardianConsent : undefined,
        }),
      })) as { pendingGuardianConfirmation?: boolean };
      if (res?.pendingGuardianConfirmation) {
        onPending(guardianEmail);
        return;
      }
      await qc.invalidateQueries();
      const dest = returnTo || "/";
      if (typeof window !== "undefined") {
        const base = import.meta.env.BASE_URL.replace(/\/$/, "");
        window.location.assign(base + (dest.startsWith("/") ? dest : "/" + dest));
      }
    } catch (err) {
      const e = err as { message?: string; body?: { error?: string } };
      onError(
        rateLimitMessage(err) ?? e?.body?.error ?? e?.message ?? "Sign-up failed",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (step === "age") {
    const showInvalidHint = dobComplete && !dobValid;
    return (
      <form className="space-y-4" onSubmit={handleAgeSubmit} data-testid="form-age-gate">
        <div className="space-y-1.5">
          <Label
            id="age-dob-label"
            className="text-xs font-semibold uppercase tracking-wide text-slate-600"
          >
            Date of birth
          </Label>
          {/* Task #506 — Three scrollable Select dropdowns (Month /
              Day / Year) match the profile editor pattern and avoid
              the browser-specific bugs of <input type="date"> for the
              age gate. position="popper" + max-h ensures the ~125-
              entry year list scrolls smoothly on desktop and mobile. */}
          <div
            className="grid grid-cols-3 gap-2"
            role="group"
            aria-labelledby="age-dob-label"
            data-testid="input-age-dob"
          >
            <Select value={dobMonth} onValueChange={setDobMonth}>
              <SelectTrigger
                className="rounded-xl h-11"
                aria-label="Birthday month"
                data-testid="signup-dob-month"
              >
                <SelectValue placeholder="Month" />
              </SelectTrigger>
              <SelectContent
                position="popper"
                className="max-h-[min(60vh,24rem)]"
              >
                {DOB_MONTHS.map((m) => (
                  <SelectItem
                    key={m.value}
                    value={m.value}
                    data-testid={`option-signup-dob-month-${m.value}`}
                  >
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={dobDay} onValueChange={setDobDay}>
              <SelectTrigger
                className="rounded-xl h-11"
                aria-label="Birthday day"
                data-testid="signup-dob-day"
              >
                <SelectValue placeholder="Day" />
              </SelectTrigger>
              <SelectContent
                position="popper"
                className="max-h-[min(60vh,24rem)]"
              >
                {DOB_DAYS.map((d) => (
                  <SelectItem
                    key={d}
                    value={d}
                    data-testid={`option-signup-dob-day-${d}`}
                  >
                    {Number(d)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={dobYear} onValueChange={setDobYear}>
              <SelectTrigger
                className="rounded-xl h-11"
                aria-label="Birthday year"
                data-testid="signup-dob-year"
              >
                <SelectValue placeholder="Year" />
              </SelectTrigger>
              <SelectContent
                position="popper"
                className="max-h-[min(60vh,24rem)]"
              >
                {DOB_YEARS.map((y) => (
                  <SelectItem
                    key={y}
                    value={y}
                    data-testid={`option-signup-dob-year-${y}`}
                  >
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {showInvalidHint ? (
            <p
              className="text-xs text-rose-600"
              data-testid="error-signup-dob"
            >
              That date doesn't look right — please double-check.
            </p>
          ) : (
            <p className="text-xs text-slate-500">
              We ask everyone for their date of birth before creating an
              account.
            </p>
          )}
        </div>
        <Button
          type="submit"
          variant="brandBlock"
          disabled={submitting || !dobValid}
          data-testid="btn-age-continue"
        >
          {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Continue
          <ArrowRight className="w-4 h-4 ml-1" />
        </Button>
        <p className="text-center text-sm text-slate-500">
          Already have an account?{" "}
          <button
            type="button"
            onClick={onSwitchSignin}
            className="font-bold text-violet-600 hover:underline"
            data-testid="btn-switch-signin"
          >
            Sign in
          </button>
        </p>
      </form>
    );
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label
            htmlFor="first"
            className="text-xs font-semibold uppercase tracking-wide text-slate-600"
          >
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
          <Label
            htmlFor="last"
            className="text-xs font-semibold uppercase tracking-wide text-slate-600"
          >
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

      {!isUnder13 && (
        <div className="space-y-1.5">
          <Label
            htmlFor="role"
            className="text-xs font-semibold uppercase tracking-wide text-slate-600"
          >
            I am a...
          </Label>
          <Select value={role} onValueChange={(v) => setRole(v as Role)}>
            <SelectTrigger
              id="role"
              className="rounded-xl h-11"
              data-testid="select-signup-role"
            >
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
      )}

      <div className="space-y-1.5">
        <Label
          htmlFor="signup-email"
          className="text-xs font-semibold uppercase tracking-wide text-slate-600"
        >
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
        <Label
          htmlFor="signup-password"
          className="text-xs font-semibold uppercase tracking-wide text-slate-600"
        >
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

      {/* DOB was already captured in step 1; show a read-only summary so
         the user can confirm what they entered before submitting. */}
      <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600 flex items-center justify-between">
        <span>
          Date of birth: <span className="font-semibold text-slate-800">{dob}</span>
        </span>
        <button
          type="button"
          onClick={() => {
            setStep("age");
            setServerIsUnder13(false);
          }}
          className="font-semibold text-violet-600 hover:underline"
          data-testid="btn-edit-dob"
        >
          Change
        </button>
      </div>

      {isUnder13 && (
        <div
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 space-y-3"
          data-testid="block-guardian"
        >
          <div className="text-xs font-bold uppercase tracking-wider text-amber-700">
            Guardian required
          </div>
          <p className="text-xs text-amber-900">
            We'll send a one-time confirmation link to your parent or guardian's
            email so they can approve and link your account.
          </p>
          <div className="space-y-1.5">
            <Label
              htmlFor="guardian-email"
              className="text-xs font-semibold uppercase tracking-wide text-amber-900"
            >
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
        variant="brandBlock"
        disabled={submitting}
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
          onClick={onSwitchSignin}
          className="font-bold text-violet-600 hover:underline"
          data-testid="btn-switch-signin"
        >
          Sign in
        </button>
      </p>
    </form>
  );
}
