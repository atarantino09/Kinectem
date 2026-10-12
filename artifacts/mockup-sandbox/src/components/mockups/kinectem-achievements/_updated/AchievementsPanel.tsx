import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "../_mock-hooks";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../_shared/ui/dialog";
import { Button } from "../_shared/ui/button";
import { Switch } from "../_shared/ui/switch";
import { Skeleton } from "../_shared/ui/skeleton";
import { useToast } from "../_mock-hooks";
import {
  useAcknowledgeAchievements, useAchievements, usePauseTeamStreak,
  useUpdateAchievementSettings, type AchievementSubject,
} from "../_mock-hooks";
import { TIER_LABEL, bestAwards, formatDeadlineUtc, hoursUntil, nextThreshold, orderForRow } from "../_shared/achievements";
import { CrestBadge } from "./CrestBadge";
import { Trophy } from "lucide-react";

const STREAK_KEYS = new Set(["reliable-reporter", "on-a-roll"]);

export function AchievementsPanel({ subject, id, title = "Achievements", enabled = true }: {
  subject: AchievementSubject; id: string; title?: string; enabled?: boolean;
}) {
  const { data, isLoading, isError, error, refetch } = useAchievements(subject, id, enabled);
  const [open, setOpen] = useState(false);
  const [confirmPause, setConfirmPause] = useState<string | null>(null);
  const { toast } = useToast();
  const update = useUpdateAchievementSettings(subject, id);
  const ack = useAcknowledgeAchievements(subject, id);
  const pause = usePauseTeamStreak(subject === "team" ? id : confirmPause ?? "");
  const ackSent = useRef(false);

  const unseen = useMemo(() => (data?.canManage ? data.awards.filter((a) => a.celebrated === false) : []), [data]);
  const ackMutate = useRef(ack.mutate);
  ackMutate.current = ack.mutate;
  // Acknowledge once the owner sees the modest banner dismissed or modal opened.
  useEffect(() => {
    if (open && unseen.length && !ackSent.current) {
      ackSent.current = true;
      ackMutate.current(undefined);
    }
    if (!unseen.length) ackSent.current = false;
  }, [open, unseen.length]);

  if (isLoading) return <Skeleton className="h-28 rounded-2xl" aria-busy="true" aria-label="Loading achievements" />;
  const status = (error as { status?: number } | null)?.status;
  if (isError && (status === 403 || status === 404)) return null; // private or unavailable to this viewer
  if (isError || !data) {
    return (
      <div className="app-surface p-4 text-sm flex flex-wrap items-center justify-between gap-3" role="alert" data-testid={`error-achievements-${subject}`}>
        <span className="text-muted-foreground">Achievements could not be loaded.</span>
        <Button size="sm" variant="outline" onClick={() => void refetch()}>Retry</Button>
      </div>
    );
  }

  const { items, best } = orderForRow(data.catalog, data.awards, data.featured);
  const isUser = subject === "user";
  const hiddenFromPublic = data.canManage && data.visibility === "private";
  const privateCopy = isUser
    ? "Only you can see your achievements. Switch to Public in the collection to share them on your profile."
    : `Only authorized ${subject === "team" ? "team" : "organization"} managers can see these achievements. Posts, membership, access, and coaches' career badges are unchanged.`;
  if (best.size === 0 && !data.canManage) return null;

  const setFeatured = (key: string) => {
    const has = data.featured.includes(key);
    update.mutate({ featured: has ? data.featured.filter((k) => k !== key) : [...data.featured, key] }, {
      onError: () => toast({ title: "Couldn't update featured badges", variant: "destructive" }),
    });
  };
  const toggleVisibility = (v: boolean) =>
    update.mutate({ visibility: v ? "public" : "private" }, {
      onError: () => toast({ title: "Couldn't update privacy", variant: "destructive" }),
    });

  return (
    <section className="app-surface relative overflow-hidden p-4 sm:p-5" aria-label={title} data-testid={`section-achievements-${subject}`}>
      <div className="flex items-center justify-between gap-3 flex-wrap border-b border-primary/10 pb-3">
        <h2 className="min-w-0 text-lg font-black tracking-tight flex items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10"><Trophy className="w-4 h-4 text-primary" aria-hidden="true" /></span><span className="min-w-0 break-words">{title}</span><span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-black text-primary-foreground" aria-label={`${best.size} earned`}>{best.size}</span>
        </h2>
        <Button variant="outline" size="sm" className="rounded-full font-bold focus-visible:ring-2 focus-visible:ring-primary" onClick={() => setOpen(true)} data-testid={`button-open-achievements-${subject}`}>
          View collection
        </Button>
      </div>
      {unseen.length > 0 && (
        <p className="mt-3 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm font-semibold" role="status" data-testid={`banner-new-achievement-${subject}`}>
          {unseen.length === 1 ? "A new badge was earned." : `${unseen.length} new badges were earned.`}{" "}
          <button type="button" className="underline rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" onClick={() => ack.mutate(undefined)}>Dismiss</button>
        </p>
      )}
      {hiddenFromPublic && (
        <p className="mt-3 text-xs text-muted-foreground" data-testid="text-achievements-private">
          {privateCopy}
        </p>
      )}
      {data.canManage && data.streaks?.filter((s) => !s.paused && s.status !== "expired"
        && hoursUntil(s.deadline) !== null && hoursUntil(s.deadline)! <= 48).map((s) => (
        <p key={s.teamId} className="mt-3 rounded-lg border border-amber-500/40 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 break-words" role="status">
          {s.teamName}: recap due by {formatDeadlineUtc(s.deadline)}.
          {" "}<button className="underline rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" onClick={() => setOpen(true)}>No games since your last recap? Review your streak.</button>
        </p>
      ))}
      {items.length === 0 && data.canManage ? (
        <p className="mt-3 rounded-xl border border-dashed p-4 text-sm text-muted-foreground" data-testid={`empty-achievements-${subject}`}>{best.size === 0 ? "No badges earned yet. Earned badges, including those from earlier posts, are automatically featured. New collections are Public by default." : "No badges featured. Open your collection to select badges."}</p>
      ) : items.length > 0 ? (
        <ul className="mt-4 flex flex-wrap gap-3" data-testid={`row-achievements-${subject}`}>
          {items.map((c) => {
            const a = best.get(c.key)!;
            return (
              <li key={c.key} className="flex items-center gap-2.5 min-w-0 max-w-full rounded-xl border bg-card/60 py-2 pl-2 pr-3.5">
                <CrestBadge name={c.name} tier={c.thresholds.length > 1 ? a.tier : undefined} size={48} />
                <div className="min-w-0">
                  <p className="text-sm font-bold leading-tight break-words">{c.name}</p>
                  <p className="text-[11px] text-muted-foreground">{c.thresholds.length > 1 ? `${TIER_LABEL[a.tier]} \u00b7 ${a.threshold}` : "Earned"}</p>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[calc(100vw-1.5rem)] max-w-2xl max-h-[85dvh] overflow-y-auto overflow-x-hidden break-words" data-testid={`dialog-achievements-${subject}`}>
          <DialogHeader>
            <DialogTitle className="font-black">{title}</DialogTitle>
            <DialogDescription>
              Earned tiers are permanent. Recap photos count from inline photos or the recap's Photo &amp; Video Album, once per recap.
              {data.photoRecapId && (
                <> <Link href={`/posts/${encodeURIComponent(data.photoRecapId)}`} className="underline font-semibold">Open the recap</Link>.</>
              )}
            </DialogDescription>
          </DialogHeader>
          {data.canManage && <p className="text-xs text-muted-foreground">Streak tracking began {new Date(data.rolloutAt).toLocaleDateString()}. Earlier recaps may count for volume, but do not create historical streaks. Each UTC publication day counts once; the deadline is the end of the tenth following UTC day.</p>}
          {data.canManage && (
            <label className="flex items-center justify-between gap-3 rounded-xl border bg-primary/5 p-3">
              <span className="text-sm">
                <span className="font-bold block">{isUser ? "Show achievements on my profile" : `Show achievements on this ${subject === "team" ? "team" : "organization"} page`}</span>
                <span className="text-xs text-muted-foreground">{data.visibility === "public" ? "Public" : "Private"}. This only affects achievements. New collections are Public by default; earned badges are automatically featured, including badges from earlier posts. You can unfeature badges below. {hiddenFromPublic && privateCopy}</span>
              </span>
              <Switch checked={data.visibility === "public"} onCheckedChange={toggleVisibility} disabled={update.isPending} aria-label="Public achievements" data-testid="switch-achievements-visibility" />
            </label>
          )}
          {data.canManage && data.streaks && data.streaks.length > 0 && (
            <div className="space-y-2" data-testid="list-streaks">
              <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground">Streaks (deadlines in UTC)</h3>
              {data.streaks.map((s) => {
                const h = hoursUntil(s.deadline);
                const due = (s.status === "active" || s.status === "resumed") && h !== null && h > 0 && h <= 48;
                return (
                  <div key={s.teamId} className="rounded-xl border p-3 text-sm break-words" data-testid={`streak-${s.teamId}`}>
                    <p className="font-bold">{s.teamName}</p>
                    <div className="my-1.5 flex gap-2 text-xs font-black"><span className="rounded-full bg-primary/10 px-2 py-0.5">Current {s.current}</span><span className="rounded-full bg-muted px-2 py-0.5">Best {s.best}</span></div>
                    <p className="text-muted-foreground">
                      Current {s.current} &middot; Best {s.best} &middot;{" "}
                      {s.status === "paused" ? "Paused (no-game), protected until the next game recap" : s.status === "expired" ? "Expired, publish a recap to start again" : s.deadline ? `${s.status === "resumed" ? "Resumed · " : ""}Next recap due by ${formatDeadlineUtc(s.deadline)}` : "Active"}
                    </p>
                    {due && <p className="mt-1 font-semibold text-amber-700" role="status">Reminder: less than 48 hours left to keep this streak.</p>}
                    {(s.status === "active" || s.status === "resumed") && s.canPause === true && (
                      confirmPause === s.teamId ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className="text-xs">This team hasn't played since our last recap. Pause indefinitely; the next current-game recap resumes the streak without adding credit for anyone who didn't contribute.</span>
                          <Button size="sm" variant="brand" disabled={pause.isPending} data-testid={`button-confirm-pause-${s.teamId}`}
                            onClick={() => pause.mutate(undefined, {
                              onSuccess: () => setConfirmPause(null),
                              onError: () => toast({ title: "Couldn't pause streak", variant: "destructive" }),
                            })}>Pause streak</Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirmPause(null)}>Cancel</Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="outline" className="mt-2" onClick={() => setConfirmPause(s.teamId)} data-testid={`button-pause-${s.teamId}`}>No games since your last recap?</Button>
                      )
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {data.canManage && data.participation && data.participation.length > 0 && (
            <div data-testid="list-participation">
              <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-2">Teams counted for Connected Club</h3>
              <ul className="text-sm space-y-1">
                {data.participation.map((p) => (
                  <li key={p.teamId} className="flex justify-between gap-2"><span className="min-w-0 break-words">{p.name}</span><span className="shrink-0 text-muted-foreground">{p.participating ? "Participating" : "Not yet"}</span></li>
                ))}
              </ul>
            </div>
          )}
          <ul className="space-y-2">
            {data.catalog.map((c) => {
              const a = bestAwards(data.awards).get(c.key);
              const next = nextThreshold(c, a);
              const prog = data.canManage ? data.progress?.[c.key] : undefined;
              const featured = data.featured.includes(c.key);
              return (
                <li key={c.key} className={`flex flex-wrap items-start gap-3 rounded-xl border p-3 ${a ? "bg-card" : "border-dashed bg-muted/30"}`} data-testid={`achievement-${c.key}`}>
                  <CrestBadge name={c.name} tier={c.thresholds.length > 1 ? a?.tier : undefined} locked={!a} size={48} />
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="font-bold text-sm break-words">{c.name}{a && c.thresholds.length > 1 && <span className="ml-2 text-xs text-muted-foreground">{TIER_LABEL[a.tier]} ({a.threshold})</span>}</p>
                    <p className="text-xs text-muted-foreground">{c.criteria}</p>
                    {c.thresholds.length > 1 && <p className="text-[11px] text-muted-foreground mt-0.5">Tiers: {c.thresholds.map((t, i) => `${TIER_LABEL[(i + 1) as 1 | 2 | 3]} ${t}`).join(" / ")}</p>}
                    {c.thresholds.length === 1 && <p className="text-[11px] text-muted-foreground mt-0.5">Required: {c.key === "connected-club" ? "50% of eligible teams, at least 2 participating" : "1 qualifying contribution"}</p>}
                    {c.key === "connected-club" && data.canManage && data.participation && <p className="text-xs font-semibold mt-1">
                      {data.participation.filter((t) => t.participating).length} of {data.participation.length} eligible teams participating within 30 days
                      {data.participation.length > 0 ? ` (${Math.floor(100 * data.participation.filter((t) => t.participating).length / data.participation.length)}%)` : ""}.
                      {" "}At least 2 participating teams are required.
                    </p>}
                    {prog !== undefined && next !== null && !STREAK_KEYS.has(c.key) && c.key !== "connected-club" && (
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={`${c.name} progress`} aria-valuemin={0} aria-valuemax={next} aria-valuenow={Math.min(prog, next)}><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (prog / next) * 100)}%` }} /></div>
                    )}
                    {prog !== undefined && next !== null && !STREAK_KEYS.has(c.key) && c.key !== "connected-club" && (
                      <p className="text-xs font-semibold mt-1" data-testid={`progress-${c.key}`}>{prog} qualifying {c.key === "beyond-scoreboard" ? "contributions" : "recaps"}; next: {c.thresholds.length > 1 ? TIER_LABEL[(c.thresholds.indexOf(next) + 1) as 1 | 2 | 3] : c.name} at {next}</p>
                    )}
                    {prog !== undefined && next !== null && STREAK_KEYS.has(c.key) && <p className="text-xs font-semibold mt-1">Best run: {prog}; next tier at {next}. Current runs are shown above; an earned badge does not imply an active streak.</p>}
                    {prog !== undefined && next === null && c.key !== "connected-club" && <p className="text-xs font-semibold mt-1">{STREAK_KEYS.has(c.key) ? `Best run: ${prog}; current runs shown above.` : `${prog} qualifying contributions.`} Highest level earned.</p>}
                  </div>
                  {data.canManage && a && (
                    <Button size="sm" variant={featured ? "brand" : "outline"} aria-pressed={featured} disabled={update.isPending} onClick={() => setFeatured(c.key)} data-testid={`button-feature-${c.key}`}>
                      {featured ? "Featured" : "Feature"}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </DialogContent>
      </Dialog>
    </section>
  );
}
