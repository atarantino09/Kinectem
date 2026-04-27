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
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [role, setRole] = useState<Role>(initialRole);
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [dob, setDob] = useState("");
  const [guardianEmail, setGuardianEmail] = useState("");
  const [guardianConsent, setGuardianConsent] = useState(false);

  const age = ageInYears(dob);
  const isUnder13 = role === "athlete" && age !== null && age < 13;

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
      })) as { pendingGuardianConfirmation?: boolean };
      if (res?.pendingGuardianConfirmation) {
        onPending(guardianEmail);
        return;
      }
      await qc.invalidateQueries();
      const dest = returnTo || "/";
      if (typeof window !== "undefined") {
        window.location.assign(dest);
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

      {role === "athlete" && (
        <div className="space-y-1.5">
          <Label
            htmlFor="dob"
            className="text-xs font-semibold uppercase tracking-wide text-slate-600"
          >
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
