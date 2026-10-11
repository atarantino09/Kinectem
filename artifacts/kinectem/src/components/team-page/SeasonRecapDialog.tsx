import { useEffect, useRef, useState } from "react";
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
import { Sparkles, Loader2, Trophy, FileText, Newspaper } from "lucide-react";
import { formatDateUTC } from "@/lib/format";
import { CompetitionMatchSources, type RecapCompetition, type RecapCompetitionMatch } from "./CompetitionMatchSources";

interface SeasonRecap {
  id: string;
  title: string;
  gameDate: string | null;
  opponentName: string | null;
  teamScore: number | null;
  opponentScore: number | null;
}

interface SeasonNewsReference {
  id: string;
  title: string;
  gameDate: string | null;
  sourceName: string | null;
  description: string | null;
}

interface SeasonNewsAvailability {
  datedCount: number;
  undatedCount: number;
  earliestGameDate: string | null;
  latestGameDate: string | null;
}

interface NewsContextResult {
  id: string;
  title: string;
  status: "analyzed" | "metadata_fallback";
}

const MAX_NEWS_CONTEXT_SOURCES = 5;

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
  return formatDateUTC(iso);
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
  const [news, setNews] = useState<SeasonNewsReference[]>([]);
  const [newsAvailability, setNewsAvailability] =
    useState<SeasonNewsAvailability | null>(null);
  const [selectedNews, setSelectedNews] = useState<Set<string>>(new Set());
  const [newsContext, setNewsContext] = useState<NewsContextResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [loadingRecaps, setLoadingRecaps] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [title, setTitle] = useState("");
  const [draft, setDraft] = useState("");
  const [draftReady, setDraftReady] = useState(false);
  const [sourceMode, setSourceMode] = useState<"recaps" | "competition">("recaps");
  const [competitions, setCompetitions] = useState<RecapCompetition[]>([]);
  const [competitionId, setCompetitionId] = useState("");
  const [matches, setMatches] = useState<RecapCompetitionMatch[]>([]);
  const [selectedMatches, setSelectedMatches] = useState<Set<string>>(new Set());
  const [confirmedPlayed, setConfirmedPlayed] = useState(false);
  const [competitionError, setCompetitionError] = useState<string | null>(null);
  const [generatedCompetitionId, setGeneratedCompetitionId] = useState<string | null>(null);
  const [generatedBracketId, setGeneratedBracketId] = useState<string | null>(null);
  const [draftStale, setDraftStale] = useState(false);
  const epoch = useRef(0);
  const previousTeamId = useRef(teamId);
  const sourcesChanged = () => {
    epoch.current++;
    setDraftStale(true);
  };
  const changeDate = (value: string, isStart: boolean) => {
    sourcesChanged();
    if (isStart) setStart(value); else setEnd(value);
    setSearched(false);
    setSelected(new Set());
    setSelectedNews(new Set());
    setLoadingRecaps(false);
  };
  const selectCompetition = async (id: string) => {
    sourcesChanged();
    const current = epoch.current;
    setCompetitionId(id);
    setMatches([]);
    setSelectedMatches(new Set());
    setConfirmedPlayed(false);
    setCompetitionError(null);
    setSearched(false);
    setLoadingRecaps(false);
    if (!id) return;
    setLoadingRecaps(true);
    try {
      const result = await customFetch<{ matches: RecapCompetitionMatch[] }>(
        `/api/v1/teams/${teamId}/season-recap/recaps?competitionId=${encodeURIComponent(id)}`,
      );
      if (current !== epoch.current) return;
      setMatches(result.matches);
      setSearched(true);
    } catch (err) {
      if (current === epoch.current) setCompetitionError(err instanceof Error ? err.message : "Couldn't load matches.");
    } finally {
      if (current === epoch.current) setLoadingRecaps(false);
    }
  };
  const changeSourceMode = async (mode: "recaps" | "competition") => {
    sourcesChanged();
    const current = epoch.current;
    setSourceMode(mode);
    setCompetitionId("");
    setMatches([]);
    setSelectedMatches(new Set());
    setRecaps([]);
    setSelected(new Set());
    setNews([]);
    setSelectedNews(new Set());
    setSearched(false);
    setCompetitionError(null);
    setLoadingRecaps(false);
    if (mode === "recaps") return;
    setLoadingRecaps(true);
    try {
      const result = await customFetch<{ data: RecapCompetition[] }>(
        `/api/v1/teams/${teamId}/season-recap/competitions`,
      );
      if (current === epoch.current) setCompetitions(result.data);
    } catch (err) {
      if (current === epoch.current) setCompetitionError(err instanceof Error ? err.message : "Couldn't load competitions.");
    } finally {
      if (current === epoch.current) setLoadingRecaps(false);
    }
  };

  const reset = () => {
    epoch.current++;
    setSourceMode("recaps");
    setCompetitions([]);
    setCompetitionId("");
    setMatches([]);
    setSelectedMatches(new Set());
    setConfirmedPlayed(false);
    setCompetitionError(null);
    setGeneratedCompetitionId(null);
    setGeneratedBracketId(null);
    setDraftStale(false);
    const r = defaultRange();
    setStart(r.start);
    setEnd(r.end);
    setRecaps([]);
    setSelected(new Set());
    setNews([]);
    setNewsAvailability(null);
    setSelectedNews(new Set());
    setNewsContext([]);
    setSearched(false);
    setLoadingRecaps(false);
    setGenerating(false);
    setTitle("");
    setDraft("");
    setDraftReady(false);
  };

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };
  useEffect(() => {
    if (!open || previousTeamId.current !== teamId) reset();
    previousTeamId.current = teamId;
    return () => { epoch.current++; };
  }, [open, teamId]);

  const findRecaps = async () => {
    sourcesChanged();
    const current = epoch.current;
    setLoadingRecaps(true);
    try {
      const params = new URLSearchParams();
      if (start) params.set("start", start);
      if (end) params.set("end", end);
      const res = await customFetch<{
        data: SeasonRecap[];
        news?: SeasonNewsReference[];
        newsAvailability?: SeasonNewsAvailability;
      }>(
        `/api/v1/teams/${teamId}/season-recap/recaps?${params.toString()}`,
      );
      if (current !== epoch.current) return;
      setRecaps(res.data);
      // Default to "keep all" — coach can deselect a subset.
      setSelected(new Set(res.data.map((r) => r.id)));
      const newsReferences = res.news ?? [];
      setNews(newsReferences);
      setSelectedNews(new Set(newsReferences.map((n) => n.id)));
      setNewsAvailability(res.newsAvailability ?? null);
      setSearched(true);
    } catch (err) {
      if (current !== epoch.current) return;
      toast({
        title: "Couldn't load recaps",
        description: err instanceof Error ? err.message : "Something went wrong.",
        variant: "destructive",
      });
    } finally {
      if (current === epoch.current) setLoadingRecaps(false);
    }
  };

  const toggle = (id: string) => {
    sourcesChanged();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected = recaps.length > 0 && selected.size === recaps.length;
  const toggleAll = () => {
    sourcesChanged();
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(recaps.map((r) => r.id)));
  };

  const toggleNews = (id: string) => {
    sourcesChanged();
    setSelectedNews((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allNewsSelected =
    news.length > 0 && selectedNews.size === news.length;
  const toggleAllNews = () => {
    sourcesChanged();
    if (allNewsSelected) setSelectedNews(new Set());
    else setSelectedNews(new Set(news.map((n) => n.id)));
  };

  const generate = async () => {
    if (selected.size === 0 && selectedNews.size === 0 && selectedMatches.size === 0) {
      toast({
        title: "Select at least one source",
        description: "Pick a game recap or news story to include.",
      });
      return;
    }
    if (selectedMatches.size > 25) {
      toast({ title: "Choose 25 or fewer matches", variant: "destructive" });
      return;
    }
    if (sourceMode === "competition" && matches.some((m) => selectedMatches.has(m.id) && m.requiresConfirmation) && !confirmedPlayed) {
      toast({ title: "Confirm the selected matches were played", variant: "destructive" });
      return;
    }
    if (selectedNews.size > MAX_NEWS_CONTEXT_SOURCES) {
      toast({
        title: `Choose ${MAX_NEWS_CONTEXT_SOURCES} or fewer news stories`,
        description:
          "Kinectem reads selected article context only when generating your recap.",
      });
      return;
    }
    setGenerating(true);
    const current = epoch.current;
    try {
      const res = await customFetch<{
        text: string;
        recapCount: number;
        newsCount?: number;
        newsContext?: NewsContextResult[];
        competitionId?: string | null;
        bracketId?: string | null;
      }>(
        `/api/v1/teams/${teamId}/season-recap/generate`,
        {
          method: "POST",
          body: JSON.stringify({
            startDate: sourceMode === "recaps" ? start || undefined : undefined,
            endDate: sourceMode === "recaps" ? end || undefined : undefined,
            recapIds: Array.from(selected),
            newsIds: Array.from(selectedNews),
            ...(sourceMode === "competition" ? {
              competitionId,
              matchIds: Array.from(selectedMatches),
              confirmedPlayedMatchIds: confirmedPlayed
                ? matches.filter((m) => selectedMatches.has(m.id) && m.requiresConfirmation).map((m) => m.id)
                : [],
            } : {}),
          }),
        },
      );
      if (current !== epoch.current) return;
      setDraft(res.text);
      setDraftReady(true);
      setGeneratedCompetitionId(res.competitionId ?? null);
      setGeneratedBracketId(res.bracketId ?? null);
      setDraftStale(false);
      setNewsContext(res.newsContext ?? []);
      const previousDefaultTitle = `${teamName} ${competitions.find((c) => c.id === generatedCompetitionId)?.name ?? "Season"} Recap`;
      if (!title.trim() || title === previousDefaultTitle) {
        setTitle(`${teamName} ${competitions.find((c) => c.id === competitionId)?.name ?? "Season"} Recap`);
      }
    } catch (err) {
      if (current !== epoch.current) return;
      toast({
        title: "Recap generation failed",
        description: err instanceof Error ? err.message : "Something went wrong.",
        variant: "destructive",
      });
    } finally {
      if (current === epoch.current) setGenerating(false);
    }
  };

  const publish = async () => {
    if (draftStale || generating) return;
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
            competitionId: generatedCompetitionId,
            competitionGameId: null,
            ...(generatedCompetitionId ? { bracketId: generatedBracketId } : {}),
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
            Combine {teamName}'s competition matches or published game recaps
            into one story. Actual game dates keep multi-day tournaments in
            order. Review and edit the AI draft before posting.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <fieldset disabled={generating || createPost.isPending} className="space-y-4 min-w-0">
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant={sourceMode === "recaps" ? "default" : "outline"}
              onClick={() => void changeSourceMode("recaps")}>Recap posts & news</Button>
            <Button type="button" size="sm" variant={sourceMode === "competition" ? "default" : "outline"}
              onClick={() => void changeSourceMode("competition")}
              data-testid="button-season-recap-competition-mode">Competition matches</Button>
          </div>
          {sourceMode === "competition" && <CompetitionMatchSources
            competitions={competitions} competitionId={competitionId} matches={matches}
            selected={selectedMatches} loading={loadingRecaps} error={competitionError}
            confirmedPlayed={confirmedPlayed} onCompetitionChange={(id) => void selectCompetition(id)}
            onSelectionChange={(ids) => { sourcesChanged(); setSelectedMatches(ids); setConfirmedPlayed(false); }}
            onConfirmPlayed={(value) => { sourcesChanged(); setConfirmedPlayed(value); }}
          />}
          {sourceMode === "recaps" && <>
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
                onChange={(e) => changeDate(e.target.value, true)}
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
                onChange={(e) => changeDate(e.target.value, false)}
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
            Find sources
          </Button>
          <p className="text-xs text-muted-foreground">Game dates come from the linked schedule when available. Undated recaps are included as “Game date unknown”; posting dates are never used as game dates.</p>
          </>}

          {searched && (
            <div className="space-y-4">
              {sourceMode === "recaps" && <>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black uppercase tracking-widest text-muted-foreground">
                    Game recaps
                  </span>
                  {recaps.length > 0 && (
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
                  )}
                </div>
                {recaps.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No published game recaps in this date range.
                  </p>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">
                      {selected.size} of {recaps.length} selected
                    </p>
                    {selected.size > 25 && <p role="alert" className="text-sm text-destructive">
                      Select 25 or fewer recap posts before generating. None have been discarded.
                    </p>}
                    <div className="max-h-52 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                      {recaps.map((r) => {
                        const score =
                          r.teamScore != null && r.opponentScore != null
                            ? `${r.teamScore}-${r.opponentScore}`
                            : null;
                        const meta = [
                          r.gameDate ? formatGameDate(r.gameDate) : "Game date unknown",
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
                  </>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-black uppercase tracking-widest text-muted-foreground">
                    <Newspaper className="h-3.5 w-3.5" />
                    Related news coverage
                  </span>
                  {news.length > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={toggleAllNews}
                      className="h-7 text-xs font-bold"
                      data-testid="button-season-recap-toggle-all-news"
                    >
                      {allNewsSelected ? "Clear all" : "Select all"}
                    </Button>
                  )}
                </div>
                {news.length === 0 ? (
                  <p
                    className="text-sm text-muted-foreground"
                    data-testid="text-season-news-empty-state"
                  >
                    {newsAvailability?.undatedCount &&
                    newsAvailability.datedCount === 0
                      ? `${newsAvailability.undatedCount} team news ${
                          newsAvailability.undatedCount === 1
                            ? "article has"
                            : "articles have"
                        } no saved game date. Use Edit game date on the news card, then find sources again.`
                      : newsAvailability?.datedCount
                        ? `No dated news coverage matches this period. Dated team news is available from ${formatGameDate(
                            newsAvailability.earliestGameDate,
                          )} to ${formatGameDate(
                            newsAvailability.latestGameDate,
                          )}; adjust the date range if needed.`
                        : "No dated news coverage has been added for this team yet."}
                  </p>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">
                      {selectedNews.size} of {news.length} selected
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Up to {MAX_NEWS_CONTEXT_SOURCES} selected articles are
                      read when you generate. If a site blocks access,
                      Kinectem uses its saved headline and description instead.
                    </p>
                    <div className="max-h-52 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                      {news.map((n) => {
                        const meta = [formatGameDate(n.gameDate), n.sourceName]
                          .filter(Boolean)
                          .join(" · ");
                        return (
                          <label
                            key={n.id}
                            className="flex items-start gap-3 p-3 cursor-pointer hover:bg-muted/50"
                            data-testid={`row-season-news-${n.id}`}
                          >
                            <Checkbox
                              checked={selectedNews.has(n.id)}
                              onCheckedChange={() => toggleNews(n.id)}
                              className="mt-0.5"
                              data-testid={`checkbox-season-news-${n.id}`}
                            />
                            <div className="min-w-0">
                              <p className="text-sm font-bold leading-tight truncate">
                                {n.title}
                              </p>
                              {meta && (
                                <p className="text-xs text-muted-foreground truncate">
                                  {meta}
                                </p>
                              )}
                              {n.description && (
                                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                                  {n.description}
                                </p>
                              )}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>

              </>}
              <Button
                type="button"
                variant="brand"
                onClick={generate}
                disabled={
                  generating ||
                  (selected.size === 0 && selectedNews.size === 0 && selectedMatches.size === 0) ||
                  selectedMatches.size > 25 ||
                  selected.size > 25 ||
                  (!confirmedPlayed && matches.some((m) => selectedMatches.has(m.id) && m.requiresConfirmation))
                }
                className="w-full font-bold"
                data-testid="button-season-recap-generate"
              >
                {generating ? (
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4 mr-1.5" />
                )}
                {draftReady ? "Regenerate draft" : "Generate recap"}
              </Button>
            </div>
          )}
          </fieldset>

          {draftReady && (
            <div className="space-y-4 pt-2 border-t border-border">
              {draftStale && <p role="status" className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
                Sources changed. Your text is preserved, but regenerate the draft before posting so it matches the selected games and competition.
              </p>}
              {newsContext.length > 0 && (
                <p
                  className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground"
                  data-testid="text-season-recap-news-context-status"
                >
                  {(() => {
                    const analyzed = newsContext.filter(
                      (item) => item.status === "analyzed",
                    ).length;
                    const fallback = newsContext.length - analyzed;
                    const parts: string[] = [];
                    if (analyzed) {
                      parts.push(
                        `${analyzed} ${
                          analyzed === 1 ? "article" : "articles"
                        } analyzed`,
                      );
                    }
                    if (fallback) {
                      parts.push(
                        `${fallback} ${
                          fallback === 1 ? "article used" : "articles used"
                        } saved metadata`,
                      );
                    }
                    return `News context: ${parts.join("; ")}.`;
                  })()}
                </p>
              )}
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
            disabled={createPost.isPending || generating || draftStale || !draft.trim()}
            data-testid="button-season-recap-publish"
          >
            {createPost.isPending ? "Posting…" : "Post recap"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
