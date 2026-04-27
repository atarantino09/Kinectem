import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  useListPendingTags,
  useApproveTag,
  useDeclineTag,
  getListPendingTagsQueryKey,
  type TagResponse,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Check, X, Tag as TagIcon } from "lucide-react";
import { timeAgo } from "@/lib/format";

export default function PendingTagsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useListPendingTags();
  const items = data?.data ?? [];

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: getListPendingTagsQueryKey() });

  const approve = useApproveTag({ mutation: { onSuccess: invalidate } });
  const decline = useDeclineTag({ mutation: { onSuccess: invalidate } });

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-black tracking-tight">Pending Tags</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Approve or decline tags placed on you by others.
        </p>
      </div>

      {isLoading ? (
        <Skeleton className="h-32 rounded-xl" />
      ) : items.length === 0 ? (
        <Card className="rounded-xl border border-border">
          <CardContent className="p-8 text-center">
            <TagIcon className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              No pending tags. You're all caught up.
            </p>
          </CardContent>
        </Card>
      ) : (
        items.map((t: TagResponse) => (
          <Card
            key={t.id}
            className="rounded-xl border border-border"
            data-testid={`tag-${t.id}`}
          >
            <CardContent className="p-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Badge
                    variant="secondary"
                    className="text-[10px] font-bold uppercase tracking-wider"
                  >
                    {t.direction}
                  </Badge>
                  <Badge
                    variant="outline"
                    className="text-[10px] font-bold uppercase tracking-wider"
                  >
                    {t.taggedEntityType}
                  </Badge>
                </div>
                <Link href={`/posts/${t.postId}`}>
                  <p className="font-bold text-sm hover:text-primary cursor-pointer truncate">
                    Post {t.postId.slice(0, 8)}…
                  </p>
                </Link>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Tagged {timeAgo(t.createdAt)}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  className="font-bold gap-1"
                  onClick={() => decline.mutate({ tagId: t.id })}
                  disabled={decline.isPending}
                  data-testid={`button-decline-tag-${t.id}`}
                >
                  <X className="w-3.5 h-3.5" /> Decline
                </Button>
                <Button
                  size="sm"
                  className="brand-gradient hover:opacity-90 text-white font-bold rounded-full px-4 gap-1"
                  onClick={() => approve.mutate({ tagId: t.id })}
                  disabled={approve.isPending}
                  data-testid={`button-approve-tag-${t.id}`}
                >
                  <Check className="w-3.5 h-3.5" /> Approve
                </Button>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
