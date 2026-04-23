import { useEffect, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Trophy, CheckCircle2, AlertCircle, Loader2, Mail } from "lucide-react";

type State =
  | { kind: "ready" }
  | { kind: "submitting" }
  | { kind: "ok"; athleteName: string; guardianEmail: string | null }
  | { kind: "error"; message: string };

export default function GuardianConfirmPage() {
  const [, params] = useRoute<{ token: string }>("/guardian-confirm/:token");
  const [, setLocation] = useLocation();
  const token = params?.token ?? "";
  const [state, setState] = useState<State>({ kind: "ready" });
  const [guardianEmail, setGuardianEmail] = useState("");
  const [confirmIdentity, setConfirmIdentity] = useState(false);

  useEffect(() => {
    if (!token) setState({ kind: "error", message: "Missing confirmation token." });
  }, [token]);

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirmIdentity) {
      setState({
        kind: "error",
        message: "Please confirm you are the parent or guardian before continuing.",
      });
      return;
    }
    setState({ kind: "submitting" });
    try {
      const res = (await customFetch("/api/v1/auth/guardian-confirm", {
        method: "POST",
        body: JSON.stringify({
          token,
          guardianEmail: guardianEmail.trim().toLowerCase(),
        }),
      })) as { athleteName: string; guardianEmail: string | null };
      setState({
        kind: "ok",
        athleteName: res.athleteName,
        guardianEmail: res.guardianEmail,
      });
    } catch (err) {
      const e = err as { message?: string; body?: { error?: string } };
      setState({
        kind: "error",
        message: e?.body?.error ?? e?.message ?? "Could not confirm",
      });
    }
  };

  const showForm = state.kind === "ready" || state.kind === "error" || state.kind === "submitting";

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-violet-50 via-white to-blue-50 p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="flex items-center justify-center gap-2">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-blue-600 text-white flex items-center justify-center">
            <Trophy className="w-5 h-5" />
          </div>
          <span className="font-black text-2xl tracking-tight text-slate-900">
            Kinect<span className="brand-gradient-text">em</span>
          </span>
        </div>

        <div className="rounded-2xl bg-white shadow-xl ring-1 ring-slate-200 p-6 space-y-4">
          {showForm && (
            <form onSubmit={confirm} className="space-y-4">
              <h1 className="font-black tracking-tight text-2xl">Confirm guardian</h1>
              <p className="text-sm text-slate-500">
                A young athlete listed you as their parent or guardian. To
                approve their Kinectem account, enter your own email address
                and confirm your identity below.
              </p>

              {state.kind === "error" && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex gap-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span data-testid="text-guardian-error">{state.message}</span>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="guardian-email" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Your email
                </Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    id="guardian-email"
                    type="email"
                    autoComplete="email"
                    required
                    value={guardianEmail}
                    onChange={(ev) => setGuardianEmail(ev.target.value)}
                    placeholder="parent@email.com"
                    className="rounded-xl h-11 pl-9"
                    data-testid="input-guardian-confirm-email"
                  />
                </div>
                <p className="text-xs text-slate-500">
                  Must match the email the athlete listed for their guardian.
                </p>
              </div>

              <label className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer">
                <Checkbox
                  checked={confirmIdentity}
                  onCheckedChange={(v) => setConfirmIdentity(v === true)}
                  className="mt-0.5"
                  data-testid="checkbox-guardian-identity"
                />
                <span>
                  I confirm I am the parent or legal guardian of this athlete
                  and approve their Kinectem account.
                </span>
              </label>

              <Button
                type="submit"
                disabled={state.kind === "submitting"}
                className="w-full h-11 rounded-xl font-bold bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-700 hover:to-blue-700 text-white"
                data-testid="btn-guardian-confirm"
              >
                {state.kind === "submitting" && (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                )}
                Confirm guardian
              </Button>
            </form>
          )}

          {state.kind === "ok" && (
            <div className="text-center space-y-4" data-testid="block-guardian-ok">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
              <h1 className="font-black tracking-tight text-2xl">Account confirmed</h1>
              <p className="text-sm text-slate-500">
                {state.athleteName}'s account is now active. They can sign in.
              </p>
              <Button
                onClick={() => setLocation("/login")}
                className="w-full h-11 rounded-xl font-bold bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-700 hover:to-blue-700 text-white"
              >
                Go to sign in
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
