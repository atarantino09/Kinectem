import { useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useWhoami } from "@/hooks/useWhoami";
import { Sparkles, Loader2, Wand2, FileText } from "lucide-react";

interface AiAssistButtonProps {
  postType: "short" | "long";
  title?: string;
  body: string;
  gameDate?: string;
  teamName?: string | null;
  onInsert: (text: string) => void;
}

// Lets coaches draft a recap/caption from rough notes, or polish what they've
// already typed. Talks to POST /ai/assist (Anthropic, key configured by an
// admin under /admin/ai-keys). The suggestion is editable before it replaces
// the post body.
export function AiAssistButton({
  postType,
  title,
  body,
  gameDate,
  teamName,
  onInsert,
}: AiAssistButtonProps) {
  const { toast } = useToast();
  const { data: whoami } = useWhoami();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setNotes("");
    setResult("");
    setLoading(false);
  };

  const run = async (mode: "draft" | "polish") => {
    if (mode === "draft" && !notes.trim()) {
      toast({
        title: "Add a few notes first",
        description: "Tell the AI what happened so it has something to work with.",
      });
      return;
    }
    if (mode === "polish" && !body.trim()) {
      toast({
        title: "Nothing to polish yet",
        description: "Write some text in the post first, then polish it.",
      });
      return;
    }
    setLoading(true);
    try {
      const res = await customFetch<{ text: string }>(`/api/v1/ai/assist`, {
        method: "POST",
        body: JSON.stringify({
          mode,
          postType,
          notes: mode === "draft" ? notes.trim() : undefined,
          body: mode === "polish" ? body : undefined,
          title: title?.trim() || undefined,
          teamName: teamName || undefined,
          gameDate: gameDate || undefined,
        }),
      });
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

  const insert = () => {
    if (!result.trim()) return;
    onInsert(result.trim());
    toast({ title: "Added to your post" });
    setOpen(false);
    reset();
  };

  // Only recap authors (org admins / coaches / explicit authors) may use
  // AI Assist. This mirrors the server-side guard on POST /ai/assist;
  // hiding the button keeps non-eligible users (incl. minors) from a
  // guaranteed 403.
  if (!whoami?.canAuthorRecap) return null;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 gap-1.5 rounded-full text-xs font-bold"
        onClick={() => setOpen(true)}
        data-testid="button-ai-assist"
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
              <Sparkles className="h-4 w-4 text-primary" /> AI Assist
            </DialogTitle>
            <DialogDescription>
              Draft a {postType === "short" ? "highlight caption" : "game recap"}{" "}
              from your notes, or polish what you've already written.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <Label
                htmlFor="ai-notes"
                className="text-xs font-bold uppercase tracking-wide text-muted-foreground"
              >
                Your notes
              </Label>
              <Textarea
                id="ai-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Won 3-2 in OT, great team defense, big second-half comeback, everyone hustled…"
                className="mt-1.5 min-h-[100px]"
                disabled={loading}
                data-testid="textarea-ai-notes"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => run("draft")}
                disabled={loading}
                data-testid="button-ai-draft"
              >
                {loading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FileText className="h-3.5 w-3.5" />
                )}
                Draft from notes
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => run("polish")}
                disabled={loading || !body.trim()}
                data-testid="button-ai-polish"
              >
                <Wand2 className="h-3.5 w-3.5" /> Polish current text
              </Button>
            </div>

            {result && (
              <div>
                <Label
                  htmlFor="ai-result"
                  className="text-xs font-bold uppercase tracking-wide text-muted-foreground"
                >
                  Suggestion (edit before inserting)
                </Label>
                <Textarea
                  id="ai-result"
                  value={result}
                  onChange={(e) => setResult(e.target.value)}
                  className="mt-1.5 min-h-[160px]"
                  data-testid="textarea-ai-result"
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
              onClick={insert}
              disabled={!result.trim()}
              data-testid="button-ai-insert"
            >
              Insert into post
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
