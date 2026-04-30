import { Link } from "wouter";
import { UserAvatar } from "@/components/UserAvatar";
import type { PostTaggedUser } from "@workspace/api-client-react";

type Variant = "card" | "detail";

type Props = {
  taggedUsers: PostTaggedUser[] | undefined;
  postId: string;
  variant?: Variant;
};

export function TaggedPlayers({ taggedUsers, postId, variant = "card" }: Props) {
  if (!taggedUsers || taggedUsers.length === 0) return null;

  if (variant === "detail") {
    return (
      <div
        className="rounded-xl border border-border bg-muted/30 p-4"
        data-testid={`tagged-players-${postId}`}
      >
        <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-3">
          Tagged players
        </div>
        <ul className="flex flex-wrap gap-2">
          {taggedUsers.map((u) => (
            <li key={u.id}>
              <Link
                href={`/users/${u.id}`}
                className="inline-flex items-center gap-2 rounded-full bg-background border border-border px-2 py-1 hover:bg-accent hover:border-accent-foreground/20 transition-colors"
                data-testid={`tagged-player-${postId}-${u.id}`}
              >
                <UserAvatar
                  avatarUrl={u.avatarUrl ?? undefined}
                  displayName={u.displayName}
                  size="xs"
                />
                <span className="text-sm font-semibold pr-1">
                  {u.displayName}
                </span>
                {u.tagStatus === "pending" && (
                  <span
                    className="inline-flex items-center rounded-full bg-amber-100 text-amber-900 border border-amber-300 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                    title="This tag is pending the player's approval and is hidden from other viewers."
                  >
                    Pending
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div
      className="px-5 pb-3 -mt-1 flex flex-wrap items-center gap-x-1 gap-y-1 text-xs text-muted-foreground"
      data-testid={`tagged-players-${postId}`}
    >
      <span className="font-bold uppercase tracking-wide">Tagged:</span>
      {taggedUsers.map((u, i) => (
        <span
          key={u.id}
          className="inline-flex items-center gap-1"
        >
          <Link
            href={`/users/${u.id}`}
            className="inline-flex items-center gap-1 hover:underline"
            data-testid={`tagged-player-${postId}-${u.id}`}
          >
            <UserAvatar
              avatarUrl={u.avatarUrl ?? undefined}
              displayName={u.displayName}
              size="xs"
            />
            <span className="font-semibold text-foreground">
              {u.displayName}
            </span>
          </Link>
          {u.tagStatus === "pending" && (
            <span
              className="inline-flex items-center rounded-full bg-amber-100 text-amber-900 border border-amber-300 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
              title="This tag is pending the player's approval and is hidden from other viewers."
            >
              Pending
            </span>
          )}
          {i < taggedUsers.length - 1 && <span aria-hidden>·</span>}
        </span>
      ))}
    </div>
  );
}
