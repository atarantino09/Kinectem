import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  useListOrgJoinRequests,
  useApproveOrgJoinRequest,
  useDeclineOrgJoinRequest,
  useListOrgPostApprovals,
  useApproveOrgPostApproval,
  useDeclineOrgPostApproval,
  getListOrgJoinRequestsQueryKey,
  getListOrgPostApprovalsQueryKey,
  getListFeedQueryKey,
  type JoinRequestResponse,
  type PostApprovalResponse,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, X, Shield } from "lucide-react";
import { timeAgo } from "@/lib/format";

export function OrgAdminPanel({ orgId }: { orgId: string }) {
  const qc = useQueryClient();
  const { data: jrResp } = useListOrgJoinRequests(orgId);
  const { data: paResp } = useListOrgPostApprovals(orgId);

  const requests = jrResp?.data ?? [];
  const approvals = paResp?.data ?? [];

  const invalidateJR = () =>
    qc.invalidateQueries({ queryKey: getListOrgJoinRequestsQueryKey(orgId) });
  const invalidatePA = () => {
    qc.invalidateQueries({ queryKey: getListOrgPostApprovalsQueryKey(orgId) });
    qc.invalidateQueries({ queryKey: getListFeedQueryKey() });
  };

  const approveJR = useApproveOrgJoinRequest({
    mutation: { onSuccess: invalidateJR },
  });
  const declineJR = useDeclineOrgJoinRequest({
    mutation: { onSuccess: invalidateJR },
  });
  const approvePA = useApproveOrgPostApproval({
    mutation: { onSuccess: invalidatePA },
  });
  const declinePA = useDeclineOrgPostApproval({
    mutation: { onSuccess: invalidatePA },
  });

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Shield className="w-4 h-4 text-primary" />
        <h2 className="text-xl font-black tracking-tight">Admin Queue</h2>
      </div>

      <Card className="rounded-xl border border-border">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-black tracking-tight text-sm">
              Join Requests
            </h3>
            <Badge variant="secondary" className="text-[10px] font-bold">
              {requests.length}
            </Badge>
          </div>
          {requests.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">
              No pending join requests.
            </p>
          ) : (
            <div className="space-y-2">
              {requests.map((r: JoinRequestResponse) => (
                <div
                  key={r.id}
                  className="flex items-center gap-3 p-2 rounded-lg bg-muted/40"
                  data-testid={`join-request-${r.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <Link href={`/users/${r.userId}`}>
                      <p className="font-bold text-sm hover:text-primary cursor-pointer truncate">
                        {r.user?.displayName ?? r.userId.slice(0, 8)}
                      </p>
                    </Link>
                    <p className="text-[11px] text-muted-foreground">
                      Requested {timeAgo(r.createdAt)}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="font-bold h-8 gap-1"
                      onClick={() =>
                        declineJR.mutate({ orgId, requestId: r.id })
                      }
                      disabled={declineJR.isPending}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                    <Button
                      size="sm"
                      className="brand-gradient hover:opacity-90 text-white font-bold rounded-full h-8 px-3 gap-1"
                      onClick={() =>
                        approveJR.mutate({ orgId, requestId: r.id, data: {} })
                      }
                      disabled={approveJR.isPending}
                    >
                      <Check className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-xl border border-border">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-black tracking-tight text-sm">
              Post Approvals
            </h3>
            <Badge variant="secondary" className="text-[10px] font-bold">
              {approvals.length}
            </Badge>
          </div>
          {approvals.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">
              No posts waiting for approval.
            </p>
          ) : (
            <div className="space-y-2">
              {approvals.map((a: PostApprovalResponse) => (
                <div
                  key={a.id}
                  className="flex items-center gap-3 p-2 rounded-lg bg-muted/40"
                  data-testid={`post-approval-${a.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <Link href={`/posts/${a.postId}`}>
                      <p className="font-bold text-sm hover:text-primary cursor-pointer truncate">
                        {a.post?.title ?? `Post ${a.postId.slice(0, 8)}…`}
                      </p>
                    </Link>
                    <p className="text-[11px] text-muted-foreground">
                      Submitted {timeAgo(a.createdAt)}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="font-bold h-8 gap-1"
                      onClick={() =>
                        declinePA.mutate({ orgId, approvalId: a.id })
                      }
                      disabled={declinePA.isPending}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                    <Button
                      size="sm"
                      className="brand-gradient hover:opacity-90 text-white font-bold rounded-full h-8 px-3 gap-1"
                      onClick={() =>
                        approvePA.mutate({ orgId, approvalId: a.id })
                      }
                      disabled={approvePA.isPending}
                    >
                      <Check className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
