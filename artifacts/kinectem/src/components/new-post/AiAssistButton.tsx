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
import { Sparkles, Loader2, FileText, PenLine } from "lucide-react";

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

// Lets coaches draft a recap/caption from rough notes. Talks to
// POST /ai/assist (Anthropic, key configured by an admin under
// /admin/ai-keys). The suggestion is editable before it replaces the
// post body.
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
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);

  // Fire the auto-open at most once per composer session, and only after
  // whoami resolves (the dialog is author-gated). A ref (not state) guards
  // against re-opening when the user dismisses and whoami refetches.
  const autoOpened = useRef(false);
  const notesRef = useRef<HTMLTextAreaElement | null>(null);
  const canUse = !!whoami?.canAuthorRecap;
  useEffect(() => {
    if (autoOpen && canUse && !autoOpened.current) {
      autoOpened.current = true;
      setOpen(true);
      // Pin the composer behind the dialog to the top of the screen —
      // without this the dialog's initial focus scrolls the page down to
      // the Recap section. (Focus itself is handled scroll-free in
      // onOpenAutoFocus below.)
      window.scrollTo({ top: 0 });
    }
  }, [autoOpen, canUse]);

  const reset = () => {
    setNotes("");
    setResult("");
    setLoading(false);
  };

  const run = async () => {
    if (!notes.trim()) {
      toast({
        title: "Add a few notes first",
        description: "Tell the AI what happened so it has something to work with.",
      });
      return;
    }
    setLoading(true);
    try {
      const res = await customFetch<{ text: string }>(`/api/v1/ai/assist`, {
        method: "POST",
        body: JSON.stringify({
          mode: "draft",
          postType,
          notes: notes.trim(),
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
        <DialogContent
          className="sm:max-w-lg"
          // Focus the notes box without letting the browser scroll the page
          // behind the dialog (default focus scrolls the composer down to
          // the Recap section, hiding the header behind the popup).
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            notesRef.current?.focus({ preventScroll: true });
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" /> Want AI to write
              your {noun}?
            </DialogTitle>
            <DialogDescription>
              Jot a few quick notes about the game and AI writes the full{" "}
              {noun} for you — you can edit it before it goes in your post.
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
                ref={notesRef}
                data-testid="textarea-ai-notes"
              />
            </div>

            <Button
              type="button"
              size="sm"
              onClick={run}
              disabled={loading}
              data-testid="button-ai-generate"
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileText className="h-3.5 w-3.5" />
              )}
              Write my {noun}
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
