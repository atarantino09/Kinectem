import { useState } from "react";
import { useLocation, useRoute } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trophy, Lock, Loader2, CheckCircle2 } from "lucide-react";

export default function ResetPasswordPage() {
  const [, params] = useRoute<{ token: string }>("/reset-password/:token");
  const [, setLocation] = useLocation();
  const token = params?.token ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (password.length < 8) {
        throw new Error("Password must be at least 8 characters.");
      }
      if (password !== confirm) {
        throw new Error("Passwords do not match.");
      }
      await customFetch("/api/v1/auth/password-reset/complete", {
        method: "POST",
        body: JSON.stringify({ token, newPassword: password }),
      });
      setDone(true);
    } catch (err) {
      const e = err as { message?: string; body?: { error?: string } };
      setError(e?.body?.error ?? e?.message ?? "Could not reset password");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-violet-50 via-white to-blue-50 p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center justify-center gap-2">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-blue-600 text-white flex items-center justify-center">
            <Trophy className="w-5 h-5" />
          </div>
          <span className="font-black text-2xl tracking-tight text-slate-900">
            Kinect<span className="brand-gradient-text">em</span>
          </span>
        </div>

        {done ? (
          <div className="rounded-2xl bg-white shadow-xl ring-1 ring-slate-200 p-6 text-center space-y-4">
            <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
            <h1 className="font-black tracking-tight text-2xl">Password updated</h1>
            <p className="text-sm text-slate-500">
              You can now sign in with your new password.
            </p>
            <Button
              onClick={() => setLocation("/login")}
              className="w-full h-11 rounded-xl font-bold bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-700 hover:to-blue-700 text-white"
              data-testid="btn-go-signin"
            >
              Go to sign in
            </Button>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="rounded-2xl bg-white shadow-xl ring-1 ring-slate-200 p-6 space-y-4"
          >
            <div className="space-y-1">
              <h1 className="font-black tracking-tight text-2xl">Set a new password</h1>
              <p className="text-sm text-slate-500">
                Choose a password that's at least 8 characters.
              </p>
            </div>
            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" data-testid="text-reset-error">
                {error}
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="new-pw" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                New password
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  id="new-pw"
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="rounded-xl h-11 pl-9"
                  data-testid="input-new-password"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-pw" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Confirm password
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  id="confirm-pw"
                  type="password"
                  required
                  minLength={8}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="rounded-xl h-11 pl-9"
                  data-testid="input-confirm-password"
                />
              </div>
            </div>
            <Button
              type="submit"
              disabled={submitting}
              className="w-full h-11 rounded-xl font-bold bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-700 hover:to-blue-700 text-white"
              data-testid="btn-set-password"
            >
              {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Set new password
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
