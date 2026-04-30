import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  useListPendingTags,
  useApproveTag,
  useDeclineTag,
  getListPendingTagsQueryKey,
  getListFeedQueryKey,
  type TagResponse,
  type PostResponse,
  type PostTaggedUser,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Check, X, Tag as TagIcon, Film, Newspaper } from "lucide-react";
import { timeAgo } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";

export default function PendingTagsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useListPendingTags();
  const items = data?.data ?? [];

  // Update every cached PostResponse for this post in place so the
  // tag's status reflects the user's decision immediately, even if
  // PostPage doesn't refetch on back-nav. We match by query key
  // (`["post", id]` / `["child-post", childId, id]`) and rewrite the
  // taggedUsers entry for this user. For approve we set tagStatus to
  // "approved"; for decline we drop the entry entirely so the user
  // disappears from the rendered list.
  const patchCachedPost = (
    postId: string,
    userId: string,
    op: "approve" | "decline",
  ) => {
    const update = (data: PostResponse | undefined): PostResponse | undefined => {
      if (!data || !data.taggedUsers) return data;
      let changed = false;
      const next: PostTaggedUser[] = [];
      for (const u of data.taggedUsers) {
        if (u.id !== userId) {
          next.push(u);
          continue;
        }
        if (op === "approve") {
          if (u.tagStatus !== "approved") {
            next.push({ ...u, tagStatus: "approved" });
            changed = true;
          } else {
            next.push(u);
          }
        } else {
          // decline: drop this user from the rendered list
          changed = true;
        }
      }
      if (!changed) return data;
      return { ...data, taggedUsers: next };
    };
    qc.setQueriesData<PostResponse>(
      {
        predicate: (query) => {
          const key = query.queryKey;
          if (!Array.isArray(key) || key.length === 0) return false;
          return (
            (key[0] === "post" && key[1] === postId) ||
            (key[0] === "child-post" && key[2] === postId)
          );
        },
      },
      update,
    );
  };

  const invalidateFor = (
    postId: string,
    userId: string,
    op: "approve" | "decline",
  ) => {
    qc.invalidateQueries({ queryKey: getListPendingTagsQueryKey() });
    // Refresh the highlight feed so the pending badge / hidden state
    // updates immediately wherever the tag is rendered.
    qc.invalidateQueries({
      queryKey: getListFeedQueryKey(),
      refetchType: "all",
    });
    // Optimistically update any cached post-detail entries so back-nav
    // shows the correct state immediately, regardless of refetch
    // timing. PostPage uses its own query keys (`["post", id]` and
    // `["child-post", childId, id]`) rather than the generated
    // `getGetPostQueryKey`, so we match via a predicate.
    patchCachedPost(postId, userId, op);
    // Also mark the entries stale so that when PostPage does next
    // refetch (e.g. on a future visit), it picks up the canonical
    // server state.
    qc.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey;
        if (!Array.isArray(key) || key.length === 0) return false;
        return (
          (key[0] === "post" && key[1] === postId) ||
          (key[0] === "child-post" && key[2] === postId)
        );
      },
      refetchType: "all",
    });
  };

  const approve = useApproveTag({
    mutation: {
      onSuccess: (res) => {
        invalidateFor(res.postId, res.taggedEntityId, "approve");
        toast({ title: "Tag approved" });
      },
      onError: () => toast({ title: "Couldn't approve tag", variant: "destructive" }),
    },
  });
  const decline = useDeclineTag({
    mutation: {
      onSuccess: (res) => {
        invalidateFor(res.postId, res.taggedEntityId, "decline");
        toast({ title: "Tag removed" });
      },
      onError: () => toast({ title: "Couldn't remove tag", variant: "destructive" }),
    },
  });

  // Post ids carry a kind prefix from the server (see
  // `articlePostId` / `highlightPostId` / `orgPostPostId` in
  // `spec-helpers.ts`). We use it to label the row with a friendly
  // kind ("Highlight" / "Recap") instead of just the raw id.
  const kindOf = (postId: string): "highlight" | "article" | "unknown" => {
    if (postId.startsWith("highlight-")) return "highlight";
    if (postId.startsWith("article-")) return "article";
    return "unknown";
  };

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-black tracking-tight">Pending Tags</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Approve a tag to make it visible to everyone, or remove it to hide
          it from the feed and post page.
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
        items.map((t: TagResponse) => {
          const kind = kindOf(t.postId);
          const KindIcon = kind === "highlight" ? Film : Newspaper;
          const kindLabel =
            kind === "highlight"
              ? "Highlight"
              : kind === "article"
                ? "Recap"
                : "Post";
          return (
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
                      className="text-[10px] font-bold uppercase tracking-wider gap-1"
                    >
                      <KindIcon className="w-3 h-3" />
                      {kindLabel}
                    </Badge>
                    <Badge
                      variant="outline"
                      className="text-[10px] font-bold uppercase tracking-wider"
                    >
                      {t.taggedEntityType}
                    </Badge>
                  </div>
                  <Link href={`/posts/${t.postId}`}>
                    <p
                      className="font-bold text-sm hover:text-primary cursor-pointer truncate"
                      data-testid={`link-pending-tag-post-${t.id}`}
                    >
                      View {kindLabel.toLowerCase()}
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
                    disabled={decline.isPending || approve.isPending}
                    data-testid={`button-decline-tag-${t.id}`}
                  >
                    <X className="w-3.5 h-3.5" /> Remove
                  </Button>
                  <Button
                    variant="brand"
                    size="sm"
                    className="px-4"
                    onClick={() => approve.mutate({ tagId: t.id })}
                    disabled={approve.isPending || decline.isPending}
                    data-testid={`button-approve-tag-${t.id}`}
                  >
                    <Check className="w-3.5 h-3.5" /> Approve
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
