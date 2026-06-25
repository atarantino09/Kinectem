import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  useCreatePost,
  getListTeamPostsQueryKey,
  getListTeamPendingPostsQueryKey,
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
import { Sparkles, Loader2, Trophy, FileText } from "lucide-react";

interface SeasonRecap {
  id: string;
  title: string;
  gameDate: string | null;
  opponentName: string | null;
  teamScore: number | null;
  opponentScore: number | null;
}

// Default the window to the trailing ~4 months so a typical season is
// covered out of the box; coaches narrow it for a single tournament.
function defaultRange(): { start: string; end: string } {
  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - 4);
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

// Lets a coach/author weave a team's published game recaps over a date
// range into one AI-drafted season or tournament recap, then post it as a
// team article. Talks to the team-scoped season-recap endpoints (GET recaps
// to pick from, POST generate for the draft) and reuses the existing post
// create path to publish. openapi.yaml is locked, so the recap list +
// generate calls go through customFetch with narrow casts.
export function SeasonRecapDialog({
  teamId,
  teamName,
  open,
  onOpenChange,
}: {
  teamId: string;
  teamName: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const createPost = useCreatePost();
  const initial = defaultRange();
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [recaps, setRecaps] = useState<SeasonRecap[]>([]);
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
      const res = await customFetch<{ data: SeasonRecap[] }>(
        `/api/v1/teams/${teamId}/season-recap/recaps?${params.toString()}`,
      );
      setRecaps(res.data);
      // Default to "keep all" — coach can deselect a subset.
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
        description: "Pick the game recaps you want woven into the recap.",
      });
      return;
    }
    setGenerating(true);
    try {
      const res = await customFetch<{ text: string; recapCount: number }>(
        `/api/v1/teams/${teamId}/season-recap/generate`,
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
        setTitle(`${teamName} Season Recap`);
      }
    } catch (err) {
      toast({
        title: "Recap generation failed",
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
      const result = await createPost.mutateAsync({
        data: {
          postType: "long",
          title: trimmedTitle,
          body: draft.trim(),
          // openapi-generated CreatePostRequest doesn't surface `context`
          // or `recapKind`, but the server reads both — `context` scopes
          // the post to a team and `recapKind: "combined"` marks it as a
          // multi-game recap so the post card shows a distinct pill.
          // Mirror the spread-cast trick used by the new-post composer.
          ...({
            context: { type: "team", id: teamId },
            recapKind: "combined",
          } as object),
        },
      });
      // Non-admin authors have recaps held for approval; the create
      // response echoes `requiresApproval`. Reflect that in the toast.
      const requiresApproval =
        (result as { requiresApproval?: boolean }).requiresApproval === true;
      await Promise.all([
        qc.invalidateQueries({ queryKey: getListTeamPostsQueryKey(teamId) }),
        qc.invalidateQueries({
          queryKey: getListTeamPendingPostsQueryKey(teamId),
        }),
        qc.invalidateQueries({ queryKey: getListFeedQueryKey() }),
      ]);
      toast({
        title: requiresApproval
          ? "Recap submitted for approval"
          : "Season recap posted",
      });
      reset();
      onOpenChange(false);
    } catch {
      toast({ title: "Couldn't publish recap", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-xl rounded-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-black tracking-tight flex items-center gap-2">
            <Trophy className="w-5 h-5 text-primary" /> Season / tournament
            recap
          </DialogTitle>
          <DialogDescription>
            Generate one AI draft from {teamName}'s published game recaps over a
            date range — perfect for a tournament run or a whole season — then
            post it as a team recap.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label
                htmlFor="seasonRecapStart"
                className="text-xs font-black uppercase tracking-widest text-muted-foreground"
              >
                From
              </Label>
              <Input
                id="seasonRecapStart"
                type="date"
                value={start}
                max={end || undefined}
                onChange={(e) => setStart(e.target.value)}
                className="mt-2"
                data-testid="input-season-recap-start"
              />
            </div>
            <div>
              <Label
                htmlFor="seasonRecapEnd"
                className="text-xs font-black uppercase tracking-widest text-muted-foreground"
              >
                To
              </Label>
              <Input
                id="seasonRecapEnd"
                type="date"
                value={end}
                min={start || undefined}
                onChange={(e) => setEnd(e.target.value)}
                className="mt-2"
                data-testid="input-season-recap-end"
              />
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={findRecaps}
            disabled={loadingRecaps}
            className="font-bold rounded-full"
            data-testid="button-season-recap-find-recaps"
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
                      data-testid="button-season-recap-toggle-all"
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
                          data-testid={`row-season-recap-${r.id}`}
                        >
                          <Checkbox
                            checked={selected.has(r.id)}
                            onCheckedChange={() => toggle(r.id)}
                            className="mt-0.5"
                            data-testid={`checkbox-season-recap-${r.id}`}
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
                    data-testid="button-season-recap-generate"
                  >
                    {generating ? (
                      <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-4 h-4 mr-1.5" />
                    )}
                    {draft ? "Regenerate draft" : "Generate recap"}
                  </Button>
                </>
              )}
            </div>
          )}

          {draft && (
            <div className="space-y-4 pt-2 border-t border-border">
              <div>
                <Label
                  htmlFor="seasonRecapTitle"
                  className="text-xs font-black uppercase tracking-widest text-muted-foreground"
                >
                  Title
                </Label>
                <Input
                  id="seasonRecapTitle"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Recap title"
                  className="mt-2"
                  data-testid="input-season-recap-title"
                />
              </div>
              <div>
                <Label
                  htmlFor="seasonRecapBody"
                  className="text-xs font-black uppercase tracking-widest text-muted-foreground"
                >
                  Recap (edit before posting)
                </Label>
                <Textarea
                  id="seasonRecapBody"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className="mt-2 min-h-64"
                  data-testid="textarea-season-recap-body"
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleClose(false)}
            disabled={createPost.isPending}
            className="font-bold rounded-full"
          >
            Cancel
          </Button>
          <Button
            variant="brand"
            onClick={publish}
            disabled={createPost.isPending || !draft.trim()}
            data-testid="button-season-recap-publish"
          >
            {createPost.isPending ? "Posting…" : "Post recap"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
