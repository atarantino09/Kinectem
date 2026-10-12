import { useId, useState } from "react";
import { ChevronDown, Users } from "lucide-react";
import { Link } from "../_mock-hooks";
import { Skeleton } from "../_shared/ui/skeleton";
import { Button } from "../_shared/ui/button";
import { useOrgContributors } from "../_mock-hooks";
import { bestAwards } from "../_shared/achievements";
import { TIER_LABEL } from "../_shared/achievements";
import { CrestBadge } from "./CrestBadge";

const NAMES: Record<string, string> = {
  "first-story": "First Story", "team-storyteller": "Team Storyteller", "reliable-reporter": "Reliable Reporter",
  "beyond-scoreboard": "Beyond the Scoreboard", "retro-recapper": "Retro Recapper",
};

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "?";
}

export function ContributorsSection({ orgId }: { orgId: string }) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const { data, isLoading, isError, refetch } = useOrgContributors(orgId);
  if (isLoading) return <Skeleton className="h-24 rounded-xl" />;
  if (isError) {
    return (
      <div className="app-surface p-4 text-sm flex flex-wrap items-center justify-between gap-3" role="alert">
        <span className="text-muted-foreground">Contributors could not be loaded.</span>
        <Button size="sm" variant="outline" onClick={() => void refetch()}>Retry</Button>
      </div>
    );
  }
  if (!data || data.length === 0) return null;
  return (
    <section className="app-surface overflow-hidden p-4 sm:p-5" aria-label="Coaches and Contributors" data-testid="section-contributors">
      <h2 className="text-lg font-black tracking-tight">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpanded((value) => !value)}
        >
          <span className="flex min-w-0 items-center gap-2">
            <Users className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            <span>Coaches &amp; Contributors <span className="text-sm font-medium text-muted-foreground">({data.length})</span></span>
          </span>
          <ChevronDown aria-hidden="true" className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`} />
        </button>
      </h2>
      <p className="text-xs text-muted-foreground mt-1">Career achievements shared publicly by people who write for this organization's teams. Listed alphabetically.</p>
      <div id={contentId} hidden={!expanded}>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {data.map((c) => {
            const best = bestAwards(c.awards);
            const keys = [...new Set(c.featured)].filter((k) => best.has(k));
            return (
              <li key={c.id} className="min-w-0 rounded-xl border bg-card/60 p-3.5" data-testid={`contributor-${c.id}`}>
                <div className="flex items-start gap-3">
                  <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-black text-primary">{initials(c.name)}</span>
                  <div className="min-w-0 flex-1">
                    <Link href={`/users/${c.id}`} className="block break-words text-sm font-bold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm">{c.name}</Link>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground break-words">{c.role}</p>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                      {c.teams.map((t) => <Link key={t.id} className="min-w-0 max-w-full break-words underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm" href={`/teams/${t.id}`}>{t.name}</Link>)}
                    </div>
                  </div>
                </div>
                {keys.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
                    {keys.map((k) => (
                      <span key={k} className="flex min-w-0 max-w-full items-center gap-2 rounded-lg bg-muted/60 px-2 py-1.5 text-[11px] font-semibold">
                        <CrestBadge name={NAMES[k] ?? k} tier={k === "first-story" ? undefined : best.get(k)!.tier} size={30} />
                        <span className="min-w-0 break-words">{NAMES[k] ?? k}{k !== "first-story" && ` · ${TIER_LABEL[best.get(k)!.tier]} · ${best.get(k)!.threshold}`} <span className="text-muted-foreground">(career)</span></span>
                      </span>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
