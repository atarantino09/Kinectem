import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Trophy, Mail, Lock, ArrowRight } from "lucide-react";

export function EmailPassword() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");

  return (
    <div className="min-h-screen grid grid-cols-1 md:grid-cols-2 bg-white text-slate-900">
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

      <main className="flex items-center justify-center p-8 md:p-12">
        <div className="w-full max-w-sm space-y-8">
          <div className="space-y-2">
            <h2 className="font-black tracking-tight text-3xl">
              {mode === "signin" ? "Welcome back" : "Create your account"}
            </h2>
            <p className="text-sm text-slate-500">
              {mode === "signin"
                ? "Sign in to keep up with your teams."
                : "Join Kinectem in less than a minute."}
            </p>
          </div>

          <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
            {mode === "signup" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="first" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                    First name
                  </Label>
                  <Input id="first" placeholder="Tyler" className="rounded-xl h-11" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="last" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Last name
                  </Label>
                  <Input id="last" placeholder="Chen" className="rounded-xl h-11" />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Email
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  id="email"
                  type="email"
                  placeholder="you@school.edu"
                  className="rounded-xl h-11 pl-9"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Password
                </Label>
                {mode === "signin" && (
                  <button type="button" className="text-xs font-semibold text-violet-600 hover:underline">
                    Forgot?
                  </button>
                )}
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  className="rounded-xl h-11 pl-9"
                />
              </div>
            </div>

            {mode === "signin" && (
              <div className="flex items-center gap-2 text-sm">
                <Checkbox id="remember" />
                <Label htmlFor="remember" className="text-slate-600 font-normal cursor-pointer">
                  Keep me signed in
                </Label>
              </div>
            )}

            <Button
              type="submit"
              className="w-full h-11 rounded-xl font-bold bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-700 hover:to-blue-700 text-white"
            >
              {mode === "signin" ? "Sign in" : "Create account"}
              <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </form>

          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
            <span className="font-bold">Heads up.</span> Athletes under 13 must
            link a parent or guardian account during sign-up.
          </div>

          <p className="text-center text-sm text-slate-500">
            {mode === "signin" ? "New to Kinectem?" : "Already have an account?"}{" "}
            <button
              type="button"
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
              className="font-bold text-violet-600 hover:underline"
            >
              {mode === "signin" ? "Create an account" : "Sign in"}
            </button>
          </p>
        </div>
      </main>
    </div>
  );
}
