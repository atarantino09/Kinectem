import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trophy, Mail, Lock, ArrowRight, User, Users, Pencil, Camera } from "lucide-react";

function GoogleIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 5.6 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 5.6 29.3 4 24 4 16.3 4 9.7 8.4 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.4-4.5 2.4-7.2 2.4-5.3 0-9.7-3.4-11.3-8l-6.5 5C9.6 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.1 5.6l6.2 5.2C40.7 36.8 44 31 44 24c0-1.2-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M16.365 1.43c0 1.14-.42 2.23-1.18 3.04-.84.91-2.16 1.61-3.21 1.52-.13-1.1.4-2.27 1.16-3.06.85-.89 2.28-1.55 3.23-1.5zM20.5 17.36c-.55 1.27-.81 1.83-1.52 2.95-.99 1.55-2.39 3.49-4.13 3.5-1.55.02-1.95-.99-4.06-.98-2.11.01-2.55 1-4.1.98-1.74-.02-3.07-1.77-4.06-3.32C-.41 16.05-.71 10.4 1.16 7.41 2.5 5.31 4.6 4.05 6.6 4.05c2.04 0 3.32 1.1 5 1.1 1.63 0 2.62-1.1 4.98-1.1 1.79 0 3.69.97 5.04 2.65-4.43 2.41-3.71 8.65-1.12 10.66z" />
    </svg>
  );
}

const ROLES: Array<{ id: "athlete" | "parent" | "coach" | "journalist"; label: string; icon: typeof User; hint: string }> = [
  { id: "athlete", label: "Athlete", icon: User, hint: "I play" },
  { id: "parent", label: "Parent", icon: Users, hint: "My kid plays" },
  { id: "coach", label: "Coach", icon: Camera, hint: "I coach a team" },
  { id: "journalist", label: "Journalist", icon: Pencil, hint: "I cover games" },
];

export function Combined() {
  const [tab, setTab] = useState<"signin" | "signup">("signup");
  const [role, setRole] = useState<"athlete" | "parent" | "coach" | "journalist">("athlete");
  const [under13, setUnder13] = useState(false);

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-100 via-white to-blue-100 flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <div className="flex items-center justify-center gap-2 mb-6">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-blue-600 text-white flex items-center justify-center shadow-md shadow-violet-300">
            <Trophy className="w-5 h-5" />
          </div>
          <span className="font-black text-2xl tracking-tight text-slate-900">Kinectem</span>
        </div>

        <div className="rounded-2xl bg-white shadow-xl shadow-violet-200/50 ring-1 ring-slate-200 overflow-hidden">
          <div className="grid grid-cols-2 bg-slate-100 p-1 m-3 rounded-xl">
            <button
              onClick={() => setTab("signin")}
              className={`h-9 rounded-lg text-sm font-bold transition ${
                tab === "signin" ? "bg-white text-slate-900 shadow" : "text-slate-500"
              }`}
            >
              Sign in
            </button>
            <button
              onClick={() => setTab("signup")}
              className={`h-9 rounded-lg text-sm font-bold transition ${
                tab === "signup" ? "bg-white text-slate-900 shadow" : "text-slate-500"
              }`}
            >
              Create account
            </button>
          </div>

          <div className="px-6 pb-6 pt-2 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Button variant="outline" className="h-10 rounded-xl font-semibold gap-2 border-slate-200">
                <GoogleIcon />
                Google
              </Button>
              <Button variant="outline" className="h-10 rounded-xl font-semibold gap-2 bg-black text-white border-black hover:bg-slate-900 hover:text-white">
                <AppleIcon />
                Apple
              </Button>
            </div>

            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-slate-200" />
              <span className="text-xs uppercase tracking-wider text-slate-400 font-semibold">or</span>
              <div className="h-px flex-1 bg-slate-200" />
            </div>

            <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
              {tab === "signup" && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="first-c" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                        First name
                      </Label>
                      <Input id="first-c" placeholder="Tyler" className="rounded-xl h-10" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="last-c" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Last name
                      </Label>
                      <Input id="last-c" placeholder="Chen" className="rounded-xl h-10" />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      I'm signing up as
                    </Label>
                    <div className="grid grid-cols-4 gap-2">
                      {ROLES.map((r) => {
                        const Icon = r.icon;
                        const active = role === r.id;
                        return (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => setRole(r.id)}
                            className={`rounded-xl border p-2 flex flex-col items-center gap-1 transition ${
                              active
                                ? "border-violet-500 bg-violet-50 text-violet-700 shadow-sm"
                                : "border-slate-200 hover:border-slate-300 text-slate-600"
                            }`}
                          >
                            <Icon className="w-4 h-4" />
                            <span className="text-[11px] font-bold leading-tight">{r.label}</span>
                            <span className="text-[10px] text-slate-400 leading-tight">{r.hint}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="email-c" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Email
                </Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input id="email-c" type="email" placeholder="you@school.edu" className="rounded-xl h-10 pl-9" />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="pw-c" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Password
                  </Label>
                  {tab === "signin" && (
                    <button type="button" className="text-xs font-semibold text-violet-600 hover:underline">
                      Forgot?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input id="pw-c" type="password" placeholder="••••••••" className="rounded-xl h-10 pl-9" />
                </div>
              </div>

              {tab === "signup" && role === "athlete" && (
                <label className="flex items-start gap-2 text-xs text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={under13}
                    onChange={(e) => setUnder13(e.target.checked)}
                    className="mt-0.5 rounded border-slate-300"
                  />
                  <span>I'm under 13 years old</span>
                </label>
              )}

              {tab === "signup" && role === "athlete" && under13 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 space-y-2">
                  <div className="font-bold">Guardian required.</div>
                  <p>
                    We'll send a one-time link to your parent or guardian's
                    email so they can approve and link your account.
                  </p>
                  <Input
                    placeholder="parent@email.com"
                    className="rounded-lg h-9 bg-white border-amber-300 text-slate-900 text-xs"
                  />
                </div>
              )}

              <Button
                type="submit"
                className="w-full h-11 rounded-xl font-bold bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-700 hover:to-blue-700 text-white"
              >
                {tab === "signin" ? "Sign in" : "Create account"}
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </form>
          </div>
        </div>

        <p className="text-center text-xs text-slate-500 mt-5">
          By continuing you agree to our{" "}
          <a className="font-semibold underline">Terms</a> and{" "}
          <a className="font-semibold underline">Privacy Policy</a>.
        </p>
      </div>
    </div>
  );
}
