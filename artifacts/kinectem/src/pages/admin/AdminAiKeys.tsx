import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { AdminLayout } from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, KeyRound, Loader2 } from "lucide-react";

type ProviderStatus = {
  provider: string;
  configured: boolean;
  model: string | null;
  keyLast4: string | null;
  updatedAt: string | null;
};
type ProvidersResponse = { data: ProviderStatus[]; defaultModel: string };

export default function AdminAiKeys() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<ProvidersResponse>({
    queryKey: ["admin", "ai-providers"],
    queryFn: () =>
      customFetch<ProvidersResponse>(`/api/v1/admin/ai-providers`, {
        method: "GET",
      }),
  });

  const anthropic = data?.data.find((p) => p.provider === "anthropic");
  const defaultModel = data?.defaultModel ?? "";

  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  // Seed the model field from the stored value once it loads.
  useEffect(() => {
    setModel(anthropic?.model ?? "");
  }, [anthropic?.model]);

  const refresh = () =>
    qc.invalidateQueries({ queryKey: ["admin", "ai-providers"] });

  const save = async () => {
    if (!anthropic?.configured && !apiKey.trim()) {
      toast({
        title: "API key required",
        description: "Enter an Anthropic API key to enable AI features.",
      });
      return;
    }
    setSaving(true);
    try {
      await customFetch(`/api/v1/admin/ai-providers/anthropic`, {
        method: "PUT",
        body: JSON.stringify({
          apiKey: apiKey.trim() || undefined,
          model: model.trim() || null,
        }),
      });
      setApiKey("");
      toast({ title: "Saved", description: "Anthropic settings updated." });
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
      await customFetch(`/api/v1/admin/ai-providers/anthropic`, {
        method: "DELETE",
      });
      setApiKey("");
      setModel("");
      toast({
        title: "Removed",
        description: "Anthropic key deleted. AI Assist is now disabled.",
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

  return (
    <AdminLayout>
      <div className="mb-4">
        <h1 className="text-2xl font-black">AI Keys</h1>
        <p className="text-sm text-muted-foreground">
          Connect an AI provider to power the "AI Assist" button in the post
          composer. Keys are stored encrypted and never shown again.
        </p>
      </div>

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <KeyRound className="h-5 w-5" /> Anthropic (Claude)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <>
              {anthropic?.configured ? (
                <div
                  className="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800"
                  data-testid="status-anthropic-configured"
                >
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>
                    Configured — key ending in{" "}
                    <span className="font-mono font-bold">
                      ••••{anthropic.keyLast4}
                    </span>
                    {anthropic.updatedAt && (
                      <>
                        {" "}
                        · updated{" "}
                        {new Date(anthropic.updatedAt).toLocaleDateString()}
                      </>
                    )}
                  </span>
                </div>
              ) : (
                <div
                  className="rounded-lg bg-muted/60 border border-border px-3 py-2 text-sm text-muted-foreground"
                  data-testid="status-anthropic-empty"
                >
                  No key configured yet. AI Assist is disabled until you add one.
                </div>
              )}

              <div>
                <Label
                  htmlFor="anthropic-key"
                  className="text-xs font-bold uppercase tracking-wide text-muted-foreground"
                >
                  API key
                </Label>
                <Input
                  id="anthropic-key"
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={
                    anthropic?.configured
                      ? "Enter a new key to replace the current one"
                      : "sk-ant-…"
                  }
                  className="mt-1.5 font-mono"
                  data-testid="input-anthropic-key"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Get a key from console.anthropic.com. It's encrypted before
                  being stored and is never displayed again.
                </p>
              </div>

              <div>
                <Label
                  htmlFor="anthropic-model"
                  className="text-xs font-bold uppercase tracking-wide text-muted-foreground"
                >
                  Model (optional)
                </Label>
                <Input
                  id="anthropic-model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={defaultModel}
                  className="mt-1.5 font-mono"
                  data-testid="input-anthropic-model"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Leave blank to use the default ({defaultModel || "provider default"}).
                </p>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <Button
                  type="button"
                  onClick={save}
                  disabled={saving}
                  data-testid="button-save-anthropic"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  Save
                </Button>
                {anthropic?.configured && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={remove}
                    disabled={removing}
                    data-testid="button-remove-anthropic"
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
    </AdminLayout>
  );
}
