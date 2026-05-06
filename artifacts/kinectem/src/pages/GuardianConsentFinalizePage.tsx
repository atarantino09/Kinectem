import { useEffect, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Trophy, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

// Task #359 — second leg of the email-plus flow. The guardian opens the
// link in the followup email; we POST it to the API which flips the
// child's account_status to "active" and emails the revoke link.

type State =
  | { kind: "submitting" }
  | { kind: "ok"; athleteName: string }
  | { kind: "error"; message: string };

export default function GuardianConsentFinalizePage() {
  const [, params] = useRoute<{ token: string }>("/guardian-consent/:token/finalize");
  const [, setLocation] = useLocation();
  const token = params?.token ?? "";
  const [state, setState] = useState<State>({ kind: "submitting" });

  useEffect(() => {
    if (!token) {
      setState({ kind: "error", message: "Missing confirmation token." });
      return;
    }
    (async () => {
      try {
        const res = (await customFetch(
          `/api/v1/auth/guardian-consent/${encodeURIComponent(token)}/finalize`,
          { method: "POST", body: JSON.stringify({}) },
        )) as { athleteName: string };
        setState({ kind: "ok", athleteName: res.athleteName });
      } catch (err) {
        const e = err as { message?: string; body?: { error?: string } };
        setState({
          kind: "error",
          message: e?.body?.error ?? e?.message ?? "Could not confirm consent.",
        });
      }
    })();
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="flex items-center justify-center gap-2">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-blue-600 text-white flex items-center justify-center">
            <Trophy className="w-5 h-5" />
          </div>
          <span className="font-black text-2xl tracking-tight text-slate-900">
            Kinect<span className="brand-gradient-text">em</span>
          </span>
        </div>
        <div className="rounded-2xl bg-white shadow-xl ring-1 ring-slate-200 p-6 space-y-4 text-center">
          {state.kind === "submitting" && (
            <div className="py-8 flex justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
            </div>
          )}
          {state.kind === "error" && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span data-testid="text-finalize-error">{state.message}</span>
            </div>
          )}
          {state.kind === "ok" && (
            <div className="space-y-3" data-testid="block-finalize-ok">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
              <h1 className="font-black tracking-tight text-2xl">Account activated</h1>
              <p className="text-sm text-slate-600">
                {state.athleteName}'s account is now active. We also emailed you a
                one-click revoke link in case you change your mind.
              </p>
              <Button variant="brandBlock" onClick={() => setLocation("/login")}>
                Sign in
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
