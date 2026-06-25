import { useState } from "react";
import { formatOrgName } from "@/lib/format";
import { useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import {
  useCreateOrgPost,
  getListOrgPostsQueryKey,
  getListFeedQueryKey,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Sparkles, Loader2, Newspaper, FileText } from "lucide-react";

interface NewsletterRecap {
  id: string;
  title: string;
  teamId: string;
  teamName: string;
  gameDate: string | null;
  opponentName: string | null;
  teamScore: number | null;
  opponentScore: number | null;
}

// Default the window to the trailing month so the most common "monthly
// newsletter" flow needs zero date fiddling.
function defaultRange(): { start: string; end: string } {
  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - 1);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}

function formatGameDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Lets org owners/admins generate a newsletter that weaves their teams'
// published game recaps over a date range into one AI-drafted update, then
// post it as an org announcement. Talks to the org-scoped newsletter endpoints
// (GET recaps to pick from, POST generate for the draft) and reuses the
// existing org-post create path to publish.
export function NewsletterDialog({
  orgId,
  orgName,
  open,
  onOpenChange,
}: {
  orgId: string;
  orgName: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const createOrgPost = useCreateOrgPost();
  const initial = defaultRange();
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [recaps, setRecaps] = useState<NewsletterRecap[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searched, setSearched] = useState(false);
  const [loadingRecaps, setLoadingRecaps] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [title, setTitle] = useState("");
  const [draft, setDraft] = useState("");

  const reset = () => {
    const r = defaultRange();
    setStart(r.start);
    setEnd(r.end);
    setRecaps([]);
    setSelected(new Set());
    setSearched(false);
    setLoadingRecaps(false);
    setGenerating(false);
    setTitle("");
    setDraft("");
  };

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const findRecaps = async () => {
    setLoadingRecaps(true);
    try {
      const params = new URLSearchParams();
      if (start) params.set("start", start);
      if (end) params.set("end", end);
      const res = await customFetch<{ data: NewsletterRecap[] }>(
        `/api/v1/organizations/${orgId}/newsletter/recaps?${params.toString()}`,
      );
      setRecaps(res.data);
      // Default to "keep all" — admin can deselect a subset.
      setSelected(new Set(res.data.map((r) => r.id)));
      setSearched(true);
    } catch (err) {
      toast({
        title: "Couldn't load recaps",
        description: err instanceof Error ? err.message : "Something went wrong.",
        variant: "destructive",
      });
    } finally {
      setLoadingRecaps(false);
    }
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected = recaps.length > 0 && selected.size === recaps.length;
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(recaps.map((r) => r.id)));
  };

  const generate = async () => {
    if (selected.size === 0) {
      toast({
        title: "Select at least one recap",
        description: "Pick the recaps you want included in the newsletter.",
      });
      return;
    }
    setGenerating(true);
    try {
      const res = await customFetch<{ text: string; recapCount: number }>(
        `/api/v1/organizations/${orgId}/newsletter/generate`,
        {
          method: "POST",
          body: JSON.stringify({
            startDate: start || undefined,
            endDate: end || undefined,
            recapIds: Array.from(selected),
          }),
        },
      );
      setDraft(res.text);
      if (!title.trim()) {
        setTitle(`${formatOrgName(orgName)} Newsletter`);
      }
    } catch (err) {
      toast({
        title: "Newsletter generation failed",
        description: err instanceof Error ? err.message : "Something went wrong.",
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  };

  const publish = async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    if (!draft.trim()) {
      toast({ title: "Nothing to post yet", variant: "destructive" });
      return;
    }
    try {
      await createOrgPost.mutateAsync({
        orgId,
        data: {
          title: trimmedTitle,
          body: draft.trim(),
          photoUrls: [],
          videoUrl: null,
        },
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: getListOrgPostsQueryKey(orgId) }),
        qc.invalidateQueries({ queryKey: getListFeedQueryKey() }),
      ]);
      toast({ title: "Newsletter posted" });
      reset();
      onOpenChange(false);
    } catch {
      toast({ title: "Couldn't publish newsletter", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-xl rounded-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-black tracking-tight flex items-center gap-2">
            <Newspaper className="w-5 h-5 text-primary" /> Create newsletter
          </DialogTitle>
          <DialogDescription>
            Generate an AI draft from {formatOrgName(orgName)}'s published game
            recaps, then post it as an announcement.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label
                htmlFor="newsletterStart"
                className="text-xs font-black uppercase tracking-widest text-muted-foreground"
              >
                From
              </Label>
              <Input
                id="newsletterStart"
                type="date"
                value={start}
                max={end || undefined}
                onChange={(e) => setStart(e.target.value)}
                className="mt-2"
                data-testid="input-newsletter-start"
              />
            </div>
            <div>
              <Label
                htmlFor="newsletterEnd"
                className="text-xs font-black uppercase tracking-widest text-muted-foreground"
              >
                To
              </Label>
              <Input
                id="newsletterEnd"
                type="date"
                value={end}
                min={start || undefined}
                onChange={(e) => setEnd(e.target.value)}
                className="mt-2"
                data-testid="input-newsletter-end"
              />
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={findRecaps}
            disabled={loadingRecaps}
            className="font-bold rounded-full"
            data-testid="button-newsletter-find-recaps"
          >
            {loadingRecaps ? (
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            ) : (
              <FileText className="w-4 h-4 mr-1.5" />
            )}
            Find recaps
          </Button>

          {searched && (
            <div className="space-y-2">
              {recaps.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No published recaps in this date range. Try a wider range.
                </p>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black uppercase tracking-widest text-muted-foreground">
                      {selected.size} of {recaps.length} selected
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={toggleAll}
                      className="h-7 text-xs font-bold"
                      data-testid="button-newsletter-toggle-all"
                    >
                      {allSelected ? "Clear all" : "Select all"}
                    </Button>
                  </div>
                  <div className="max-h-52 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                    {recaps.map((r) => {
                      const score =
                        r.teamScore != null && r.opponentScore != null
                          ? `${r.teamScore}-${r.opponentScore}`
                          : null;
                      const meta = [
                        r.teamName,
                        formatGameDate(r.gameDate),
                        r.opponentName ? `vs ${r.opponentName}` : null,
                        score,
                      ]
                        .filter(Boolean)
                        .join(" · ");
                      return (
                        <label
                          key={r.id}
                          className="flex items-start gap-3 p-3 cursor-pointer hover:bg-muted/50"
                          data-testid={`row-newsletter-recap-${r.id}`}
                        >
                          <Checkbox
                            checked={selected.has(r.id)}
                            onCheckedChange={() => toggle(r.id)}
                            className="mt-0.5"
                            data-testid={`checkbox-newsletter-recap-${r.id}`}
                          />
                          <div className="min-w-0">
                            <p className="text-sm font-bold leading-tight truncate">
                              {r.title}
                            </p>
                            {meta && (
                              <p className="text-xs text-muted-foreground truncate">
                                {meta}
                              </p>
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                  <Button
                    type="button"
                    variant="brand"
                    onClick={generate}
                    disabled={generating || selected.size === 0}
                    className="w-full font-bold"
                    data-testid="button-newsletter-generate"
                  >
                    {generating ? (
                      <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-4 h-4 mr-1.5" />
                    )}
                    {draft ? "Regenerate draft" : "Generate newsletter"}
                  </Button>
                </>
              )}
            </div>
          )}

          {draft && (
            <div className="space-y-4 pt-2 border-t border-border">
              <div>
                <Label
                  htmlFor="newsletterTitle"
                  className="text-xs font-black uppercase tracking-widest text-muted-foreground"
                >
                  Title
                </Label>
                <Input
                  id="newsletterTitle"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Newsletter title"
                  className="mt-2"
                  data-testid="input-newsletter-title"
                />
              </div>
              <div>
                <Label
                  htmlFor="newsletterBody"
                  className="text-xs font-black uppercase tracking-widest text-muted-foreground"
                >
                  Newsletter (edit before posting)
                </Label>
                <Textarea
                  id="newsletterBody"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className="mt-2 min-h-64"
                  data-testid="textarea-newsletter-body"
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleClose(false)}
            disabled={createOrgPost.isPending}
            className="font-bold rounded-full"
          >
            Cancel
          </Button>
          <Button
            variant="brand"
            onClick={publish}
            disabled={createOrgPost.isPending || !draft.trim()}
            data-testid="button-newsletter-publish"
          >
            {createOrgPost.isPending ? "Posting…" : "Post newsletter"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
