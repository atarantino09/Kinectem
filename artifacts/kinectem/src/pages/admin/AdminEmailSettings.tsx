import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { AdminLayout } from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useWhoami } from "@/hooks/useWhoami";
import { CheckCircle2, KeyRound, Loader2, Mail, Send } from "lucide-react";

type ProviderStatus = {
  provider: string;
  configured: boolean;
  fromEmail: string | null;
  keyLast4: string | null;
  updatedAt: string | null;
};
type ProvidersResponse = {
  data: ProviderStatus[];
  fallbackConfigured: boolean;
};

export default function AdminEmailSettings() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: who } = useWhoami();

  const { data, isLoading } = useQuery<ProvidersResponse>({
    queryKey: ["admin", "email-providers"],
    queryFn: () =>
      customFetch<ProvidersResponse>(`/api/v1/admin/email-providers`, {
        method: "GET",
      }),
  });

  const sendgrid = data?.data.find((p) => p.provider === "sendgrid");
  const fallbackConfigured = data?.fallbackConfigured ?? false;

  const [apiKey, setApiKey] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  const [testTo, setTestTo] = useState("");
  const [sendingTest, setSendingTest] = useState(false);

  // Seed editable fields from stored values once they load.
  useEffect(() => {
    setFromEmail(sendgrid?.fromEmail ?? "");
  }, [sendgrid?.fromEmail]);

  // Default the test recipient to the signed-in admin's email.
  useEffect(() => {
    if (!testTo && who?.realUser?.email) setTestTo(who.realUser.email);
  }, [who?.realUser?.email, testTo]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin", "email-providers"] });
  };

  const save = async () => {
    if (!sendgrid?.configured && !apiKey.trim()) {
      toast({
        title: "API key required",
        description: "Enter a SendGrid API key to enable email sending.",
      });
      return;
    }
    if (!fromEmail.trim()) {
      toast({
        title: "From address required",
        description: "Enter the verified sender email address.",
      });
      return;
    }
    setSaving(true);
    try {
      await customFetch(`/api/v1/admin/email-providers/sendgrid`, {
        method: "PUT",
        body: JSON.stringify({
          apiKey: apiKey.trim() || undefined,
          fromEmail: fromEmail.trim(),
        }),
      });
      setApiKey("");
      toast({ title: "Saved", description: "Email settings updated." });
      refresh();
    } catch (err) {
      toast({
        title: "Save failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setRemoving(true);
    try {
      await customFetch(`/api/v1/admin/email-providers/sendgrid`, {
        method: "DELETE",
      });
      setApiKey("");
      setFromEmail("");
      toast({
        title: "Removed",
        description:
          "SendGrid key deleted. Email now falls back to the Replit connector / env vars.",
      });
      refresh();
    } catch (err) {
      toast({
        title: "Remove failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setRemoving(false);
    }
  };

  const sendTest = async () => {
    if (!testTo.trim()) {
      toast({
        title: "Recipient required",
        description: "Enter an email address to send the test to.",
      });
      return;
    }
    setSendingTest(true);
    try {
      await customFetch(`/api/v1/admin/email-providers/sendgrid/test`, {
        method: "POST",
        body: JSON.stringify({ to: testTo.trim() }),
      });
      toast({
        title: "Test sent",
        description: `Check ${testTo.trim()} for the test email.`,
      });
    } catch (err) {
      toast({
        title: "Test failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSendingTest(false);
    }
  };

  return (
    <AdminLayout>
      <div className="mb-4">
        <h1 className="text-2xl font-black">Email</h1>
        <p className="text-sm text-muted-foreground">
          Configure the SendGrid account used to send all Kinectem emails. When
          set here, these credentials take precedence over the Replit connector
          and environment variables. The API key is stored encrypted and never
          shown again.
        </p>
      </div>

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Mail className="h-5 w-5" /> SendGrid
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <>
              {sendgrid?.configured ? (
                <div
                  className="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800"
                  data-testid="status-sendgrid-configured"
                >
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>
                    Configured — key ending in{" "}
                    <span className="font-mono font-bold">
                      ••••{sendgrid.keyLast4}
                    </span>
                    {sendgrid.fromEmail && (
                      <>
                        {" "}
                        · from{" "}
                        <span className="font-mono">{sendgrid.fromEmail}</span>
                      </>
                    )}
                    {sendgrid.updatedAt && (
                      <>
                        {" "}
                        · updated{" "}
                        {new Date(sendgrid.updatedAt).toLocaleDateString()}
                      </>
                    )}
                  </span>
                </div>
              ) : (
                <div
                  className="rounded-lg bg-muted/60 border border-border px-3 py-2 text-sm text-muted-foreground"
                  data-testid="status-sendgrid-empty"
                >
                  No key configured here.{" "}
                  {fallbackConfigured
                    ? "Email currently sends via the Replit connector / environment variables."
                    : "Email is not configured — add a key below to enable sending."}
                </div>
              )}

              <div>
                <Label
                  htmlFor="sendgrid-key"
                  className="text-xs font-bold uppercase tracking-wide text-muted-foreground"
                >
                  API key
                </Label>
                <Input
                  id="sendgrid-key"
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={
                    sendgrid?.configured
                      ? "Enter a new key to replace the current one"
                      : "SG.…"
                  }
                  className="mt-1.5 font-mono"
                  data-testid="input-sendgrid-key"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Create a key at app.sendgrid.com (Settings → API Keys). It's
                  encrypted before being stored and is never displayed again.
                </p>
              </div>

              <div>
                <Label
                  htmlFor="sendgrid-from"
                  className="text-xs font-bold uppercase tracking-wide text-muted-foreground"
                >
                  From email (verified sender)
                </Label>
                <Input
                  id="sendgrid-from"
                  type="email"
                  autoComplete="off"
                  value={fromEmail}
                  onChange={(e) => setFromEmail(e.target.value)}
                  placeholder="no-reply@kinectem.com"
                  className="mt-1.5"
                  data-testid="input-sendgrid-from"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Must be a sender SendGrid has verified, or delivery will fail.
                </p>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <Button
                  type="button"
                  onClick={save}
                  disabled={saving}
                  data-testid="button-save-sendgrid"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  Save
                </Button>
                {sendgrid?.configured && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={remove}
                    disabled={removing}
                    data-testid="button-remove-sendgrid"
                  >
                    {removing && <Loader2 className="h-4 w-4 animate-spin" />}
                    Remove key
                  </Button>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="max-w-xl mt-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Send className="h-5 w-5" /> Send a test email
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Sends a test message using the current settings (the key above if
            set, otherwise the Replit connector / env vars).
          </p>
          <div>
            <Label
              htmlFor="test-to"
              className="text-xs font-bold uppercase tracking-wide text-muted-foreground"
            >
              Recipient
            </Label>
            <Input
              id="test-to"
              type="email"
              autoComplete="off"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder="you@example.com"
              className="mt-1.5"
              data-testid="input-test-to"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={sendTest}
            disabled={sendingTest || (!sendgrid?.configured && !fallbackConfigured)}
            data-testid="button-send-test"
          >
            {sendingTest ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <KeyRound className="h-4 w-4" />
            )}
            Send test email
          </Button>
        </CardContent>
      </Card>
    </AdminLayout>
  );
}
