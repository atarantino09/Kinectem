import { useState } from "react";
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
  getListOrgPostsQueryKey,
  getListFeedQueryKey,
  getListMembersQueryKey,
  getGetOrganizationByIdQueryKey,
  type JoinRequestResponse,
  type PostApprovalResponse,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Check, X, Shield } from "lucide-react";
import { timeAgo } from "@/lib/format";

export function OrgAdminPanel({ orgId }: { orgId: string }) {
  const qc = useQueryClient();
  const [approvedDialogOpen, setApprovedDialogOpen] = useState(false);
  const { data: jrResp } = useListOrgJoinRequests(orgId);
  const { data: paResp } = useListOrgPostApprovals(orgId);

  const requests = jrResp?.data ?? [];
  const approvals = paResp?.data ?? [];

  const invalidateJR = () => {
    qc.invalidateQueries({ queryKey: getListOrgJoinRequestsQueryKey(orgId) });
    qc.invalidateQueries({ queryKey: getListMembersQueryKey(orgId) });
    qc.invalidateQueries({ queryKey: getGetOrganizationByIdQueryKey(orgId) });
  };
  const invalidatePA = () => {
    qc.invalidateQueries({ queryKey: getListOrgPostApprovalsQueryKey(orgId) });
    qc.invalidateQueries({ queryKey: getListOrgPostsQueryKey(orgId) });
    qc.invalidateQueries({ queryKey: getListFeedQueryKey() });
  };

  const approveJR = useApproveOrgJoinRequest({
    mutation: { onSuccess: invalidateJR },
  });
  const declineJR = useDeclineOrgJoinRequest({
    mutation: { onSuccess: invalidateJR },
  });
  const approvePA = useApproveOrgPostApproval({
    mutation: {
      onSuccess: () => {
        invalidatePA();
        setApprovedDialogOpen(true);
      },
    },
  });
  const declinePA = useDeclineOrgPostApproval({
    mutation: { onSuccess: invalidatePA },
  });

  return (
    <>
    <Dialog open={approvedDialogOpen} onOpenChange={setApprovedDialogOpen}>
      <DialogContent
        className="sm:max-w-md"
        data-testid="dialog-recap-approved"
      >
        <DialogHeader>
          <DialogTitle className="font-black tracking-tight">
            Recap approved
          </DialogTitle>
          <DialogDescription>
            This article will now appear on the team page and the
            organization page.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="brand"
            onClick={() => setApprovedDialogOpen(false)}
            data-testid="btn-recap-approved-dismiss"
          >
            OK
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
                  className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 p-2 rounded-lg bg-muted/40"
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
                  <div className="flex gap-1 self-end sm:self-auto shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      className="font-bold h-8 gap-1"
                      onClick={() =>
                        declineJR.mutate({ orgId, requestId: r.id })
                      }
                      disabled={declineJR.isPending}
                      data-testid={`btn-decline-join-${r.id}`}
                      title="Decline"
                    >
                      <X className="w-3 h-3" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="font-bold px-3 h-8"
                      onClick={() =>
                        approveJR.mutate({
                          orgId,
                          requestId: r.id,
                          data: { role: "member" },
                        })
                      }
                      disabled={approveJR.isPending}
                      data-testid={`btn-approve-member-${r.id}`}
                      title="Approve as member"
                    >
                      <Check className="w-3 h-3 mr-1" />
                      Member
                    </Button>
                    <Button
                      variant="brand"
                      size="sm"
                      className="font-bold px-3 h-8"
                      onClick={() =>
                        approveJR.mutate({
                          orgId,
                          requestId: r.id,
                          data: { role: "admin" },
                        })
                      }
                      disabled={approveJR.isPending}
                      data-testid={`btn-approve-admin-${r.id}`}
                      title="Approve as admin"
                    >
                      <Check className="w-3 h-3 mr-1" />
                      Admin
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
              {approvals.map((a: PostApprovalResponse) => {
                // Show a quick excerpt of the recap body so admins can
                // triage without clicking through. Fall back to the
                // description when the body is empty. Whitespace is
                // collapsed so multi-line drafts don't push the row
                // open. The truncated CSS keeps it to one visible line;
                // the "Read more" affordance routes the admin to the
                // post page when there's any preview text at all (we
                // can't reliably detect overflow without measuring).
                const previewSource =
                  (a.post?.body && a.post.body.trim().length > 0
                    ? a.post.body
                    : a.post?.description) ?? "";
                const preview = previewSource.replace(/\s+/g, " ").trim();
                return (
                <div
                  key={a.id}
                  className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-3 p-2 rounded-lg bg-muted/40"
                  data-testid={`post-approval-${a.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <Link href={`/posts/${a.postId}`}>
                      <p className="font-bold text-sm hover:text-primary cursor-pointer truncate">
                        {a.post?.title ?? `Post ${a.postId.slice(0, 8)}…`}
                      </p>
                    </Link>
                    {preview && (
                      <p
                        className="text-xs text-muted-foreground truncate mt-0.5"
                        data-testid={`text-post-approval-preview-${a.id}`}
                      >
                        {preview}
                      </p>
                    )}
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Submitted {timeAgo(a.createdAt)}
                      {preview && (
                        <>
                          {" · "}
                          <Link
                            href={`/posts/${a.postId}`}
                            className="font-bold text-foreground hover:underline"
                            data-testid={`link-post-approval-readmore-${a.id}`}
                          >
                            Read more
                          </Link>
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex gap-1 self-end sm:self-auto shrink-0">
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
                      variant="brand"
                      size="sm"
                      className="px-3 gap-1"
                      onClick={() =>
                        approvePA.mutate({ orgId, approvalId: a.id })
                      }
                      disabled={approvePA.isPending}
                    >
                      <Check className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
    </>
  );
}
