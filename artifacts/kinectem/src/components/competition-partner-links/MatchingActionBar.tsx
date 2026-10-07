import { useLayoutEffect, useRef, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import type { CompetitionParticipant } from "@/pages/CompetitionPage";
import { sourceMeta, teamLabel, type TeamOption } from "./model";

export function MatchingActionBar({ active, selected, canUse, onUse, scrollRoot }: {
  active: CompetitionParticipant | null;
  selected: TeamOption | null;
  canUse: boolean;
  onUse: () => void;
  scrollRoot: RefObject<HTMLDivElement | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const bar = ref.current;
    const root = scrollRoot.current;
    if (!bar || !root) return;
    const measure = () => root.style.setProperty("--matching-action-height", `${bar.getBoundingClientRect().height}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--matching-action-height");
    };
  }, [scrollRoot, active?.id, selected?.id]);
  return (
    <div ref={ref}
      className="sticky top-0 z-20 -mx-5 mb-4 border-b bg-background px-5 py-2 shadow-sm"
      data-testid="matching-action-bar" role="group" aria-label="Current schedule assignment">
      <div className="flex flex-wrap items-center gap-2 md:flex-nowrap">
        <div className="min-w-0 flex-1" data-testid={active ? "active-source" : undefined}>
          <p className="text-[11px] text-muted-foreground">Schedule for</p>
          <p className="line-clamp-2 break-words font-bold">{active?.name ?? "Select a competition team"}</p>
          {active && <p className="truncate text-[11px] text-muted-foreground" title={sourceMeta(active)}>{sourceMeta(active)}</p>}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] text-muted-foreground">Team page</p>
          <p className="line-clamp-2 break-words font-bold" data-testid={selected ? "selected-destination" : undefined}
            title={selected ? teamLabel(selected) : undefined}>
            {selected ? teamLabel(selected) : "Choose an existing team page"}
          </p>
        </div>
        <Button className="w-full shrink-0 font-bold md:w-auto" disabled={!canUse} onClick={onUse}
          data-testid="button-use-team">Use this team page</Button>
      </div>
    </div>
  );
}
