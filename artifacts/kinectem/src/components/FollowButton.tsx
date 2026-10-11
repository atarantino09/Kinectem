import { UserCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";

export function FollowButton({
  isFollowing,
  followerCount,
  pending,
  onToggle,
  testId,
}: {
  isFollowing: boolean;
  followerCount: number;
  pending: boolean;
  onToggle: () => void;
  testId: string;
}) {
  const countLabel = `${followerCount.toLocaleString()} ${followerCount === 1 ? "follower" : "followers"}`;
  const Icon = isFollowing ? UserCheck : Users;

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="brand-community-trigger max-w-full gap-2 rounded-full font-bold focus-visible:ring-[var(--k-magenta)]"
      aria-pressed={isFollowing}
      aria-label={`${isFollowing ? "Following" : "Follow"} · ${countLabel}`}
      disabled={pending}
      onClick={onToggle}
      data-testid={testId}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      <span>{isFollowing ? "Following" : "Follow"}</span>
      <span className="border-l border-current/20 pl-2 text-xs">{countLabel}</span>
    </Button>
  );
}
