import { useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { rateLimitMessage } from "@/lib/auth-errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, ArrowLeft, Loader2 } from "lucide-react";

interface ForgotFormProps {
  onBack: () => void;
  onError: (msg: string | null) => void;
  onSent: (email: string) => void;
}

export function ForgotForm({ onBack, onError, onSent }: ForgotFormProps) {
  const [forgotEmail, setForgotEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    onError(null);
    try {
      await customFetch("/api/v1/auth/password-reset/request", {
        method: "POST",
        body: JSON.stringify({ email: forgotEmail.trim().toLowerCase() }),
      });
      onSent(forgotEmail);
    } catch (err) {
      const e = err as { message?: string; body?: { error?: string } };
      onError(
        rateLimitMessage(err) ??
          e?.body?.error ??
          e?.message ??
          "Could not request password reset",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700"
        data-testid="btn-forgot-back"
      >
        <ArrowLeft className="w-3 h-3" /> Back to sign in
      </button>
      <div className="space-y-1.5">
        <Label
          htmlFor="forgot-email"
          className="text-xs font-semibold uppercase tracking-wide text-slate-600"
        >
          Email
        </Label>
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            id="forgot-email"
            type="email"
            required
            value={forgotEmail}
            onChange={(e) => setForgotEmail(e.target.value)}
            placeholder="you@school.edu"
            className="rounded-xl h-11 pl-9"
            data-testid="input-forgot-email"
          />
        </div>
      </div>
      <Button
        type="submit"
        disabled={submitting}
        className="w-full h-11 rounded-xl font-bold brand-gradient hover:opacity-90 text-white"
        data-testid="btn-send-reset"
      >
        {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
        Send reset link
      </Button>
    </form>
  );
}
