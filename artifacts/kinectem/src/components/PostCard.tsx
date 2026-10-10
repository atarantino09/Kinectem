import { memo, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { NumericBadge } from "@/components/ui/numeric-badge";
import { TeamAvatar } from "@/components/UserAvatar";
import { OrgLogo } from "@/components/OrgLogoFallback";
import { Button } from "@/components/ui/button";
import { Play, FileText, Heart, MessageSquare, MoreVertical, Flag, Pencil, Share2, Repeat2, UserMinus, Camera, Trophy, ChevronRight, Medal, ImageDown, Newspaper, ExternalLink, Trash2 } from "lucide-react";
import { ShareRecapImageDialog } from "@/components/share-image/ShareRecapImageDialog";
import { VideoEmbed, getEmbedSrc } from "@/components/VideoEmbed";
import {
  customFetch,
  useAddPostReaction,
  useRemovePostReaction,
  useSharePost,
  useUnsharePost,
  getListFeedQueryKey,
  getGetPostQueryKey,
  type PostResponse,
  type FeedPost,
} from "@workspace/api-client-react";
import { timeAgo, formatDate, formatDateUTC, formatOrgName } from "@/lib/format";
import { OrgPostLogo } from "@/components/OrgPostLogo";
import { FitText } from "@/components/FitText";
import { readRecapOrgIdentity } from "@/lib/recapOrgBrand";
import { linkify } from "@/lib/linkify";
import {
  renderBodyWithMentions,
  truncateMentionSafe,
} from "@/lib/mentions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ReportDialog, type ReportContentType } from "@/components/ReportDialog";
import { TakedownDialog } from "@/components/TakedownDialog";
import { apiErrorMessage } from "@/lib/api-errors";
import { cn } from "@/lib/utils";
import { AvatarLightbox } from "@/components/AvatarLightbox";
import { PhotoLightbox } from "@/components/PhotoLightbox";
import { ShareConfirmDialog } from "@/components/ShareConfirmDialog";
import { TaggedPlayers } from "@/components/TaggedPlayers";
import { useToast } from "@/hooks/use-toast";
import { NewsGameDateDialog } from "@/components/NewsGameDateDialog";
import { ClippingViewer } from "@/components/historical/ClippingViewer";
import {
  getHistorical,
  historicalDateLabel,
  historicalEditHref,
  historicalSourceLine,
} from "@/lib/historical";

function getContextHref(context: {
  type: "team" | "organization" | "user";
  id: string;
}): string {
  switch (context.type) {
    case "team":
      return `/teams/${context.id}`;
    case "organization":
      return `/organizations/${context.id}`;
    case "user":
      return `/users/${context.id}`;
  }
}

function parseSyntheticPostId(
  id: string,
): { contentType: ReportContentType; contentId: string } {
  if (id.startsWith("article-")) {
    return { contentType: "article", contentId: id.slice("article-".length) };
  }
  if (id.startsWith("highlight-")) {
    return { contentType: "highlight", contentId: id.slice("highlight-".length) };
  }
  if (id.startsWith("orgpost-")) {
    return { contentType: "org_post", contentId: id.slice("orgpost-".length) };
  }
  return { contentType: "article", contentId: id };
}

function PostCardImpl({ post }: { post: PostResponse | FeedPost }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [currentPath, setLocation] = useLocation();
  const [reportOpen, setReportOpen] = useState(false);
  // Task #367 — when a guardian is browsing in child-preview mode
  // (URL carries `?asChild=<uuid>` from server-generated deep-links
  // such as parent-inbox / article-tagging notifications, or the
  // legacy `?asChildId=<uuid>` form), expose the "Report photo of
  // my child" action right on each feed card so they don't have to
  // click into the post first. The same action is also rendered on
  // PostPage as a top-level button.
  const search = useSearch();
  const asChildId = (() => {
    const p = new URLSearchParams(search);
    const v = p.get("asChild") ?? p.get("asChildId");
    return v && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
  })();
  const [reportingPhoto, setReportingPhoto] = useState(false);
  const [takedownOpen, setTakedownOpen] = useState(false);
  const submitTakedown = async (reason: string | null) => {
    if (!asChildId) return;
    setReportingPhoto(true);
    try {
      await customFetch(
        `/api/v1/guardians/children/${asChildId}/takedown-request`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            postId: `${reportTarget.contentType}:${reportTarget.contentId}`,
            ...(reason ? { reason } : {}),
          }),
        },
      );
      toast({
        title: "Takedown requested",
        description:
          "We've notified moderators. The post is hidden from public feeds while we review it.",
      });
      qc.invalidateQueries({ queryKey: getListFeedQueryKey() });
      setTakedownOpen(false);
    } catch (err) {
      toast({
        title: "Couldn't submit takedown",
        description:
          apiErrorMessage(err) ??
          "Something went wrong filing the takedown request.",
        variant: "destructive",
      });
    } finally {
      setReportingPhoto(false);
    }
  };
  const [confirmShareOpen, setConfirmShareOpen] = useState(false);
  // Task #863 follow-up — "Share as image" straight from feed cards, so
  // users don't have to open the recap first. Same gate as the recap
  // page: PUBLISHED game recaps only (articleStatus is the extra-spec
  // publication-state field; drafts/pending/hidden/guardian-preview
  // never expose the exporter).
  const [shareImageOpen, setShareImageOpen] = useState(false);
  const [untagOpen, setUntagOpen] = useState(false);
  const [untagging, setUntagging] = useState(false);
  const isShort = post.postType === "short";
  // "In the News" — a newspaper-article link a coach attached to the team
  // page. Read-only card: no reactions/comments/shares/detail page; the
  // card links OUT to the paper. `newsLink` is the extra-spec block the
  // server serializes only for `news-` posts.
  const newsLink = (
    post as { newsLink?: { url: string; sourceName: string | null } | null }
  ).newsLink;
  const isNews = post.id.startsWith("news-") && !!newsLink;
  const [confirmNewsDelete, setConfirmNewsDelete] = useState(false);
  const [confirmHistoricalDelete, setConfirmHistoricalDelete] = useState(false);
  const [deletingHistorical, setDeletingHistorical] = useState(false);
  const [historicalDeleted, setHistoricalDeleted] = useState(false);
  const [editNewsGameDateOpen, setEditNewsGameDateOpen] = useState(false);
  const [deletingNews, setDeletingNews] = useState(false);
  const deleteNewsLink = async () => {
    setDeletingNews(true);
    try {
      await customFetch(
        `/api/v1/teams/${post.context.id}/news/${post.id.slice("news-".length)}`,
        { method: "DELETE" },
      );
      toast({ title: "News article removed" });
      qc.invalidateQueries({ queryKey: getListFeedQueryKey() });
      qc.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) &&
          typeof q.queryKey[0] === "string" &&
          q.queryKey[0].includes(`/teams/${post.context.id}/posts`),
      });
      setConfirmNewsDelete(false);
    } catch (err) {
      toast({
        title: "Couldn't remove the article",
        description: apiErrorMessage(err) ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setDeletingNews(false);
    }
  };
  const canShareAsImage =
    !isShort &&
    !asChildId &&
    (post as { articleStatus?: string | null }).articleStatus ===
      "published" &&
    !(post as { hidden?: boolean }).hidden;
  // Extra server field beyond the locked spec (same precedent as
  // `recapKind`): number of photo/video items in the post's team album.
  const albumPhotoCount =
    (post as PostResponse & { albumPhotoCount?: number }).albumPhotoCount ?? 0;
  const Icon = isNews ? Newspaper : isShort ? Play : FileText;
  const reportTarget = parseSyntheticPostId(post.id);
  const isGameRecap = !isNews && !isShort && reportTarget.contentType === "article";
  // Task #524 — only surface the takedown affordance on posts where the
  // selected child has a plausible client-visible link: child is the
  // author, OR child is tagged on this article/highlight (the child-
  // scoped fetch sets `currentUserTag` to the child's tag). The server
  // is still the source of truth — roster-only org_post links that
  // aren't visible client-side will simply not render the action here;
  // an admin or the guardian can still file via the post detail page
  // when the relationship is detectable.
  const childPlausiblyLinked =
    !!asChildId &&
    (post.author.id === asChildId || !!post.currentUserTag);
  // The composer at /posts/new is kind-aware: it loads and PATCHes
  // recap articles, highlights, and org_post Updates. The server
  // populates `canEdit` per-viewer for all three kinds (author /
  // co-author / org-admin for articles, uploader for highlights,
  // author or org-admin for Updates), so the menu item just mirrors
  // that flag — no client-side kind gate.
  const canEditPost = post.canEdit === true;
  // Combined season/tournament recaps (woven from many game recaps) are
  // article-backed long posts carrying a `recapKind` marker the server
  // serializes outside the openapi PostResponse — read it via a narrow
  // cast (Newsletter/org-claim precedent) to show a distinct pill.
  const isCombinedRecap =
    (post as { recapKind?: string | null }).recapKind === "combined";
  // Competition-linked recaps carry a branding block the server
  // serializes outside the openapi PostResponse (recapKind precedent).
  // Drives the branded strip at the top of the card + the link to the
  // in-app competition page.
  const competition = (
    post as {
      competition?: {
        id: string;
        slug: string;
        name: string;
        logoUrl: string | null;
        brandColor: string | null;
        secondaryColor: string | null;
      } | null;
    }
  ).competition;
  // Medal marker for recaps a competition operator featured on the
  // competition's public rail (extra field beyond the locked spec).
  const competitionFeatured =
    (post as { competitionFeatured?: boolean }).competitionFeatured === true;
  const historical = getHistorical(post);
  const isHistorical = !!historical && !isNews && !isShort;
  // Historical editing is restricted to the author and scoped managers.
  // Direct organization history may omit the legacy article-only canDelete
  // field; its server-provided canEdit capability covers the same actors.
  const canDeleteHistorical =
    isHistorical && !(post as { hidden?: boolean }).hidden &&
    (post.canDelete === true || canEditPost);
  const deleteHistorical = async () => {
    if (deletingHistorical) return;
    setDeletingHistorical(true);
    try {
      await customFetch(`/api/v1/posts/${encodeURIComponent(post.id)}`, { method: "DELETE" });
      setConfirmHistoricalDelete(false);
      setHistoricalDeleted(true);
      toast({ title: "Historical recap deleted" });
      void qc.invalidateQueries({
        predicate: (q) =>
          typeof q.queryKey[0] === "string" &&
          /^\/api\/v1\/(feed|posts|drafts|users|teams|organizations)(\/|$|\?)/.test(q.queryKey[0]),
      });
      if (currentPath === `/posts/${post.id}`) {
        setLocation(getContextHref(post.context));
      }
    } catch (err) {
      toast({
        title: "Couldn't delete the historical recap",
        description: apiErrorMessage(err) ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setDeletingHistorical(false);
    }
  };
  const label = isHistorical
    ? "Historical Recap"
    : isNews
    ? "In the News"
    : reportTarget.contentType === "highlight"
      ? "Highlight"
      : reportTarget.contentType === "org_post"
        ? "Update"
        : isCombinedRecap
          ? "Combined Recap"
          : "Game Recap";
  const badgeClass = isHistorical ? "historical-badge" : "brand-pill";

  const firstImage = post.assets?.find((a) => a.fileType?.startsWith("image/"));
  const allImages = (post.assets ?? []).filter((a) =>
    a.fileType?.startsWith("image/"),
  );
  const videoAsset = (post.assets ?? []).find((a) =>
    a.fileType?.startsWith("video/"),
  );
  // True only when we can render an inline iframe player. For
  // unknown providers we still surface the URL, but as a clickable
  // link below the body rather than as a tall blank player area.
  const hasEmbeddableVideo =
    !!videoAsset?.url && getEmbedSrc(videoAsset.url) !== null;

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: getListFeedQueryKey() });
  const addReaction = useAddPostReaction({
    mutation: { onSuccess: invalidate },
  });
  const removeReaction = useRemovePostReaction({
    mutation: { onSuccess: invalidate },
  });
  const invalidateShareSurfaces = () => {
    invalidate();
    qc.invalidateQueries({
      predicate: (q) =>
        Array.isArray(q.queryKey) &&
        typeof q.queryKey[0] === "string" &&
        (q.queryKey[0].startsWith("/api/v1/users/") ||
          (isHistorical && /^\/api\/v1\/(teams|organizations)\//.test(q.queryKey[0]))) &&
        q.queryKey[0].endsWith("/posts"),
    });
    qc.invalidateQueries({ queryKey: getGetPostQueryKey(post.id) });
  };
  type ListSnapshot = { key: readonly unknown[]; data: unknown }[];
  const optimisticShareToggleInLists = (next: boolean): ListSnapshot => {
    const snapshot: ListSnapshot = [];
    qc
      .getQueryCache()
      .findAll({
        predicate: (q) => {
          const k = q.queryKey;
          if (!Array.isArray(k) || typeof k[0] !== "string") return false;
          if (k[0] === "/api/v1/feed") return true;
          return k[0].startsWith("/api/v1/users/") && k[0].endsWith("/posts");
        },
      })
      .forEach((q) => {
        const data = q.state.data as
          | { data?: Array<{ id: string; hasShared?: boolean; shareCount?: number }> }
          | undefined;
        if (!data?.data) return;
        snapshot.push({ key: q.queryKey, data: q.state.data });
        qc.setQueryData(q.queryKey, {
          ...data,
          data: data.data.map((p) =>
            p.id === post.id
              ? {
                  ...p,
                  hasShared: next,
                  shareCount: Math.max(
                    0,
                    (p.shareCount ?? 0) + (next ? 1 : -1),
                  ),
                }
              : p,
          ),
        });
      });
    return snapshot;
  };
  const onShareError = (snapshot: ListSnapshot, action: string) => {
    snapshot.forEach((s) => qc.setQueryData(s.key, s.data));
    toast({
      title: `Couldn't ${action} this ${shareKindLabel}`,
      description: "Please try again in a moment.",
      variant: "destructive",
    });
  };
  const sharePost = useSharePost({
    mutation: {
      onMutate: () => ({ snapshot: optimisticShareToggleInLists(true) }),
      onError: (_e, _v, ctx) =>
        onShareError((ctx?.snapshot as ListSnapshot) ?? [], "share"),
      onSuccess: invalidateShareSurfaces,
    },
  });
  const unsharePost = useUnsharePost({
    mutation: {
      onMutate: () => ({ snapshot: optimisticShareToggleInLists(false) }),
      onError: (_e, _v, ctx) =>
        onShareError((ctx?.snapshot as ListSnapshot) ?? [], "unshare"),
      onSuccess: invalidateShareSurfaces,
    },
  });

  const onToggleReaction = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (post.hasReacted) {
      removeReaction.mutate({ postId: post.id });
    } else {
      addReaction.mutate({ postId: post.id, data: { reactionType: "like" } });
    }
  };

  // Historical recaps in either scope do not need a current gameDate.
  // Ordinary organization Updates and free-form articles remain unshareable.
  const isShareable =
    (post.id.startsWith("article-") &&
      post.postType === "long" &&
      (!!post.gameDate || isHistorical)) ||
    (post.id.startsWith("orgpost-") && isHistorical) ||
    post.id.startsWith("highlight-") ||
    // Task #867 — news posts are shareable too.
    post.id.startsWith("news-");
  const shareKindLabel: "highlight" | "recap" | "news article" =
    post.id.startsWith("highlight-")
      ? "highlight"
      : post.id.startsWith("news-")
        ? "news article"
        : "recap";
  const onToggleShare = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (post.hasShared) {
      unsharePost.mutate({ postId: post.id });
    } else {
      setConfirmShareOpen(true);
    }
  };
  const onConfirmShare = () => {
    setConfirmShareOpen(false);
    sharePost.mutate({ postId: post.id });
  };

  const sharedBy = "sharedBy" in post ? post.sharedBy : null;

  // Every org-associated post uses the same original identity header.
  // Context determines the owning org; post type does not change branding.
  const postOrgIdentity = readRecapOrgIdentity(post.context);

  if (historicalDeleted) return null;

  return (
    <Card
      className={cn(
        "app-surface app-surface-interactive overflow-hidden",
        isHistorical && "historical-card",
        isCombinedRecap &&
          "bg-gradient-to-br from-purple-50 to-violet-100/60 dark:from-purple-950/30 dark:to-violet-900/20",
        // News cards get a light brand-blue tint (matches --brand-blue /
        // --primary, hsl 217 91% 60% ≈ Tailwind blue-500 family) so they
        // stand out from regular and combined recaps.
        isNews &&
          "bg-gradient-to-br from-blue-100 to-blue-200/60 dark:from-blue-950/40 dark:to-blue-900/30",
      )}
    >
      <CardContent className="p-0">
        {sharedBy && (
          <Link
            href={`/users/${sharedBy.id}`}
            className="block px-5 pt-3 pb-1 text-[11px] font-bold text-muted-foreground uppercase tracking-wider hover:text-primary"
            data-testid={`label-shared-by-${post.id}`}
          >
            <Repeat2 className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
            Shared by {sharedBy.displayName}
          </Link>
        )}
        {competition && (
          <Link
            href={`/competitions/c/${encodeURIComponent(competition.slug)}`}
            className="flex items-center gap-2.5 px-5 py-2"
            style={{
              background: competition.brandColor
                ? competition.secondaryColor
                  ? `linear-gradient(135deg, ${competition.brandColor} 0%, ${competition.brandColor} 60%, ${competition.secondaryColor} 100%)`
                  : competition.brandColor
                : "hsl(var(--primary))",
            }}
            data-testid={`banner-post-competition-${post.id}`}
          >
            {competition.logoUrl ? (
              <img
                src={competition.logoUrl}
                alt=""
                className="h-6 w-6 rounded bg-white/90 object-contain p-0.5 shrink-0"
              />
            ) : (
              <Trophy className="h-4 w-4 shrink-0 text-white/90" />
            )}
            <span className="min-w-0 truncate text-xs font-black uppercase tracking-widest text-white drop-shadow-sm">
              {competition.name}
            </span>
            <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-white/80" />
          </Link>
        )}
        <div
          className={cn(
            "relative px-5 flex flex-col items-stretch gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-0 border-b border-border/60",
            postOrgIdentity ? "pt-2 pb-3 sm:py-3 [&_.text-muted-foreground]:text-inherit" : "pt-3 pb-4 sm:py-4",
          )}
          style={postOrgIdentity ? {
            ...postOrgIdentity.style,
            borderBottom: `4px solid ${postOrgIdentity.accent}`,
          } : undefined}
          data-testid={`post-header-${post.id}`}
        >
          <div
            className="order-2 flex w-full items-center gap-3 min-w-0 sm:order-1 sm:w-auto"
            data-testid={`post-header-identity-${post.id}`}
          >
            {(() => {
              // For team-context posts, the avatar slot shows the parent
              // organization's logo instead of the team's own logo so it
              // never renders as a blank initials tile when only the team
              // is missing a logo. If the parent org has no logo either,
              // we intentionally fall straight through to the team-name
              // initials (the existing TeamAvatar fallback) — we do NOT
              // use the team's own logoUrl in this branch. Non-team
              // contexts keep their existing avatar source.
              const displayedAvatarUrl =
                post.context.type === "team"
                  ? ("orgAvatarUrl" in post.context
                      ? post.context.orgAvatarUrl ?? null
                      : null)
                  : post.context.avatarUrl;
              const isOrgAvatar =
                post.context.type === "organization" ||
                post.context.type === "team";
              return (
                <AvatarLightbox
                  avatarUrl={displayedAvatarUrl}
                  displayName={post.context.name ?? post.context.type}
                  triggerClassName="shrink-0 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  triggerTestId={`btn-open-post-avatar-lightbox-${post.id}`}
                  dialogTestId={`dialog-post-avatar-lightbox-${post.id}`}
                  imageTestId={`img-post-avatar-lightbox-${post.id}`}
                >
                  {postOrgIdentity ? (
                    <OrgPostLogo org={postOrgIdentity} postId={post.id} />
                  ) : isOrgAvatar ? (
                    <OrgLogo
                      logoUrl={displayedAvatarUrl}
                      name={post.context.name ?? "Organization"}
                      className={`w-10 h-10 rounded-lg shrink-0 ${
                        displayedAvatarUrl ? "cursor-pointer" : ""
                      }`}
                      imgClassName={`w-10 h-10 rounded-lg object-contain bg-muted shrink-0 ${
                        displayedAvatarUrl ? "cursor-pointer" : ""
                      }`}
                    />
                  ) : (
                    <TeamAvatar
                      avatarUrl={displayedAvatarUrl}
                      displayName={post.context.name ?? post.context.type}
                      size="lg"
                      className={`shrink-0 ${displayedAvatarUrl ? "cursor-pointer" : ""}`}
                      fallbackClassName="bg-slate-900 text-primary-foreground font-black"
                    />
                  )}
                </AvatarLightbox>
              );
            })()}
            <div className="min-w-0 flex-1">
              {post.context.type === "team" && post.context.orgName && post.context.orgId && (
                <Link href={`/organizations/${post.context.orgId}`}>
                  <FitText
                    as="p"
                    max={12}
                    min={11}
                    lineHeight={1.2}
                    className={cn("font-normal hover:underline", !postOrgIdentity && "text-muted-foreground")}
                    data-testid={`text-post-parent-org-${post.id}`}
                  >
                    {formatOrgName(post.context.orgName)}
                  </FitText>
                </Link>
              )}
              <Link href={getContextHref(post.context)}>
                <FitText
                  as="p"
                  max={postOrgIdentity ? 16 : 14}
                  min={postOrgIdentity ? 13 : 12}
                  lineHeight={1.25}
                  className="font-bold hover:underline"
                  data-testid={`text-post-context-name-${post.id}`}
                >
                  {post.context.type === "organization" ? formatOrgName(post.context.name ?? post.context.type) : post.context.name ?? post.context.type}
                </FitText>
              </Link>
              <p className={cn(
                "mt-0.5 truncate",
                postOrgIdentity ? "text-[9px] font-medium" : "text-[10px] font-bold text-muted-foreground uppercase tracking-wider",
              )}>
                <Link
                  href={`/users/${post.author.id}`}
                  className={cn("hover:underline", !postOrgIdentity && "hover:text-primary")}
                  data-testid={`link-post-author-${post.id}`}
                >
                  {post.author.displayName}
                </Link>
                {"authorRole" in post.author && post.author.authorRole && (
                  <span data-testid={`text-post-author-role-${post.id}`}>
                    {" · "}
                    {post.author.authorRole}
                  </span>
                )}
                {" • "}
                {timeAgo(post.createdAt)}
              </p>
              {isHistorical && historical && (
                <div
                  className="mt-1 text-[11px] font-semibold"
                  data-testid={`historical-dates-${post.id}`}
                >
                  <span data-testid={`text-historical-date-${post.id}`}>
                    {historical.gameDate ? "Game played: " : "Year: "}
                    {historicalDateLabel(historical)}
                  </span>
                  <span className="text-muted-foreground">
                    {" · "}Uploaded {formatDate(post.createdAt)}
                  </span>
                  {historicalSourceLine(historical) && (
                    <div
                      className="text-muted-foreground italic"
                      data-testid={`text-historical-source-${post.id}`}
                    >
                      {historicalSourceLine(historical)}
                    </div>
                  )}
                </div>
              )}
              {isNews && (
                <div
                  className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
                  data-testid={`news-dates-${post.id}`}
                >
                  <span>
                    Posted on Kinectem: {formatDate(post.createdAt)}
                  </span>
                  {post.gameDate ? (
                    <span>
                      Game played: {formatDateUTC(post.gameDate)}
                    </span>
                  ) : (
                    <span>Game date not set</span>
                  )}
                </div>
              )}
            </div>
          </div>
          <div
            className="order-1 flex items-center justify-end gap-2 shrink-0 sm:order-2 sm:gap-1 sm:ml-3"
            data-testid={`post-header-actions-${post.id}`}
          >
            {competitionFeatured && (
              <span
                className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400"
                title="Featured by the competition"
                data-testid={`icon-featured-medal-${post.id}`}
              >
                <Medal className="w-3.5 h-3.5" />
              </span>
            )}
            <Badge
              className={`${badgeClass} border-none font-bold uppercase text-[10px] tracking-widest`}
              data-testid={`badge-post-type-${post.id}`}
            >
              <Icon className="w-3 h-3 mr-1 inline" />
              {label}
            </Badge>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-11 w-11 p-0 sm:h-7 sm:w-7"
                  data-testid={`btn-post-menu-${post.id}`}
                  aria-label="Post actions"
                >
                  <MoreVertical className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {isNews && post.canEdit === true && (
                  <DropdownMenuItem
                    onSelect={(event) => {
                      event.preventDefault();
                      setEditNewsGameDateOpen(true);
                    }}
                    data-testid={`menuitem-edit-news-game-date-${post.id}`}
                  >
                    <Pencil className="w-4 h-4 mr-2" /> Edit game date
                  </DropdownMenuItem>
                )}
                {isNews && (post.canDelete ?? false) && (
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      setConfirmNewsDelete(true);
                    }}
                    data-testid={`menuitem-remove-news-${post.id}`}
                  >
                    <Trash2 className="w-4 h-4 mr-2" /> Remove from team page
                  </DropdownMenuItem>
                )}
                {!isNews && canEditPost && (
                  <DropdownMenuItem
                    onSelect={() =>
                      setLocation(
                        isHistorical
                          ? historicalEditHref(post)
                          : `/posts/new?editId=${encodeURIComponent(post.id)}&from=${encodeURIComponent(currentPath + (typeof window !== "undefined" ? window.location.search : ""))}`,
                      )
                    }
                    data-testid={`menuitem-edit-${post.id}`}
                  >
                    <Pencil className="w-4 h-4 mr-2" /> Edit post
                  </DropdownMenuItem>
                )}
                {canDeleteHistorical && (
                  <DropdownMenuItem
                    onSelect={() => setConfirmHistoricalDelete(true)}
                    className="text-destructive focus:text-destructive"
                    data-testid={`menuitem-delete-historical-${post.id}`}
                  >
                    <Trash2 className="w-4 h-4 mr-2" /> Delete historical recap
                  </DropdownMenuItem>
                )}
                {asChildId && childPlausiblyLinked && (
                  <DropdownMenuItem
                    disabled={reportingPhoto}
                    onSelect={(e) => {
                      e.preventDefault();
                      setTakedownOpen(true);
                    }}
                    data-testid="menu-report-photo-of-child"
                  >
                    <Flag className="w-4 h-4 mr-2" />
                    {reportingPhoto ? "Submitting…" : "Report photo of my child"}
                  </DropdownMenuItem>
                )}
                {!isNews && (
                  <DropdownMenuItem
                    onSelect={() => setReportOpen(true)}
                    data-testid={`menuitem-report-${post.id}`}
                  >
                    <Flag className="w-4 h-4 mr-2" /> Report post
                  </DropdownMenuItem>
                )}
                {/* Task #344 — A tagged player can untag themselves from a
                    post directly from its three-dot menu. The server only
                    populates `currentUserTag` when the viewer has an
                    approved or pending tag on this article/highlight, so
                    the menu item naturally hides for everyone else. Org
                    Updates have no tag concept and never expose this. */}
                {post.currentUserTag && (
                  <DropdownMenuItem
                    onSelect={() => setUntagOpen(true)}
                    data-testid={`menuitem-untag-${post.id}`}
                  >
                    <UserMinus className="w-4 h-4 mr-2" /> Remove me from this
                    post
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <ReportDialog
          open={reportOpen}
          onOpenChange={setReportOpen}
          contentType={reportTarget.contentType}
          contentId={reportTarget.contentId}
        />
        {asChildId && childPlausiblyLinked && (
          <TakedownDialog
            open={takedownOpen}
            onOpenChange={setTakedownOpen}
            onConfirm={submitTakedown}
            submitting={reportingPhoto}
            postKindLabel={label.toLowerCase()}
          />
        )}
        {post.currentUserTag && (
          <AlertDialog open={untagOpen} onOpenChange={setUntagOpen}>
            <AlertDialogContent data-testid={`dialog-untag-${post.id}`}>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove yourself from this post?</AlertDialogTitle>
                <AlertDialogDescription>
                  You'll no longer appear as tagged on this{" "}
                  {post.currentUserTag.kind === "highlight"
                    ? "highlight"
                    : "game recap"}
                  . The author and other viewers won't be notified, and you can
                  always be re-tagged later.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={untagging}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={untagging}
                  data-testid={`btn-confirm-untag-${post.id}`}
                  onClick={async (e) => {
                    e.preventDefault();
                    if (!post.currentUserTag) return;
                    setUntagging(true);
                    const path =
                      post.currentUserTag.kind === "article"
                        ? `/api/v1/article-tags/${post.currentUserTag.id}`
                        : `/api/v1/highlight-tags/${post.currentUserTag.id}`;
                    try {
                      await customFetch(path, { method: "DELETE" });
                      toast({ title: "Removed from this post" });
                      // Refresh every surface that may show this post as
                      // tagging the viewer: the various feed variants, the
                      // user's own profile post list, and the canonical
                      // GET /posts/:id detail. The "My Tags" page and the
                      // pending-tags badge are plain customFetch calls
                      // keyed by URL, so invalidate by path.
                      await Promise.all([
                        qc.invalidateQueries({ queryKey: getListFeedQueryKey() }),
                        // Invalidate ALL user-post lists, not just the
                        // author's. The viewer is most likely browsing
                        // their own /users/<viewerId>/posts (their
                        // tagged feed) or another teammate's profile,
                        // and the active query key won't match the
                        // author id. Mirror the predicate-based
                        // invalidation already used by share actions.
                        qc.invalidateQueries({
                          predicate: (q) =>
                            Array.isArray(q.queryKey) &&
                            typeof q.queryKey[0] === "string" &&
                            q.queryKey[0].startsWith("/api/v1/users/") &&
                            q.queryKey[0].endsWith("/posts"),
                        }),
                        qc.invalidateQueries({
                          queryKey: getGetPostQueryKey(post.id),
                        }),
                        qc.invalidateQueries({ queryKey: ["/api/v1/users/me/tags"] }),
                        qc.invalidateQueries({ queryKey: ["/api/v1/tags/pending"] }),
                      ]);
                      setUntagOpen(false);
                    } catch {
                      toast({
                        title: "Couldn't remove tag",
                        variant: "destructive",
                      });
                    } finally {
                      setUntagging(false);
                    }
                  }}
                >
                  {untagging ? "Removing…" : "Remove me"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        {isShareable && (
          <ShareConfirmDialog
            open={confirmShareOpen}
            onOpenChange={setConfirmShareOpen}
            onConfirm={onConfirmShare}
            recapTitle={post.title}
            kind={shareKindLabel}
          />
        )}

        <div>
          {isShort && !hasEmbeddableVideo && firstImage?.url && (
            <Link href={`/posts/${post.id}`}>
              <div className="h-72 brand-gradient-dark relative flex items-center justify-center group cursor-pointer">
                <img
                  src={firstImage.url}
                  alt={post.title ?? ""}
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-0 w-full h-full object-cover opacity-60"
                />
                <div className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center group-hover:bg-primary transition-colors z-10">
                  <Play className="w-6 h-6 text-white ml-1" fill="currentColor" />
                </div>
              </div>
            </Link>
          )}
          <div className="px-5 py-4">
            {(post as { hidden?: boolean }).hidden && (
              <div className="mb-2">
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-red-100 text-red-900 border border-red-300 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide"
                  title="This post was deleted by its author. Only platform admins can still see it, for moderation."
                  data-testid={`badge-deleted-${post.id}`}
                >
                  Deleted
                </span>
              </div>
            )}
            {isNews && newsLink ? (
              <a
                href={newsLink.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block group"
                data-testid={`link-news-${post.id}`}
              >
                <h3 className="font-black text-lg tracking-tight leading-tight group-hover:underline mb-1">
                  {post.title}
                </h3>
                {newsLink.sourceName && (
                  <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">
                    {newsLink.sourceName}
                  </p>
                )}
                {post.body && (
                  <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3 mb-2">
                    {post.body}
                  </p>
                )}
                {firstImage?.url && (
                  <img
                    src={firstImage.url}
                    alt={post.title ?? ""}
                    loading="lazy"
                    decoding="async"
                    className="w-full max-h-72 object-cover rounded-lg border border-border mb-2"
                  />
                )}
                <span className="inline-flex items-center gap-1.5 text-sm font-bold text-primary">
                  <ExternalLink className="w-3.5 h-3.5" />
                  Read the full story
                  {newsLink.sourceName ? ` at ${newsLink.sourceName}` : ""}
                </span>
              </a>
            ) : null}
            {!isNews && post.title && (
              <div className="flex items-start gap-2 mb-2">
                <Link href={`/posts/${post.id}`} className="flex-1 min-w-0">
                  <h3
                    className={cn(
                      "font-black tracking-tight leading-tight hover:underline cursor-pointer",
                      isHistorical && "historical-title",
                      isGameRecap ? "text-xl" : "text-lg",
                    )}
                  >
                    {post.title}
                  </h3>
                </Link>
                {"tagStatus" in post && post.tagStatus === "pending" && (
                  <span
                    className="shrink-0 inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-900 border border-amber-300 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide"
                    title="You were tagged in this game recap. It is hidden from other viewers until you approve the tag."
                  >
                    Pending tag
                  </span>
                )}
              </div>
            )}
            {!isNews &&
              post.title &&
              !isShort &&
              (reportTarget.contentType === "article" || isHistorical) && (
                <hr
                  className={cn(
                    "border-t border-border mb-2",
                    isHistorical && "historical-rule",
                  )}
                  data-testid={`divider-post-title-card-${post.id}`}
                />
              )}
            {!isNews && post.description && (
              <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3 mb-2">
                {linkify(post.description)}
              </p>
            )}
            {!isNews && !isShort && post.body && (
              <RecapExcerpt body={post.body} postId={post.id} />
            )}
            {isHistorical && firstImage?.url && (
              <div className="mb-2">
                <ClippingViewer
                  src={firstImage.url}
                  alt={`Original clipping: ${post.title ?? "historical recap"}`}
                  postId={post.id}
                />
              </div>
            )}
            {!isNews && !isShort && !isHistorical && allImages.length > 0 && (
              <PhotoAlbum
                images={allImages
                  .map((a) => a.url)
                  .filter((u): u is string => typeof u === "string")}
                postId={post.id}
              />
            )}
            {!isShort && videoAsset?.url && (
              <VideoEmbed url={videoAsset.url} />
            )}
            {/* Highlights render the video after the title and
                description so the card matches the new-post form
                and the post detail page. Embeddable providers
                (YouTube/Vimeo) get an inline player in a
                brand-gradient banner; unsupported providers fall
                back to a clickable link via VideoEmbed's default. */}
            {isShort && hasEmbeddableVideo && videoAsset?.url && (
              <div className="brand-gradient-dark p-3 -mx-5 mt-3">
                <VideoEmbed
                  url={videoAsset.url}
                  className="rounded-lg overflow-hidden border border-border bg-black aspect-video"
                />
              </div>
            )}
            {isShort && !hasEmbeddableVideo && videoAsset?.url && (
              <VideoEmbed url={videoAsset.url} />
            )}
          </div>
        </div>

        {/*
         * Highlight cards surface the players tagged on the clip so
         * viewers can jump straight to a tagged player's profile.
         * `taggedUsers` is currently only populated for highlights;
         * other post kinds leave it undefined so the section hides.
         * Pending tags are pre-filtered server-side to the post
         * uploader and the tagged player themselves.
         */}
        {isShort && (
          <TaggedPlayers
            taggedUsers={
              "taggedUsers" in post ? post.taggedUsers : undefined
            }
            postId={post.id}
            variant="card"
          />
        )}

        <div className="px-5 py-3 border-t border-border/60">
          <div className="flex flex-wrap items-center gap-2" data-testid={`post-actions-${post.id}`}>
          <Button
            variant={post.hasReacted ? "default" : "outline"}
            size="sm"
            onClick={onToggleReaction}
            disabled={addReaction.isPending || removeReaction.isPending}
            className="font-bold gap-1.5 h-11 sm:h-8"
            data-testid={`button-reaction-${post.id}`}
          >
            <Heart
              className={`w-3.5 h-3.5 ${post.hasReacted ? "fill-current" : ""}`}
            />
            {post.reactionCount}
          </Button>
          <Link href={`/posts/${post.id}`}>
            <Button
              variant="outline"
              size="sm"
              className="font-bold gap-1.5 h-11 sm:h-8"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              {post.commentCount}
            </Button>
          </Link>
          {isShareable && (
            <Button
              variant={post.hasShared ? "default" : "outline"}
              size="sm"
              onClick={onToggleShare}
              disabled={sharePost.isPending || unsharePost.isPending}
              className="font-bold gap-1.5 h-11 sm:h-8"
              data-testid={`button-share-${post.id}`}
              aria-pressed={post.hasShared}
              aria-label={
                post.hasShared
                  ? `Unshare ${shareKindLabel}`
                  : `Share ${shareKindLabel}`
              }
            >
              <Share2
                className={`w-3.5 h-3.5 ${post.hasShared ? "fill-current" : ""}`}
              />
              {post.shareCount ?? 0}
            </Button>
          )}
          {/* Task #867 — news posts have no media albums; the action stays hidden. */}
          {!isShort && !isNews && !(isHistorical && reportTarget.contentType === "org_post") && (
            <Link href={`/posts/${post.id}?album=1`}>
              <Button
                variant="outline"
                size="sm"
                className="font-bold gap-1.5 h-11 sm:h-8"
                data-testid={`button-album-${post.id}`}
                aria-label="Open photo and video album"
              >
                <Camera className="w-3.5 h-3.5" />
                Media
                {albumPhotoCount > 0 && (
                  <NumericBadge
                    size={14}
                    className="text-[9px] font-bold bg-primary text-primary-foreground"
                    data-testid={`badge-album-count-${post.id}`}
                  >
                    {albumPhotoCount > 99 ? "99+" : albumPhotoCount}
                  </NumericBadge>
                )}
              </Button>
            </Link>
          )}
          {canShareAsImage && (
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                setShareImageOpen(true);
              }}
              className="font-bold gap-1.5 h-11 sm:h-8"
              data-testid={`btn-share-image-${post.id}`}
              aria-label="Share as image"
            >
              <ImageDown className="w-3.5 h-3.5" />
              {/* Icon-only on phones — the action row runs out of width
                  and the button gets clipped off the card edge. */}
              <span className="hidden sm:inline">Share as image</span>
            </Button>
          )}
          </div>
          {post.recentReactorName?.trim() && post.reactionCount > 0 && (
            <p className="mt-2 min-w-0 text-xs text-muted-foreground [overflow-wrap:anywhere]" data-testid={`post-liker-summary-${post.id}`}>
              {post.recentReactorName}
              {post.reactionCount > 1 ? ` +${post.reactionCount - 1}` : ""}
            </p>
          )}
        </div>
        {isNews && (
          <>
            <NewsGameDateDialog
              teamId={post.context.id}
              newsId={post.id.slice("news-".length)}
              title={post.title}
              gameDate={post.gameDate}
              open={editNewsGameDateOpen}
              onOpenChange={setEditNewsGameDateOpen}
            />
            <AlertDialog
              open={confirmNewsDelete}
              onOpenChange={setConfirmNewsDelete}
            >
              <AlertDialogContent data-testid={`dialog-remove-news-${post.id}`}>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove this news article?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The card will disappear from the team page and followers'
                    feeds. The newspaper's article itself isn't affected, and
                    you can add the link again later.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={deletingNews}>
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    disabled={deletingNews}
                    data-testid={`btn-confirm-remove-news-${post.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      void deleteNewsLink();
                    }}
                  >
                    {deletingNews ? "Removing…" : "Remove"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </CardContent>
        <AlertDialog
          open={confirmHistoricalDelete}
          onOpenChange={(open) => {
            if (!deletingHistorical) setConfirmHistoricalDelete(open);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete historical recap?</AlertDialogTitle>
              <AlertDialogDescription>
                This will remove the recap and its original newspaper clipping
                from public view, including organization pages, team pages,
                and shared posts. You cannot undo this here.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deletingHistorical}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={deletingHistorical}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                data-testid={`confirm-delete-historical-${post.id}`}
                onClick={(event) => {
                  event.preventDefault();
                  void deleteHistorical();
                }}
              >
                {deletingHistorical ? "Deleting…" : "Delete recap"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      {canShareAsImage && shareImageOpen && (
        <ShareRecapImageDialog
          // FeedPost is the feed-shaped subset of PostResponse; the share
          // canvas only reads fields both shapes carry (title, body,
          // context, author, gameDate + extra-spec branding blocks).
          post={post as PostResponse}
          open={shareImageOpen}
          onOpenChange={setShareImageOpen}
        />
      )}
    </Card>
  );
}

// Task: CODE_REVIEW F4 — feed rows are heavy; memoize so a parent list
// re-render (e.g. sidebar toggles, pagination appending pages) doesn't
// re-render every already-mounted card. `post` comes from the query
// cache so its reference is stable across unrelated re-renders.
export const PostCard = memo(PostCardImpl);


function PhotoAlbum({ images, postId }: { images: string[]; postId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const initial = images.slice(0, 4);
  const rest = images.slice(4);
  const hasMore = rest.length > 0;
  const visible = expanded ? images : initial;

  return (
    <div className="mt-3">
      <div className="grid grid-cols-4 gap-1.5">
        {visible.map((src, i) => {
          const isLastTile = !expanded && hasMore && i === initial.length - 1;
          return (
            <button
              key={`${postId}-img-${i}`}
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (isLastTile) {
                  setExpanded(true);
                } else {
                  setLightboxIndex(i);
                }
              }}
              className="relative aspect-square rounded-lg overflow-hidden bg-muted border border-border group"
              data-testid={`photo-tile-${postId}-${i}`}
            >
              <img
                src={src}
                alt={`Photo ${i + 1}`}
                loading="lazy"
                decoding="async"
                className="absolute inset-0 w-full h-full object-cover"
              />
              {isLastTile && (
                <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                  <span className="text-white font-black text-lg">
                    +{rest.length}
                  </span>
                </div>
              )}
            </button>
          );
        })}
      </div>
      {expanded && hasMore && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setExpanded(false);
          }}
          className="mt-2 text-xs font-bold text-muted-foreground hover:underline"
          data-testid={`button-collapse-photos-${postId}`}
        >
          Show fewer photos
        </button>
      )}
      <PhotoLightbox
        images={images}
        startIndex={lightboxIndex ?? 0}
        open={lightboxIndex !== null}
        onOpenChange={(o) => {
          if (!o) setLightboxIndex(null);
        }}
        testIdPrefix={`photo-lightbox-${postId}`}
      />
    </div>
  );
}

function RecapExcerpt({ body, postId }: { body: string; postId: string }) {
  const [expanded, setExpanded] = useState(false);
  const PREVIEW_CHARS = 280;
  const isLong = body.length > PREVIEW_CHARS;
  // Mention-safe truncation (task #739): if the 280-char cut lands
  // inside an inline @-mention token, back up to the token start so
  // the preview never shows raw "@[Jane Do…" markup.
  const visible =
    expanded || !isLong
      ? body
      : truncateMentionSafe(body, PREVIEW_CHARS) + "…";
  return (
    <div className="text-sm leading-relaxed whitespace-pre-wrap mt-1">
      {renderBodyWithMentions(visible)}
      {isLong && !expanded && (
        <>
          {" "}
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setExpanded(true);
            }}
            className="font-bold text-primary hover:underline"
            data-testid={`button-see-more-${postId}`}
          >
            See more
          </button>
        </>
      )}
      {isLong && expanded && (
        <>
          {" "}
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setExpanded(false);
            }}
            className="font-bold text-muted-foreground hover:underline"
            data-testid={`button-see-less-${postId}`}
          >
            See less
          </button>
        </>
      )}
    </div>
  );
}
