import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Trophy, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

// Task #359 — first leg of the COPPA email-plus parental consent flow.
// The guardian arrives via the link in the notice email, sees the
// verbatim notice text, ticks the agreement box, and submits. The
// athlete account stays disabled until the second-email finalize step.

type Notice = {
  athleteName: string;
  guardianEmail: string;
  noticeVersion: string;
  noticeText: string;
  state: string;
};

type State =
  | { kind: "loading" }
  | { kind: "ready"; notice: Notice }
  | { kind: "submitting"; notice: Notice }
  | { kind: "submitted"; athleteName: string; guardianEmail: string }
  | { kind: "error"; message: string };

export default function GuardianConsentPage() {
  const [, params] = useRoute<{ token: string }>("/guardian-consent/:token");
  const token = params?.token ?? "";
  const [state, setState] = useState<State>({ kind: "loading" });
  const [agreed, setAgreed] = useState(false);

  useEffect(() => {
    if (!token) {
      setState({ kind: "error", message: "Missing consent token." });
      return;
    }
    (async () => {
      try {
        const notice = (await customFetch(
          `/api/v1/auth/guardian-consent/${encodeURIComponent(token)}`,
          { method: "GET" },
        )) as Notice;
        setState({ kind: "ready", notice });
      } catch (err) {
        const e = err as { message?: string; body?: { error?: string } };
        setState({
          kind: "error",
          message: e?.body?.error ?? e?.message ?? "Could not load consent notice.",
        });
      }
    })();
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (state.kind !== "ready") return;
    if (!agreed) {
      setState({ kind: "error", message: "Please tick the box to grant consent." });
      return;
    }
    const notice = state.notice;
    setState({ kind: "submitting", notice });
    try {
      const res = (await customFetch(
        `/api/v1/auth/guardian-consent/${encodeURIComponent(token)}`,
        {
          method: "POST",
          body: JSON.stringify({ agreed: true, noticeVersion: notice.noticeVersion }),
        },
      )) as { guardianEmail: string; athleteName: string };
      setState({
        kind: "submitted",
        athleteName: res.athleteName,
        guardianEmail: res.guardianEmail,
      });
    } catch (err) {
      const e = err as { message?: string; body?: { error?: string } };
      setState({
        kind: "error",
        message: e?.body?.error ?? e?.message ?? "Could not submit consent.",
      });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-2xl space-y-6">
        <div className="flex items-center justify-center gap-2">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-blue-600 text-white flex items-center justify-center">
            <Trophy className="w-5 h-5" />
          </div>
          <span className="font-black text-2xl tracking-tight text-slate-900">
            Kinect<span className="brand-gradient-text">em</span>
          </span>
        </div>

        <div className="rounded-2xl bg-white shadow-xl ring-1 ring-slate-200 p-6 space-y-4">
          {state.kind === "loading" && (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
            </div>
          )}

          {state.kind === "error" && (
            <div className="space-y-3">
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span data-testid="text-consent-error">{state.message}</span>
              </div>
            </div>
          )}

          {(state.kind === "ready" || state.kind === "submitting") && (
            <form onSubmit={submit} className="space-y-4">
              <h1 className="font-black tracking-tight text-2xl">
                Parental consent for {state.notice.athleteName}
              </h1>
              <p className="text-sm text-slate-500">
                Notice version <span className="font-mono">{state.notice.noticeVersion}</span> sent
                to <span className="font-medium">{state.notice.guardianEmail}</span>.
              </p>
              <pre
                data-testid="text-consent-notice"
                className="whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-800 font-sans max-h-80 overflow-auto"
              >
                {state.notice.noticeText}
              </pre>
              <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
                <Checkbox
                  checked={agreed}
                  onCheckedChange={(v) => setAgreed(v === true)}
                  className="mt-0.5"
                  data-testid="checkbox-consent-agree"
                />
                <span>
                  I am the parent or legal guardian of {state.notice.athleteName} and
                  I grant verifiable consent for Kinectem to collect the personal
                  information described above, subject to the limits listed.
                </span>
              </label>
              <Button
                type="submit"
                variant="brandBlock"
                disabled={state.kind === "submitting"}
                data-testid="btn-consent-submit"
              >
                {state.kind === "submitting" && (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                )}
                Grant consent
              </Button>
            </form>
          )}

          {state.kind === "submitted" && (
            <div className="text-center space-y-3" data-testid="block-consent-submitted">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
              <h1 className="font-black tracking-tight text-2xl">Almost done</h1>
              <p className="text-sm text-slate-600">
                Thanks. We just emailed <span className="font-medium">{state.guardianEmail}</span>{" "}
                a second link to verify it really came from you.{" "}
                {state.athleteName}'s account will activate once you click that link.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
