import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { AdminLayout } from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, KeyRound, Loader2, Sparkles } from "lucide-react";

type ProviderStatus = {
  provider: string;
  configured: boolean;
  model: string | null;
  systemContext: string | null;
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
  const [systemContext, setSystemContext] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  // Seed the editable fields from the stored values once they load.
  useEffect(() => {
    setModel(anthropic?.model ?? "");
  }, [anthropic?.model]);
  useEffect(() => {
    setSystemContext(anthropic?.systemContext ?? "");
  }, [anthropic?.systemContext]);

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
          systemContext: systemContext.trim() || null,
        }),
      });
      setApiKey("");
      toast({ title: "Saved", description: "AI Assist settings updated." });
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
      setSystemContext("");
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
        <h1 className="text-2xl font-black">AI Assist</h1>
        <p className="text-sm text-muted-foreground">
          Connect an AI provider to power the "AI Assist" button in the post
          composer, and tune how it writes. Keys are stored encrypted and never
          shown again.
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

              <div>
                <div className="flex items-center justify-between gap-2">
                  <Label
                    htmlFor="anthropic-context"
                    className="text-xs font-bold uppercase tracking-wide text-muted-foreground"
                  >
                    Context &amp; personality (optional)
                  </Label>
                  <ContextAssistDialog
                    disabled={!anthropic?.configured}
                    onUse={(text) => setSystemContext(text)}
                  />
                </div>
                <Textarea
                  id="anthropic-context"
                  value={systemContext}
                  onChange={(e) => setSystemContext(e.target.value)}
                  placeholder="e.g. Write as the voice of Riverside Youth Soccer. Warm, upbeat, and family-friendly. Always celebrate effort and teamwork, mention our motto 'Play hard, have fun', and keep things short."
                  className="mt-1.5 min-h-[120px]"
                  data-testid="textarea-anthropic-context"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Guidance prepended to every AI Assist generation to shape its
                  voice and add organization-specific context. Use the AI Assist
                  button to help write it (requires a saved key).
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

// Small meta-assist dialog: lets the admin describe the voice they want and
// have the AI draft the "context & personality" instruction. The result is
// editable before it replaces the field. Requires a saved key.
function ContextAssistDialog({
  disabled,
  onUse,
}: {
  disabled: boolean;
  onUse: (text: string) => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setInstruction("");
    setResult("");
    setLoading(false);
  };

  const generate = async () => {
    setLoading(true);
    try {
      const res = await customFetch<{ text: string }>(
        `/api/v1/admin/ai-providers/anthropic/assist-context`,
        {
          method: "POST",
          body: JSON.stringify({
            instruction: instruction.trim() || undefined,
          }),
        },
      );
      setResult(res.text);
    } catch (err) {
      toast({
        title: "AI Assist failed",
        description: err instanceof Error ? err.message : "Something went wrong.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const use = () => {
    if (!result.trim()) return;
    onUse(result.trim());
    toast({ title: "Added — remember to Save" });
    setOpen(false);
    reset();
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 gap-1.5 rounded-full text-xs font-bold"
        disabled={disabled}
        onClick={() => setOpen(true)}
        data-testid="button-context-ai-assist"
        title={
          disabled ? "Save an API key first to use AI Assist" : undefined
        }
      >
        <Sparkles className="h-3.5 w-3.5" /> AI Assist
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) reset();
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" /> Write context &amp;
              personality
            </DialogTitle>
            <DialogDescription>
              Describe the voice and any context you want, and the AI will draft
              the instruction. Leave it blank for a sensible default.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <Label
                htmlFor="context-instruction"
                className="text-xs font-bold uppercase tracking-wide text-muted-foreground"
              >
                What do you want? (optional)
              </Label>
              <Textarea
                id="context-instruction"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="e.g. Voice of Riverside Youth Soccer, warm and upbeat, mention our motto 'Play hard, have fun', keep posts short."
                className="mt-1.5 min-h-[90px]"
                disabled={loading}
                data-testid="textarea-context-instruction"
              />
            </div>

            <Button
              type="button"
              size="sm"
              onClick={generate}
              disabled={loading}
              data-testid="button-context-generate"
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              Generate
            </Button>

            {result && (
              <div>
                <Label
                  htmlFor="context-result"
                  className="text-xs font-bold uppercase tracking-wide text-muted-foreground"
                >
                  Suggestion (edit before using)
                </Label>
                <Textarea
                  id="context-result"
                  value={result}
                  onChange={(e) => setResult(e.target.value)}
                  className="mt-1.5 min-h-[160px]"
                  data-testid="textarea-context-result"
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setOpen(false);
                reset();
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="brand"
              onClick={use}
              disabled={!result.trim()}
              data-testid="button-context-use"
            >
              Use this
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
