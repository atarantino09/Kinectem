import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getInitials } from "@/lib/format";
import {
  Trophy,
  Mail,
  ArrowRight,
  User,
  Users,
  Pencil,
  Camera,
  Loader2,
} from "lucide-react";

interface DemoUser {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  email: string | null;
  avatarUrl: string | null;
  sport: string | null;
  position: string | null;
}

type Mode = "signin" | "signup";
type SignupRole = "athlete" | "parent" | "coach" | "admin";

const ROLE_TILES: Array<{
  id: SignupRole;
  label: string;
  icon: typeof User;
  hint: string;
}> = [
  { id: "athlete", label: "Athlete", icon: User, hint: "I play" },
  { id: "parent", label: "Parent", icon: Users, hint: "My kid plays" },
  { id: "coach", label: "Coach", icon: Camera, hint: "I coach" },
  { id: "admin", label: "Org admin", icon: Pencil, hint: "I run an org" },
];

function readQueryParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const initialSignup = readQueryParam("signup");
  const returnTo = readQueryParam("returnTo");

  const [mode, setMode] = useState<Mode>(initialSignup ? "signup" : "signin");
  const [users, setUsers] = useState<DemoUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sign-up form
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [role, setRole] = useState<SignupRole>(
    initialSignup === "parent" ? "parent" : "athlete",
  );
  const [email, setEmail] = useState("");
  const [dob, setDob] = useState("");
  const [parentId, setParentId] = useState<string | null>(null);
  const [parentQuery, setParentQuery] = useState("");
  const [parentResults, setParentResults] = useState<DemoUser[]>([]);

  const isUnder13 = (() => {
    if (!dob) return false;
    const ms = Date.now() - new Date(dob).getTime();
    return ms / (365.25 * 24 * 3600 * 1000) < 13;
  })();

  useEffect(() => {
    if (!isUnder13 || role !== "athlete") return;
    if (parentQuery.trim().length < 2) {
      setParentResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await customFetch<{ data: DemoUser[] }>(
          `/api/v1/users?role=parent&q=${encodeURIComponent(parentQuery.trim())}`,
        );
        setParentResults(r.data ?? []);
      } catch {
        setParentResults([]);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [parentQuery, isUnder13, role]);

  const selectedParent =
    users.find((u) => u.id === parentId) ??
    parentResults.find((u) => u.id === parentId) ??
    null;

  useEffect(() => {
    customFetch<DemoUser[]>("/api/v1/auth/users")
      .then((rows) => setUsers(rows))
      .catch((e) => setError(e?.message ?? "Failed to load demo users"))
      .finally(() => setLoading(false));
  }, []);

  const signInAs = async (userId: string) => {
    setSubmitting(true);
    setError(null);
    try {
      await customFetch("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ userId }),
      });
      await qc.invalidateQueries();
      setLocation(returnTo || "/");
    } catch (e) {
      setError((e as Error)?.message ?? "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  const signUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (role === "athlete" && isUnder13 && !parentId) {
        throw new Error(
          "Athletes under 13 must link a parent or guardian account.",
        );
      }
      await customFetch("/api/v1/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          firstName,
          lastName,
          role,
          email: email || null,
          dateOfBirth: dob || null,
          parentId: parentId || null,
        }),
      });
      await qc.invalidateQueries();
      setLocation(returnTo || "/");
    } catch (err) {
      setError((err as Error)?.message ?? "Sign-up failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen grid grid-cols-1 md:grid-cols-2 bg-white text-slate-900">
      {/* Left hero panel */}
      <aside className="relative hidden md:flex flex-col justify-between p-10 bg-gradient-to-br from-violet-600 via-purple-600 to-blue-600 text-white overflow-hidden">
        <div className="absolute -top-24 -right-24 w-80 h-80 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 w-80 h-80 rounded-full bg-blue-300/20 blur-3xl" />

        <div className="relative flex items-center gap-2">
          <div className="w-10 h-10 rounded-xl bg-white/15 backdrop-blur flex items-center justify-center">
            <Trophy className="w-5 h-5" />
          </div>
          <span className="font-black text-2xl tracking-tight">Kinectem</span>
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

      {/* Right form panel */}
      <main className="flex items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-md space-y-6">
          {/* Mobile brand mark */}
          <div className="flex items-center gap-2 md:hidden">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-600 to-blue-600 text-white flex items-center justify-center">
              <Trophy className="w-5 h-5" />
            </div>
            <span className="font-black text-xl tracking-tight">Kinectem</span>
          </div>

          {/* Tab switcher */}
          <div className="grid grid-cols-2 bg-slate-100 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setMode("signin")}
              data-testid="tab-signin"
              aria-pressed={mode === "signin"}
              className={`h-9 rounded-lg text-sm font-bold transition ${
                mode === "signin"
                  ? "bg-white text-slate-900 shadow"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => setMode("signup")}
              data-testid="tab-signup"
              aria-pressed={mode === "signup"}
              className={`h-9 rounded-lg text-sm font-bold transition ${
                mode === "signup"
                  ? "bg-white text-slate-900 shadow"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Create account
            </button>
          </div>

          <div className="space-y-2">
            <h2 className="font-black tracking-tight text-3xl">
              {mode === "signin" ? "Welcome back" : "Create your account"}
            </h2>
            <p className="text-sm text-slate-500">
              {mode === "signin"
                ? "Pick a demo account to keep exploring."
                : "Join Kinectem in less than a minute."}
            </p>
          </div>

          {error && (
            <div
              className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700"
              data-testid="text-error"
            >
              {error}
            </div>
          )}

          {mode === "signin" ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
                <span className="font-bold">Demo mode.</span> Real
                email/password sign-in is on the way. For now, pick any
                seeded account below to continue.
              </div>

              {loading ? (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading users...
                </div>
              ) : (
                <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
                  {users.map((u) => {
                    const name = `${u.firstName} ${u.lastName}`.trim();
                    return (
                      <button
                        key={u.id}
                        disabled={submitting}
                        onClick={() => signInAs(u.id)}
                        data-testid={`btn-signin-${u.id}`}
                        className="w-full flex items-center gap-3 p-3 rounded-xl border border-slate-200 hover:border-violet-300 hover:bg-violet-50/40 text-left transition disabled:opacity-50"
                      >
                        <Avatar className="w-10 h-10 border border-slate-200 shrink-0">
                          {u.avatarUrl && <AvatarImage src={u.avatarUrl} />}
                          <AvatarFallback className="bg-slate-900 text-white font-bold text-xs">
                            {getInitials(name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="font-bold text-sm truncate">{name}</p>
                          <p className="text-xs text-slate-500 truncate capitalize">
                            {u.role}
                            {u.position ? ` • ${u.position}` : ""}
                          </p>
                        </div>
                        <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" />
                      </button>
                    );
                  })}
                </div>
              )}

              <p className="text-center text-sm text-slate-500">
                New to Kinectem?{" "}
                <button
                  type="button"
                  onClick={() => setMode("signup")}
                  className="font-bold text-violet-600 hover:underline"
                >
                  Create an account
                </button>
              </p>
            </div>
          ) : (
            <form onSubmit={signUp} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label
                    htmlFor="firstName"
                    className="text-xs font-semibold uppercase tracking-wide text-slate-600"
                  >
                    First name
                  </Label>
                  <Input
                    id="firstName"
                    required
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Tyler"
                    className="rounded-xl h-10"
                    data-testid="input-first-name"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label
                    htmlFor="lastName"
                    className="text-xs font-semibold uppercase tracking-wide text-slate-600"
                  >
                    Last name
                  </Label>
                  <Input
                    id="lastName"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Chen"
                    className="rounded-xl h-10"
                    data-testid="input-last-name"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  I'm signing up as
                </Label>
                <div className="grid grid-cols-4 gap-2">
                  {ROLE_TILES.map((r) => {
                    const Icon = r.icon;
                    const active = role === r.id;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => setRole(r.id)}
                        data-testid={`btn-role-${r.id}`}
                        aria-pressed={active}
                        className={`rounded-xl border p-2 flex flex-col items-center gap-1 transition ${
                          active
                            ? "border-violet-500 bg-violet-50 text-violet-700 shadow-sm"
                            : "border-slate-200 hover:border-slate-300 text-slate-600"
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        <span className="text-[11px] font-bold leading-tight text-center">
                          {r.label}
                        </span>
                        <span className="text-[10px] text-slate-400 leading-tight text-center">
                          {r.hint}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label
                  htmlFor="email"
                  className="text-xs font-semibold uppercase tracking-wide text-slate-600"
                >
                  Email <span className="text-slate-400 normal-case">(optional)</span>
                </Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@school.edu"
                    className="rounded-xl h-10 pl-9"
                    data-testid="input-email"
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
                    className="rounded-xl h-10"
                    data-testid="input-dob"
                  />
                  <p className="text-xs text-slate-500">
                    Athletes under 13 will be prompted to link a parent or
                    guardian account.
                  </p>
                </div>
              )}

              {role === "athlete" && isUnder13 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
                  <div className="text-xs font-bold uppercase tracking-wider text-amber-700">
                    Guardian required
                  </div>
                  <p className="text-xs text-amber-900">
                    Because this athlete is under 13, link a parent or
                    guardian account before continuing.
                  </p>
                  {selectedParent ? (
                    <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-white p-2">
                      <Avatar className="w-8 h-8 border border-slate-200">
                        {selectedParent.avatarUrl && (
                          <AvatarImage src={selectedParent.avatarUrl} />
                        )}
                        <AvatarFallback className="bg-slate-900 text-white font-bold text-[10px]">
                          {getInitials(
                            `${selectedParent.firstName} ${selectedParent.lastName}`,
                          )}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold truncate">
                          {selectedParent.firstName} {selectedParent.lastName}
                        </p>
                        <p className="text-[11px] text-slate-500 truncate">
                          {selectedParent.email ?? "Parent / Guardian"}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setParentId(null)}
                      >
                        Change
                      </Button>
                    </div>
                  ) : (
                    <>
                      <Input
                        value={parentQuery}
                        onChange={(e) => setParentQuery(e.target.value)}
                        placeholder="Search for parent's account by name..."
                        className="rounded-lg h-9 bg-white border-amber-300 text-slate-900 text-xs"
                        data-testid="input-parent-search"
                      />
                      {parentQuery.trim().length >= 2 &&
                        (parentResults.length === 0 ? (
                          <p className="text-xs text-amber-900/80">
                            No parent accounts match. Ask your guardian to
                            create an account first.
                          </p>
                        ) : (
                          <div className="space-y-1 max-h-40 overflow-y-auto">
                            {parentResults.map((p) => (
                              <button
                                type="button"
                                key={p.id}
                                onClick={() => setParentId(p.id)}
                                data-testid={`btn-pick-parent-${p.id}`}
                                className="w-full flex items-center gap-2 p-2 rounded-lg border border-amber-200 bg-white hover:border-amber-400 text-left"
                              >
                                <Avatar className="w-7 h-7 border border-slate-200">
                                  {p.avatarUrl && (
                                    <AvatarImage src={p.avatarUrl} />
                                  )}
                                  <AvatarFallback className="bg-slate-900 text-white font-bold text-[10px]">
                                    {getInitials(
                                      `${p.firstName} ${p.lastName}`,
                                    )}
                                  </AvatarFallback>
                                </Avatar>
                                <span className="text-sm font-bold">
                                  {p.firstName} {p.lastName}
                                </span>
                              </button>
                            ))}
                          </div>
                        ))}
                    </>
                  )}
                </div>
              )}

              <Button
                type="submit"
                disabled={submitting}
                className="w-full h-11 rounded-xl font-bold bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-700 hover:to-blue-700 text-white"
                data-testid="btn-create-account"
              >
                {submitting && (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                )}
                Create account
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>

              <p className="text-center text-xs text-slate-500">
                By continuing you agree to our{" "}
                <span className="font-semibold">Terms</span> and{" "}
                <span className="font-semibold">Privacy Policy</span>.
              </p>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
