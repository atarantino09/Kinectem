import { useEffect, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Trophy, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

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

  useEffect(() => {
    if (!token) setState({ kind: "error", message: "Missing confirmation token." });
  }, [token]);

  const confirm = async () => {
    setState({ kind: "submitting" });
    try {
      const res = (await customFetch("/api/v1/auth/guardian-confirm", {
        method: "POST",
        body: JSON.stringify({ token }),
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
          {state.kind === "ready" && (
            <>
              <h1 className="font-black tracking-tight text-2xl">Confirm guardian</h1>
              <p className="text-sm text-slate-500">
                A young athlete has listed this email address as their parent
                or guardian. Click confirm to approve their Kinectem account.
              </p>
              <Button
                onClick={confirm}
                className="w-full h-11 rounded-xl font-bold bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-700 hover:to-blue-700 text-white"
                data-testid="btn-guardian-confirm"
              >
                Confirm guardian
              </Button>
            </>
          )}

          {state.kind === "submitting" && (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Loader2 className="w-4 h-4 animate-spin" /> Confirming...
            </div>
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

          {state.kind === "error" && (
            <div className="text-center space-y-4">
              <AlertCircle className="w-10 h-10 text-red-500 mx-auto" />
              <h1 className="font-black tracking-tight text-2xl">Could not confirm</h1>
              <p className="text-sm text-slate-500" data-testid="text-guardian-error">
                {state.message}
              </p>
              <Button
                variant="outline"
                onClick={() => setLocation("/login")}
                className="w-full h-11 rounded-xl font-bold"
              >
                Back to sign in
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
