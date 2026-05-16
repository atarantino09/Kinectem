import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListMyFollowRequests,
  useApproveFollowRequest,
  useDeclineFollowRequest,
  getListMyFollowRequestsQueryKey,
  getGetLoggedInUserQueryKey,
} from "@workspace/api-client-react";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

// Task #520 — Adult-only "private account" follow-request inbox.
// Lists pending rows from `user_followers` whose followingUserId is
// the caller. Approve = flip to approved (server). Decline = delete
// the row (server). Both invalidate the list so the row disappears.
export default function FollowRequestsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useListMyFollowRequests();
  const approve = useApproveFollowRequest();
  const decline = useDeclineFollowRequest();
  const items = data?.data ?? [];

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: getListMyFollowRequestsQueryKey() }),
      // Bell-count and whoami header surfaces aren't affected here, but
      // the follow-request notifications kind=`follow_request` lives in
      // the user's bell — invalidate /users/me for safety.
      qc.invalidateQueries({ queryKey: getGetLoggedInUserQueryKey() }),
    ]);
  };

  const onApprove = async (requesterId: string) => {
    try {
      await approve.mutateAsync({ requesterId });
      await invalidate();
    } catch {
      toast({ title: "Couldn't approve request", variant: "destructive" });
    }
  };
  const onDecline = async (requesterId: string) => {
    try {
      await decline.mutateAsync({ requesterId });
      await invalidate();
    } catch {
      toast({ title: "Couldn't decline request", variant: "destructive" });
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      <div>
        <h1 className="text-2xl font-black tracking-tight">
          Follow requests
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          People asking to follow your private account. Approve to let
          them see your posts, decline to remove the request.
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-3" data-testid="follow-requests-loading">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
        </div>
      ) : items.length === 0 ? (
        <Card data-testid="follow-requests-empty">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            No pending requests right now.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2" data-testid="follow-requests-list">
          {items.map((it) => (
            <li key={it.id}>
              <Card>
                <CardContent className="p-3 flex items-center gap-3">
                  <Link
                    href={`/users/${it.id}`}
                    className="flex items-center gap-3 flex-1 min-w-0"
                  >
                    <UserAvatar
                      avatarUrl={it.avatarUrl}
                      displayName={it.displayName}
                      size="md"
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        className="font-bold text-sm truncate"
                        data-testid={`follow-request-name-${it.id}`}
                      >
                        {it.displayName}
                      </p>
                      {it.bio && (
                        <p className="text-xs text-muted-foreground truncate">
                          {it.bio}
                        </p>
                      )}
                    </div>
                  </Link>
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      className="font-bold rounded-full"
                      onClick={() => onDecline(it.id)}
                      disabled={
                        approve.isPending || decline.isPending
                      }
                      data-testid={`btn-follow-request-decline-${it.id}`}
                    >
                      Decline
                    </Button>
                    <Button
                      size="sm"
                      variant="brand"
                      className="font-bold rounded-full"
                      onClick={() => onApprove(it.id)}
                      disabled={
                        approve.isPending || decline.isPending
                      }
                      data-testid={`btn-follow-request-approve-${it.id}`}
                    >
                      Approve
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
