import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Star toggle for pinning a team to the top of the viewer's own team lists.
 * Rendered inside a clickable team card (wrapped in a wouter <Link>), so it
 * stops click propagation + default navigation.
 */
export function PinTeamButton({
  teamId,
  pinned,
  onToggle,
  className,
}: {
  teamId: string;
  pinned: boolean;
  onToggle: (teamId: string) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle(teamId);
      }}
      aria-label={pinned ? "Unpin team" : "Pin team"}
      aria-pressed={pinned}
      title={pinned ? "Unpin from top" : "Pin to top"}
      className={cn(
        "shrink-0 rounded-full p-1.5 transition-colors hover:bg-muted/60",
        pinned ? "text-amber-500" : "text-muted-foreground/60 hover:text-foreground",
        className,
      )}
      data-testid={`btn-pin-team-${teamId}`}
    >
      <Star className={cn("w-4 h-4", pinned && "fill-current")} />
    </button>
  );
}

/**
 * Labeled hairline separator used to split the pinned group from the rest.
 */
export function PinnedSectionLabel({
  label,
  showStar = false,
  testId,
}: {
  label: string;
  showStar?: boolean;
  testId?: string;
}) {
  return (
    <div className="flex items-center gap-2 px-1 pt-1" data-testid={testId}>
      {showStar && (
        <Star className="w-3 h-3 text-amber-500 fill-current shrink-0" />
      )}
      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground shrink-0">
        {label}
      </span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}
