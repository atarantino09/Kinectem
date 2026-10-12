import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
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

export function ContributorsSection({ orgId }: { orgId: string }) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const { data, isLoading, isError, refetch } = useOrgContributors(orgId);
  if (isLoading) return <Skeleton className="h-24 rounded-xl" />;
  if (isError) {
    return (
      <div className="app-surface p-4 text-sm flex justify-between gap-3">
        <span className="text-muted-foreground">Contributors could not be loaded.</span>
        <Button size="sm" variant="outline" onClick={() => void refetch()}>Retry</Button>
      </div>
    );
  }
  if (!data || data.length === 0) return null;
  return (
    <section className="app-surface p-4 sm:p-5" aria-label="Coaches and Contributors" data-testid="section-contributors">
      <h2 className="text-lg font-black tracking-tight">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpanded((value) => !value)}
        >
          <span>Coaches &amp; Contributors <span className="text-sm font-medium text-muted-foreground">({data.length})</span></span>
          <ChevronDown aria-hidden="true" className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
      </h2>
      <p className="text-xs text-muted-foreground mt-0.5">Career achievements shared publicly by people who write for this organization's teams. Listed alphabetically.</p>
      <div id={contentId} hidden={!expanded}>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {data.map((c) => {
          const best = bestAwards(c.awards);
          const keys = [...new Set(c.featured)].filter((k) => best.has(k));
          return (
            <li key={c.id} className="rounded-lg border p-3 min-w-0" data-testid={`contributor-${c.id}`}>
              <Link href={`/users/${c.id}`} className="font-bold text-sm hover:underline block truncate">{c.name}</Link>
              <p className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground">{c.role}</p>
              <div className="text-xs flex flex-wrap gap-2">{c.teams.map((t) => <Link key={t.id} className="underline" href={`/teams/${t.id}`}>{t.name}</Link>)}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {keys.map((k) => (
                  <span key={k} className="flex items-center gap-1.5 text-[11px] font-semibold">
                    <CrestBadge name={NAMES[k] ?? k} tier={k === "first-story" ? undefined : best.get(k)!.tier} size={30} />
                    <span>{NAMES[k] ?? k}{k !== "first-story" && ` · ${TIER_LABEL[best.get(k)!.tier]} · ${best.get(k)!.threshold}`} <span className="text-muted-foreground">(career)</span></span>
                  </span>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
      </div>
    </section>
  );
}
