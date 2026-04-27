import { useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { rateLimitMessage } from "@/lib/auth-errors";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2 } from "lucide-react";
import type { GuardianPendingInfo } from "./SignInForm";

export function ForgotSentPanel({
  email,
  onBack,
}: {
  email: string;
  onBack: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-900 flex gap-3">
        <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
        <div>
          <p className="font-bold">Reset link sent.</p>
          <p className="mt-1">
            If an account exists for {email}, we sent instructions to reset the
            password. The link expires in 1 hour.
          </p>
        </div>
      </div>
      <Button
        type="button"
        onClick={onBack}
        variant="outline"
        className="w-full h-11 rounded-xl font-bold"
      >
        Back to sign in
      </Button>
    </div>
  );
}

export function SignupPendingPanel({
  guardianEmail,
  onBack,
}: {
  guardianEmail: string;
  onBack: () => void;
}) {
  return (
    <div className="space-y-4" data-testid="block-signup-pending">
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
        <p className="font-bold">Awaiting guardian confirmation.</p>
        <p className="mt-1">
          Your account is created but you can't sign in until your parent or
          guardian confirms it. We sent a confirmation link to {guardianEmail}.
        </p>
      </div>
      <Button
        type="button"
        onClick={onBack}
        variant="outline"
        className="w-full h-11 rounded-xl font-bold"
      >
        Back to sign in
      </Button>
    </div>
  );
}

interface GuardianPendingPanelProps {
  info: GuardianPendingInfo;
  onError: (msg: string | null) => void;
  onBack: () => void;
}

export function GuardianPendingPanel({
  info,
  onError,
  onBack,
}: GuardianPendingPanelProps) {
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState(info.message);
  const [expired, setExpired] = useState(info.expired);
  const [resendUrl, setResendUrl] = useState<string | null>(null);

  const handleResend = async () => {
    setSubmitting(true);
    onError(null);
    try {
      const res = (await customFetch("/api/v1/auth/guardian-resend", {
        method: "POST",
        body: JSON.stringify({
          email: info.email,
          password: info.password,
        }),
      })) as { guardianConfirmUrl?: string };
      setResendUrl(res?.guardianConfirmUrl ?? null);
      setExpired(false);
      setMessage(
        "We sent a fresh confirmation link to your parent or guardian. It expires in 7 days.",
      );
    } catch (err) {
      const e = err as { message?: string; body?: { error?: string } };
      onError(
        rateLimitMessage(err) ??
          e?.body?.error ??
          e?.message ??
          "Could not resend confirmation",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="block-guardian-pending">
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
        <p data-testid="text-guardian-pending-message">{message}</p>
      </div>
      <Button
        type="button"
        variant="brandBlock"
        onClick={handleResend}
        disabled={submitting}
        data-testid="btn-guardian-resend"
      >
        {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
        {expired ? "Send a new confirmation link" : "Resend confirmation link"}
      </Button>
      {resendUrl && (
        <div
          className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600 space-y-2"
          data-testid="block-dev-guardian-resend-link"
        >
          <p className="font-bold uppercase tracking-wider text-slate-500">
            Demo helper
          </p>
          <p>
            No real email is sent in this environment. Share this link with your
            guardian:
          </p>
          <a
            href={resendUrl}
            className="block break-all font-mono text-violet-700 hover:underline"
            data-testid="link-guardian-resend-url"
          >
            {resendUrl}
          </a>
        </div>
      )}
      <Button
        type="button"
        onClick={onBack}
        variant="outline"
        className="w-full h-11 rounded-xl font-bold"
      >
        Back to sign in
      </Button>
    </div>
  );
}
