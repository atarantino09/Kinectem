import { useState } from "react";
import { ParentSetupOverview } from "@/components/family-setup/ParentSetupOverview";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { safeInternalPath } from "@/lib/safePath";
import { rateLimitMessage } from "@/lib/auth-errors";
import { completeInviteAuthentication, inviteAccountToken } from "@/lib/parent-invite-account";
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
import {
  Mail,
  Lock,
  ArrowRight,
  Loader2,
  Eye,
  EyeOff,
  Building2,
  Users,
  ChevronRight,
} from "lucide-react";
import {
  DOB_MONTHS,
  DOB_DAYS,
  DOB_YEARS,
  composeDob,
  isValidDob,
} from "@/lib/dob";

// "org_admin" is a client-only onboarding choice, not a backend account
// role. The `users.role` enum is locked to athlete/coach/parent/admin/fan by
// the OpenAPI spec, and admin === platform admin, so an org admin signs up
// as a regular "coach" on the wire and becomes an actual organization admin
// by creating an organization (they become its owner) right after signup.
// "competition_organizer" follows the same pattern: tournament/league
// operators sign up as "coach" on the wire and get their organizer powers
// by creating a Competition Hub right after signup.
// Task #931 — "fan" IS a real backend role (unlike the two aliases above):
// it submits as-is and creates a normal, baseline-permission account for
// supporters who just want to follow along.
export type Role =
  | "athlete"
  | "coach"
  | "parent"
  | "fan"
  | "org_admin"
  | "competition_organizer";

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
  /** Skip the path-picker step (e.g. when the role is pre-determined from a
   *  URL param, like the parent/guardian deep-link flow). */
  skipPathStep?: boolean;
  /** Fired when the visitor picks a path on the path-picker step, or clears
   *  their selection (null = returned to path picker). */
  onPathChange?: (path: "org_admin" | "general" | null) => void;
  /** Organization named by a private owner-claim invitation. This bypasses
   * the generic role chooser while preserving the neutral age gate. */
  claimingOrganizationName?: string | null;
}

export function SignUpForm({
  initialRole = "athlete",
  returnTo,
  onSwitchSignin,
  onError,
  onPending,
  skipPathStep = false,
  onPathChange,
  claimingOrganizationName,
}: SignUpFormProps) {
  const qc = useQueryClient();
  const inviteToken = /^\/invites\/([^/?#]+)\/?$/.exec(returnTo ?? "")?.[1];
  const signupInvite = useQuery<{ team: { name: string }; invite: { position: string | null } }>({
    queryKey: ["parent-signup-invite", inviteToken],
    queryFn: () => customFetch(`/api/v1/invites/${encodeURIComponent(inviteToken!)}`),
    enabled: initialRole === "parent" && !!inviteToken,
    retry: false,
  });
  const invitedTeamName = signupInvite.data?.invite.position === "player" ? signupInvite.data.team.name : undefined;
  const [submitting, setSubmitting] = useState(false);
  // Task #359 — neutral age-gate: the user first sees ONLY a date-of-
  // birth field, with no role-related copy that would tip them off to
  // lie. Once they submit, the server tells us whether they are
  // under-13 and we render the appropriate branch.
  //
  // Step "path" precedes the age gate: visitors pick whether they're
  // setting up an organization or joining as an athlete/coach/parent/fan.
  // skipPathStep bypasses it for flows where the role is already known
  // (e.g. the ?signup=parent guardian deep-link).
  const [step, setStep] = useState<"path" | "age" | "form">(
    skipPathStep ? "age" : "path",
  );
  // True when the visitor explicitly chose the org-admin card on the
  // path-picker step. Used to lock the role selector and show step
  // indicators throughout the form.
  const [orgAdminViaPath, setOrgAdminViaPath] = useState(false);
  const [serverIsUnder13, setServerIsUnder13] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [role, setRole] = useState<Role>(initialRole);
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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

  const isGuardianInviteReturn = /^\/family-invites\/guardian\//i.test(returnTo ?? "");
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
      // Org admins don't have a distinct backend role — send them as a
      // "coach" account; they get real org-admin powers by creating an org
      // (becoming its owner) on the page we redirect to below.
      const isOrgAdmin = effectiveRole === "org_admin";
      // Competition organizers are also "coach" on the wire — organizer
      // powers come from creating a hub, not from the account role.
      const isCompetitionOrganizer = effectiveRole === "competition_organizer";
      const wireRole =
        isOrgAdmin || isCompetitionOrganizer ? "coach" : effectiveRole;
      const res = (await customFetch("/api/v1/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          role: wireRole,
          email: signupEmail.trim().toLowerCase(),
          password: signupPassword,
          dateOfBirth: dob || null,
          guardianEmail: isUnder13 ? guardianEmail.trim().toLowerCase() : null,
          guardianConsent: isUnder13 ? guardianConsent : undefined,
        }),
      })) as { id?: string; pendingGuardianConfirmation?: boolean };
      if (res?.pendingGuardianConfirmation) {
        onPending(guardianEmail);
        return;
      }
      if (initialRole === "parent" && inviteAccountToken(returnTo)) {
        await qc.cancelQueries();
        qc.clear();
        await completeInviteAuthentication(returnTo, res.id);
      } else {
        await qc.invalidateQueries();
      }
      // Org admins land straight on the Create Organization flow so their
      // first action is setting up the org they'll administer. An explicit
      // returnTo (e.g. an invite deep link) still wins.
      // Competition organizers land on the Competitions page with the
      // "New competition hub" dialog auto-opened (mirrors the org flow).
      const dest =
        safeInternalPath(returnTo) ??
        (isOrgAdmin
          ? "/organizations/mine?new=1"
          : isCompetitionOrganizer
            ? "/competitions?newHub=1"
            : effectiveRole === "parent"
              ? "/family?setup=1"
              : "/");
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

  // ── PATH PICKER ──────────────────────────────────────────────────────────
  if (step === "path") {
    return (
      <div className="space-y-3" data-testid="view-signup-path">
        {/* Org admin hero card — primary, visually dominant */}
        <button
          type="button"
          data-testid="btn-path-org-admin"
          onClick={() => {
            setRole("org_admin");
            setOrgAdminViaPath(true);
            onPathChange?.("org_admin");
            setStep("age");
          }}
          className="w-full text-left rounded-xl border-2 border-primary bg-primary/5 p-5 hover:bg-primary/10 transition-colors group"
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5 w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
              <Building2 className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-widest text-primary mb-1">
                Organization Admin
              </div>
              <div className="font-black text-[15px] text-slate-900 leading-snug">
                Setting up your organization?
              </div>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                You're in the right place. Get your org on Kinectem in two quick steps:
              </p>
              <div className="mt-3 space-y-1.5">
                <div className="flex items-center gap-2 text-xs text-slate-700">
                  <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-black flex items-center justify-center shrink-0">
                    1
                  </span>
                  <span className="font-medium">Create your account</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="w-5 h-5 rounded-full bg-slate-200 text-slate-400 text-[10px] font-black flex items-center justify-center shrink-0">
                    2
                  </span>
                  <span>Name and launch your organization</span>
                </div>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-primary mt-1 shrink-0 group-hover:translate-x-0.5 transition-transform" />
          </div>
        </button>

        {/* Divider */}
        <div className="relative flex items-center gap-3 py-1">
          <div className="flex-1 border-t border-slate-200" />
          <span className="text-[11px] text-slate-400 font-medium shrink-0">or</span>
          <div className="flex-1 border-t border-slate-200" />
        </div>

        {/* Everyone else — secondary, intentionally subdued */}
        <button
          type="button"
          data-testid="btn-path-general"
          onClick={() => {
            setRole(initialRole);
            setOrgAdminViaPath(false);
            onPathChange?.("general");
            setStep("age");
          }}
          className="w-full text-left rounded-xl border border-slate-200 bg-white px-4 py-3.5 hover:border-slate-300 hover:bg-slate-50 transition-colors group"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
              <Users className="w-4 h-4 text-slate-500" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-bold text-sm text-slate-800">
                Athlete, coach, parent, or fan?
              </div>
              <p className="text-xs text-slate-500">
                Create a free account and follow the teams you care about
              </p>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 group-hover:translate-x-0.5 transition-transform" />
          </div>
        </button>

        <p className="text-center text-sm text-slate-500 pt-1">
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
      </div>
    );
  }

  // ── AGE GATE ─────────────────────────────────────────────────────────────
  if (step === "age") {
    const showInvalidHint = dobComplete && !dobValid;
    return (
      <form className="space-y-4" onSubmit={handleAgeSubmit} data-testid="form-age-gate">
        {initialRole === "parent" && !isGuardianInviteReturn && <ParentSetupOverview teamName={invitedTeamName} />}
        {signupInvite.isError && <p role="alert" className="text-xs text-destructive">We couldn’t load the team details. Your invitation will be checked after signup.</p>}
        {orgAdminViaPath && (
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                setOrgAdminViaPath(false);
                setRole(initialRole);
                setDobMonth("");
                setDobDay("");
                setDobYear("");
                setServerIsUnder13(false);
                onPathChange?.(null);
                setStep("path");
              }}
              className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
              data-testid="btn-back-to-path"
            >
              ← Back
            </button>
            <div
              className="flex items-center gap-1.5 text-xs"
              data-testid="text-step-indicator"
            >
              <span className="w-4 h-4 rounded-full bg-primary text-primary-foreground text-[9px] font-black flex items-center justify-center">
                1
              </span>
              <span className="font-semibold text-primary">Step 1 of 2</span>
              <span className="text-slate-400">· Create your account</span>
            </div>
          </div>
        )}
        <div className="space-y-1.5">
          <Label
            id="age-dob-label"
            className="text-xs font-semibold uppercase tracking-wide text-slate-600"
          >
            {initialRole === "parent" ? "Your date of birth" : "Date of birth"}
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
                className="max-h-[min(var(--radix-select-content-available-height),24rem)]"
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
                className="max-h-[min(var(--radix-select-content-available-height),24rem)]"
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
                className="max-h-[min(var(--radix-select-content-available-height),24rem)]"
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
              {initialRole === "parent" ? "Enter your date of birth—not your child’s." : "We ask everyone for their date of birth before creating an account."}
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
      {orgAdminViaPath && (
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setStep("age")}
            className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
            data-testid="btn-back-to-age"
          >
            ← Back
          </button>
          <div
            className="flex items-center gap-1.5 text-xs"
            data-testid="text-step-indicator"
          >
            <span className="w-4 h-4 rounded-full bg-primary text-primary-foreground text-[9px] font-black flex items-center justify-center">
              1
            </span>
            <span className="font-semibold text-primary">Step 1 of 2</span>
            <span className="text-slate-400">· Create your account</span>
          </div>
        </div>
      )}
      {effectiveRole === "parent" && !isGuardianInviteReturn && <ParentSetupOverview teamName={invitedTeamName} />}
      {signupInvite.isError && <p role="alert" className="text-xs text-destructive">We couldn’t load the team details. Your invitation will be checked after signup.</p>}
      {effectiveRole === "parent" && isGuardianInviteReturn && (
        <div
          className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3"
          data-testid="note-guardian-account"
        >
          <div className="text-[11px] font-bold uppercase tracking-wider text-violet-700">
            Adult account
          </div>
          <p className="mt-1 text-xs text-violet-900">
            These details are for <span className="font-semibold">you, the adult</span>, not the player.
            {isGuardianInviteReturn
              ? " After sign-up you will review the invitation and share the player profile your family already created. You will not create another player."
              : " Each adult has their own login and shares one player profile."}
          </p>
        </div>
      )}
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
          {claimingOrganizationName ? (
            <div
              className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3"
              data-testid="badge-org-owner-claim"
            >
              <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-primary">
                  Your individual account
                </div>
                <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600">
                  After signup, this account will become the owner of{" "}
                  <strong>{claimingOrganizationName}</strong> and you'll go
                  directly to its organization page.
                </p>
              </div>
            </div>
          ) : orgAdminViaPath ? (
            // Role was chosen via the path-picker card — lock it and make
            // the org-admin context explicit so nothing feels hidden.
            <div
              className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3"
              data-testid="badge-org-admin-locked"
            >
              <Building2 className="w-4 h-4 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold text-primary">
                  Organization Admin
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Your org setup is next — just one more step after this.
                </p>
              </div>
            </div>
          ) : (
            <>
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
                  <SelectItem value="fan">Fan — follow along</SelectItem>
                  <SelectItem value="org_admin">Organization Admin</SelectItem>
                  <SelectItem value="competition_organizer">
                    Competition Organizer
                  </SelectItem>
                </SelectContent>
              </Select>
              {role === "org_admin" && (
                <p
                  className="text-xs text-slate-500"
                  data-testid="note-org-admin"
                >
                  You'll set up your organization right after creating your
                  account.
                </p>
              )}
              {role === "competition_organizer" && (
                <p
                  className="text-xs text-slate-500"
                  data-testid="note-competition-organizer"
                >
                  For tournament and league operators. You'll set up your
                  competition hub right after creating your account.
                </p>
              )}
            </>
          )}
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
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            required
            minLength={8}
            value={signupPassword}
            onChange={(e) => setSignupPassword(e.target.value)}
            placeholder="At least 8 characters"
            className="rounded-xl h-11 pl-9 pr-10"
            data-testid="input-signup-password"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            data-testid="btn-toggle-signup-password"
          >
            {showPassword ? (
              <EyeOff className="w-4 h-4" />
            ) : (
              <Eye className="w-4 h-4" />
            )}
          </button>
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
