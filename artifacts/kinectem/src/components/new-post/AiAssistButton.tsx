import { useEffect, useRef, useState } from "react";
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
import { Sparkles, Loader2, Wand2, FileText, PenLine } from "lucide-react";

interface AiAssistButtonProps {
  postType: "short" | "long";
  title?: string;
  body: string;
  gameDate?: string;
  teamName?: string | null;
  onInsert: (text: string) => void;
  /**
   * Pop the dialog open automatically once, right when the composer mounts.
   * The parent passes true only for a brand-new game recap (not highlights,
   * org updates, edits, or reopened drafts with text) so AI Assist greets
   * authors before the blank page does. Dismissing is non-destructive — the
   * pill button stays available to reopen it.
   */
  autoOpen?: boolean;
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
  autoOpen = false,
}: AiAssistButtonProps) {
  const { toast } = useToast();
  const { data: whoami } = useWhoami();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"draft" | "polish">("draft");
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);

  // Fire the auto-open at most once per composer session, and only after
  // whoami resolves (the dialog is author-gated). A ref (not state) guards
  // against re-opening when the user dismisses and whoami refetches.
  const autoOpened = useRef(false);
  const canUse = !!whoami?.canAuthorRecap;
  useEffect(() => {
    if (autoOpen && canUse && !autoOpened.current) {
      autoOpened.current = true;
      setOpen(true);
    }
  }, [autoOpen, canUse]);

  const reset = () => {
    setMode("draft");
    setNotes("");
    setResult("");
    setLoading(false);
  };

  const run = async () => {
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

  const dismiss = () => {
    setOpen(false);
    reset();
  };

  // Only recap authors (org admins / coaches / explicit authors) may use
  // AI Assist. This mirrors the server-side guard on POST /ai/assist;
  // hiding the button keeps non-eligible users (incl. minors) from a
  // guaranteed 403.
  if (!canUse) return null;

  const noun = postType === "short" ? "caption" : "recap";
  const hasBody = !!body.trim();

  return (
    <>
      <Button
        type="button"
        variant="brand"
        size="sm"
        className="ai-assist-shine h-7 gap-1.5 rounded-full text-xs font-bold"
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
              <Sparkles className="h-4 w-4 text-primary" /> Want AI to write
              your {noun}?
            </DialogTitle>
            <DialogDescription>
              Pick how you'd like help — you can edit anything before it goes
              in your post.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {/* Mode picker — two self-explanatory cards. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode("draft")}
                disabled={loading}
                className={`rounded-lg border p-3 text-left transition-colors ${
                  mode === "draft"
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border hover:bg-muted/50"
                }`}
                data-testid="mode-ai-draft"
              >
                <span className="flex items-center gap-1.5 text-sm font-bold">
                  <FileText className="h-3.5 w-3.5 text-primary" /> Draft from
                  notes
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  Jot a few quick notes about the game and AI writes the full{" "}
                  {noun} for you.
                </span>
              </button>
              <button
                type="button"
                onClick={() => setMode("polish")}
                disabled={loading}
                className={`rounded-lg border p-3 text-left transition-colors ${
                  mode === "polish"
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border hover:bg-muted/50"
                }`}
                data-testid="mode-ai-polish"
              >
                <span className="flex items-center gap-1.5 text-sm font-bold">
                  <Wand2 className="h-3.5 w-3.5 text-primary" /> Polish my
                  writing
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  Already wrote something in the post? AI cleans it up and
                  makes it read better.
                </span>
              </button>
            </div>

            {mode === "draft" ? (
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
                  autoFocus
                  data-testid="textarea-ai-notes"
                />
              </div>
            ) : (
              <p
                className="rounded-lg bg-muted/60 border border-border px-3 py-2 text-xs text-muted-foreground font-medium"
                data-testid="text-polish-hint"
              >
                {hasBody
                  ? `Polish uses the text already in your ${noun} — nothing else to type here. Hit "Polish it" and review the improved version.`
                  : `Your ${noun} is still empty, so there's nothing to polish yet. Close this window, write a rough version, then come back — or switch to "Draft from notes".`}
              </p>
            )}

            <Button
              type="button"
              size="sm"
              onClick={run}
              disabled={loading || (mode === "polish" && !hasBody)}
              data-testid="button-ai-generate"
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : mode === "draft" ? (
                <FileText className="h-3.5 w-3.5" />
              ) : (
                <Wand2 className="h-3.5 w-3.5" />
              )}
              {mode === "draft" ? "Write my " + noun : "Polish it"}
            </Button>

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

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="ghost"
              onClick={dismiss}
              className="font-semibold"
              data-testid="button-ai-dismiss"
            >
              <PenLine className="h-3.5 w-3.5 mr-1.5" />
              No thanks, I'll write it myself
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
