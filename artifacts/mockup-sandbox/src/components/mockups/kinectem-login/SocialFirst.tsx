import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trophy, Mail, Lock, ArrowLeft, ArrowRight } from "lucide-react";

function GoogleIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 5.6 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 5.6 29.3 4 24 4 16.3 4 9.7 8.4 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.4-4.5 2.4-7.2 2.4-5.3 0-9.7-3.4-11.3-8l-6.5 5C9.6 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.1 5.6l6.2 5.2C40.7 36.8 44 31 44 24c0-1.2-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M16.365 1.43c0 1.14-.42 2.23-1.18 3.04-.84.91-2.16 1.61-3.21 1.52-.13-1.1.4-2.27 1.16-3.06.85-.89 2.28-1.55 3.23-1.5zM20.5 17.36c-.55 1.27-.81 1.83-1.52 2.95-.99 1.55-2.39 3.49-4.13 3.5-1.55.02-1.95-.99-4.06-.98-2.11.01-2.55 1-4.1.98-1.74-.02-3.07-1.77-4.06-3.32C-.41 16.05-.71 10.4 1.16 7.41 2.5 5.31 4.6 4.05 6.6 4.05c2.04 0 3.32 1.1 5 1.1 1.63 0 2.62-1.1 4.98-1.1 1.79 0 3.69.97 5.04 2.65-4.43 2.41-3.71 8.65-1.12 10.66z" />
    </svg>
  );
}

export function SocialFirst() {
  const [showEmail, setShowEmail] = useState(false);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-violet-50 via-white to-blue-50 p-6">
      <div className="w-full max-w-md">
        <div className="rounded-3xl bg-white shadow-xl shadow-violet-200/50 ring-1 ring-slate-200/60 overflow-hidden">
          <div className="px-8 pt-8 pb-2 bg-gradient-to-br from-violet-600 to-blue-600 text-white">
            <div className="flex items-center gap-2 mb-6">
              <div className="w-9 h-9 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center">
                <Trophy className="w-5 h-5" />
              </div>
              <span className="font-black text-xl tracking-tight">Kinectem</span>
            </div>
            <h1 className="font-black tracking-tight text-3xl leading-tight">
              {showEmail ? "Sign in with email" : "Sign in to your team"}
            </h1>
            <p className="text-white/80 text-sm mt-1 mb-8">
              {showEmail
                ? "Use the email you signed up with."
                : "Pick how you'd like to continue."}
            </p>
          </div>

          <div className="px-8 py-7 space-y-3">
            {!showEmail ? (
              <>
                <Button
                  variant="outline"
                  className="w-full h-12 rounded-xl font-semibold justify-start gap-3 border-slate-200 hover:bg-slate-50"
                >
                  <GoogleIcon />
                  Continue with Google
                </Button>
                <Button
                  variant="outline"
                  className="w-full h-12 rounded-xl font-semibold justify-start gap-3 border-slate-200 hover:bg-slate-50 bg-black text-white hover:bg-slate-900 hover:text-white"
                >
                  <AppleIcon />
                  Continue with Apple
                </Button>
                <Button
                  onClick={() => setShowEmail(true)}
                  className="w-full h-12 rounded-xl font-semibold justify-start gap-3 bg-slate-900 hover:bg-slate-800 text-white"
                >
                  <Mail className="w-5 h-5" />
                  Continue with email
                </Button>

                <div className="pt-4 text-center text-sm text-slate-500">
                  New here?{" "}
                  <button className="font-bold text-violet-600 hover:underline">
                    Create an account
                  </button>
                </div>

                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 mt-2">
                  <span className="font-bold">Parent or guardian?</span> You'll be
                  prompted to link your child's account after signing in.
                </div>
              </>
            ) : (
              <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
                <button
                  type="button"
                  onClick={() => setShowEmail(false)}
                  className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700"
                >
                  <ArrowLeft className="w-3 h-3" /> Back
                </button>
                <div className="space-y-1.5">
                  <Label htmlFor="email-2" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Email
                  </Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input
                      id="email-2"
                      type="email"
                      placeholder="you@school.edu"
                      className="rounded-xl h-11 pl-9"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password-2" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Password
                    </Label>
                    <button type="button" className="text-xs font-semibold text-violet-600 hover:underline">
                      Forgot?
                    </button>
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input
                      id="password-2"
                      type="password"
                      placeholder="••••••••"
                      className="rounded-xl h-11 pl-9"
                    />
                  </div>
                </div>
                <Button
                  type="submit"
                  className="w-full h-11 rounded-xl font-bold bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-700 hover:to-blue-700 text-white"
                >
                  Sign in <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </form>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-slate-500 mt-6">
          By continuing you agree to our{" "}
          <a className="font-semibold underline">Terms</a> and{" "}
          <a className="font-semibold underline">Privacy Policy</a>.
        </p>
      </div>
    </div>
  );
}
