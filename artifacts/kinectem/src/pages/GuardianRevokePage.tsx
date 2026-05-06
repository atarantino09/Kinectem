import { useState } from "react";
import { useRoute } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Trophy, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

// Task #359 — one-click revoke. Lands here from the link in the
// finalized-consent email. We require an explicit click so a stray
// preview-fetch in the inbox doesn't disable the account by accident.

type State =
  | { kind: "ready" }
  | { kind: "submitting" }
  | { kind: "ok"; athleteName: string }
  | { kind: "error"; message: string };

export default function GuardianRevokePage() {
  const [, params] = useRoute<{ token: string }>("/guardian-revoke/:token");
  const token = params?.token ?? "";
  const [state, setState] = useState<State>({ kind: "ready" });

  const revoke = async () => {
    setState({ kind: "submitting" });
    try {
      const res = (await customFetch(
        `/api/v1/auth/guardian-revoke/${encodeURIComponent(token)}`,
        { method: "POST", body: JSON.stringify({}) },
      )) as { athleteName: string };
      setState({ kind: "ok", athleteName: res.athleteName });
    } catch (err) {
      const e = err as { message?: string; body?: { error?: string } };
      setState({
        kind: "error",
        message: e?.body?.error ?? e?.message ?? "Could not revoke consent.",
      });
    }
  };

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
        <div className="rounded-2xl bg-white shadow-xl ring-1 ring-slate-200 p-6 space-y-4">
          {state.kind === "ready" && (
            <>
              <h1 className="font-black tracking-tight text-2xl">Revoke parental consent</h1>
              <p className="text-sm text-slate-600">
                Clicking the button below will immediately disable your child's Kinectem
                account and stop any further data collection. You can still sign in to
                your own Kinectem account afterward to manage other children.
              </p>
              <Button
                onClick={revoke}
                variant="destructive"
                className="w-full"
                data-testid="btn-revoke-confirm"
              >
                Revoke consent and disable account
              </Button>
            </>
          )}
          {state.kind === "submitting" && (
            <div className="py-8 flex justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
            </div>
          )}
          {state.kind === "error" && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span data-testid="text-revoke-error">{state.message}</span>
            </div>
          )}
          {state.kind === "ok" && (
            <div className="text-center space-y-3" data-testid="block-revoke-ok">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
              <h1 className="font-black tracking-tight text-2xl">Consent revoked</h1>
              <p className="text-sm text-slate-600">
                {state.athleteName}'s account has been disabled. They can no longer
                sign in. Email <span className="font-medium">privacy@kinectem.com</span>{" "}
                if you want their data deleted.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
