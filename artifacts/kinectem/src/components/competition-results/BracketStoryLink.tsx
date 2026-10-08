import { Link } from "wouter";
import { usePublicRecaps, storyHref } from "@/lib/competition-results";

// Reciprocal link from a recap post to its bracket story. Shown only when the
// story's published coverage includes this exact post id, so hidden/private
// posts are never linked. The server resolves the bracket association (explicit
// bracketId or exact linked match), so we locate the post in coverage.
export function BracketStoryLink({
  competitionId,
  postId,
}: {
  competitionId?: string | null;
  postId: string;
}) {
  const q = usePublicRecaps(competitionId ?? undefined);
  const story = q.data?.data.find((s) => s.coverage.some((c) => c.id === postId));
  if (!competitionId || !story) return null;
  return (
    <Link
      href={storyHref(story.id)}
      className="block rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm"
      data-testid="link-bracket-story"
    >
      <span className="block text-[11px] font-black uppercase tracking-widest text-muted-foreground">
        Tournament recap
      </span>
      <span className="font-bold">{story.title}</span>
      <span className="text-muted-foreground"> · {story.bracketLabel}</span>
    </Link>
  );
}
