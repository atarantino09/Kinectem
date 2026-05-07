import { useState, useMemo, type ReactNode } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetUserById,
  useGetLoggedInUser,
  useListUserPosts,
  useListUserOrganizations,
  useListUserTeams,
  useFollowUser,
  useUnfollowUser,
  useCreateConversation,
  getGetUserByIdQueryKey,
  getListFeedQueryKey,
  getListConversationsQueryKey,
  getGetUnreadMessageCountQueryKey,
  type PrivateUserResponse,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { linkify } from "@/lib/linkify";
import { useIsLg } from "@/hooks/use-mobile";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar, TeamAvatar } from "@/components/UserAvatar";
import { NoIndex } from "@/components/NoIndex";
import {
  Building2,
  ChevronDown,
  MessageSquare,
  Shield,
  Tag,
  Users,
} from "lucide-react";
import { PostCard } from "@/components/PostCard";
import { EditProfileDialog } from "@/components/EditProfileDialog";
import { FollowListDialog } from "@/components/FollowListDialog";
import { AvatarLightbox } from "@/components/AvatarLightbox";

export default function UserProfilePage() {
  const params = useParams<{ userId: string }>();
  const userId = params.userId;
  const [followersOpen, setFollowersOpen] = useState(false);
  const [followingOpen, setFollowingOpen] = useState(false);
  const isLg = useIsLg();
  const { data: user, isLoading } = useGetUserById(userId);
  const { data: me } = useGetLoggedInUser();
  const { data: postsResp } = useListUserPosts(userId);
  const { data: orgsResp } = useListUserOrganizations(userId);
  const { data: teamsResp } = useListUserTeams(userId);
  const [teamFilter, setTeamFilter] = useState<string>("all");
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const followUser = useFollowUser();
  const unfollowUser = useUnfollowUser();
  const startConversation = useCreateConversation();
  const onToggleFollow = async () => {
    if (!user) return;
    try {
      if (user.isFollowing) {
        await unfollowUser.mutateAsync({ userId });
      } else {
        await followUser.mutateAsync({ userId });
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: getGetUserByIdQueryKey(userId) }),
        qc.invalidateQueries({ queryKey: getListFeedQueryKey() }),
      ]);
    } catch {
      toast({ title: "Couldn't update follow", variant: "destructive" });
    }
  };
  const onMessage = async () => {
    try {
      const conv = await startConversation.mutateAsync({
        data: { recipientType: "user", recipientId: userId },
      });
      qc.invalidateQueries({ queryKey: getListConversationsQueryKey() });
      qc.invalidateQueries({ queryKey: getGetUnreadMessageCountQueryKey() });
      setLocation(`/messages/${conv.id}`);
    } catch {
      toast({
        title: "Couldn't open conversation",
        description: "Please try again in a moment.",
        variant: "destructive",
      });
    }
  };

  const allPosts = postsResp?.data ?? [];
  const posts = useMemo(() => {
    if (teamFilter === "all") return allPosts;
    return allPosts.filter(
      (p) => p.context?.type === "team" && p.context.id === teamFilter,
    );
  }, [allPosts, teamFilter]);

  if (isLoading || !user) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const displayName = `${user.firstName} ${user.lastName}`;
  const orgs = orgsResp?.data ?? [];
  const teams = teamsResp?.data ?? [];
  // Server returns the private response (with `parentId`) when the viewer
  // is the linked parent, so the simple comparison below is sufficient.
  const isParentOfThisUser =
    !!me &&
    "parentId" in user &&
    !!user.parentId &&
    user.parentId === me.id;

  // Pre-render the per-section item arrays so the same content can be
  // dropped into the right rail (lg+) or inline below the hero (mobile).
  const linked = (
    user as {
      linkedAccounts?: {
        parents?: Array<{
          id: string;
          firstName: string;
          lastName: string;
          role: string;
          avatarUrl: string | null;
        }>;
        children?: Array<{
          id: string;
          firstName: string;
          lastName: string;
          role: string;
          avatarUrl: string | null;
        }>;
      };
    }
  ).linkedAccounts;
  const parents = linked?.parents ?? [];
  const childAccounts = linked?.children ?? [];
  const family = [
    ...parents.map((p) => ({ ...p, relation: "Parent / Guardian" as const })),
    ...childAccounts.map((c) => ({ ...c, relation: "Child" as const })),
  ];

  const orgItems: ReactNode[] = orgs.map((org) => (
    <Link key={org.id} href={`/organizations/${org.id}`}>
      <Card className="rounded-xl border border-border shadow-sm hover:border-primary/50 transition-colors cursor-pointer">
        <CardContent className="p-4 flex items-center gap-3">
          <TeamAvatar
            avatarUrl={org.logoUrl}
            displayName={org.name}
            size="lg"
            rounded="lg"
            fallbackClassName="brand-gradient-dark text-primary font-black"
          />
          <div className="min-w-0 flex-1">
            <p className="font-bold text-sm truncate">{org.name}</p>
            {org.role && (
              <Badge
                variant="outline"
                className="mt-1 text-[10px] uppercase tracking-wider font-bold"
              >
                {org.role}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  ));

  const teamItems: ReactNode[] = teams.map((t) => {
    const isPending = t.status === "pending";
    return (
      <Link key={t.id} href={`/teams/${t.teamId}`}>
        <Card
          className="rounded-xl border border-border shadow-sm hover:border-primary/50 transition-colors cursor-pointer"
          data-testid={`card-team-${t.teamId}`}
        >
          <CardContent className="p-4 flex items-center gap-3">
            {/* Banner-style thumbnail mirroring the team-page hero and the
                follow-suggestions rail. Uses the team's editable
                `bannerUrl` (cover-cropped) and falls back to the same
                soft primary gradient when no team photo is set. */}
            <div className="relative w-16 h-12 rounded-md overflow-hidden border border-border shrink-0 bg-gradient-to-br from-primary/30 via-primary/10 to-primary/5">
              {t.teamBannerUrl && (
                <img
                  src={t.teamBannerUrl}
                  alt={`${t.teamName} background`}
                  className="absolute inset-0 w-full h-full object-cover"
                  data-testid={`img-profile-team-banner-${t.teamId}`}
                />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2 min-w-0">
                <p className="font-bold text-sm truncate">{t.teamName}</p>
                <span
                  className="text-xs font-bold text-muted-foreground shrink-0"
                  data-testid={`text-team-jersey-${t.teamId}`}
                >
                  {t.jerseyNumber ? `#${t.jerseyNumber}` : "—"}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 mt-1">
                <Badge
                  variant="outline"
                  className="text-[10px] uppercase tracking-wider font-bold"
                >
                  {t.organization.name}
                </Badge>
                {t.position === "parent" && (
                  <Badge
                    variant="outline"
                    className="text-[10px] uppercase tracking-wider font-bold"
                    data-testid={`badge-team-parent-${t.teamId}`}
                  >
                    Parent
                  </Badge>
                )}
                {isPending && (
                  <Badge
                    variant="outline"
                    className="text-[10px] uppercase tracking-wider font-bold border-amber-500 text-amber-700 dark:text-amber-400"
                    data-testid={`badge-team-pending-${t.teamId}`}
                  >
                    Pending
                  </Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </Link>
    );
  });

  const familyItems: ReactNode[] = family.map((m) => {
    const name = `${m.firstName} ${m.lastName}`.trim();
    return (
      <Link key={`${m.relation}-${m.id}`} href={`/users/${m.id}`}>
        <Card
          className="rounded-xl border border-border shadow-sm hover:border-primary/50 transition-colors cursor-pointer"
          data-testid={`card-linked-${m.id}`}
        >
          <CardContent className="p-4 flex items-center gap-3">
            <UserAvatar
              avatarUrl={m.avatarUrl}
              displayName={name}
              size="lg"
              fallbackClassName="bg-slate-900 text-primary-foreground font-black"
            />
            <div className="min-w-0 flex-1">
              <p className="font-bold text-sm truncate">{name}</p>
              <Badge
                variant="outline"
                className="mt-1 text-[10px] uppercase tracking-wider font-bold"
              >
                {m.relation}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </Link>
    );
  });

  const hasAnyAffiliation =
    orgItems.length > 0 || teamItems.length > 0 || familyItems.length > 0;

  const affiliationsStack = hasAnyAffiliation ? (
    <div className="flex flex-col gap-4">
      {orgItems.length > 0 && (
        <AffiliationColumn
          title="Organizations"
          icon={<Building2 className="w-5 h-5 text-primary" />}
          testId="orgs"
          items={orgItems}
        />
      )}
      {teamItems.length > 0 && (
        <AffiliationColumn
          title="Teams"
          icon={<Shield className="w-5 h-5 text-primary" />}
          testId="teams"
          items={teamItems}
        />
      )}
      {familyItems.length > 0 && (
        <AffiliationColumn
          title="Family"
          icon={<Users className="w-5 h-5 text-primary" />}
          testId="family"
          items={familyItems}
        />
      )}
    </div>
  ) : null;

  return (
    <div
      className={`grid grid-cols-1 ${
        hasAnyAffiliation ? "lg:grid-cols-[minmax(0,1fr)_340px]" : ""
      } gap-6 items-start`}
    >
      {/* Task #367 — minor profile pages must not be search-indexed.
          The API also sets X-Robots-Tag, but the SPA shell may render
          the page from the static index.html before the API call
          completes. */}
      {(user as { isMinor?: boolean }).isMinor ? <NoIndex /> : null}
      <div className="space-y-6 min-w-0">
      {/* Hero */}
      <div className="rounded-xl border border-border shadow-sm overflow-hidden bg-card">
        <div className="h-24 brand-gradient-cover relative">
          {user.coverPhotoUrl ? (
            <img
              src={user.coverPhotoUrl}
              alt=""
              className="w-full h-full object-cover opacity-90"
            />
          ) : (
            <div
              aria-hidden="true"
              className="brand-banner-pattern absolute inset-0 pointer-events-none"
            />
          )}
        </div>
        <div className="px-6 pb-6 -mt-16">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <AvatarLightbox
              avatarUrl={user.avatarUrl}
              displayName={displayName}
              triggerTestId="btn-open-avatar-lightbox"
              dialogTestId="dialog-avatar-lightbox"
              imageTestId="img-avatar-lightbox"
            >
              <UserAvatar
                avatarUrl={user.avatarUrl}
                displayName={displayName}
                size="4xl"
                className={`border-4 border-card shadow-lg ${user.avatarUrl ? "cursor-pointer" : ""}`}
                fallbackClassName="bg-slate-900 text-primary-foreground font-black"
              />
            </AvatarLightbox>
            {user.isOwnProfile && "email" in user ? (
              <div className="mt-24 flex items-center gap-2">
                <Link href="/me/tags">
                  <Button
                    variant="outline"
                    className="font-bold rounded-full"
                    data-testid="link-manage-tags"
                  >
                    <Tag className="w-4 h-4 mr-1.5" />
                    Manage Tags
                  </Button>
                </Link>
                <EditProfileDialog user={user as PrivateUserResponse} />
              </div>
            ) : isParentOfThisUser ? (
              <div
                className="mt-24 flex items-center gap-2"
                data-testid="parent-actions"
              >
                <EditProfileDialog user={user as PrivateUserResponse} />
              </div>
            ) : (
              <div className="mt-24 flex items-center gap-2">
                <Button
                  variant="outline"
                  className="font-bold rounded-full"
                  onClick={onMessage}
                  disabled={startConversation.isPending}
                  data-testid="btn-message-user"
                >
                  <MessageSquare className="w-4 h-4 mr-1.5" />
                  Message
                </Button>
                <Button
                  variant="brand"
                  onClick={onToggleFollow}
                  disabled={followUser.isPending || unfollowUser.isPending}
                  data-testid="btn-follow-user"
                >
                  {user.isFollowing ? "Following" : "Follow"}
                </Button>
              </div>
            )}
          </div>
          <div className="mt-2">
            <h1 className="text-4xl font-black tracking-tight leading-[1.05]">
              {displayName}
            </h1>
            <div className="flex items-center gap-5 mt-2">
              <button
                type="button"
                onClick={() => setFollowersOpen(true)}
                className="text-sm font-medium text-muted-foreground hover:text-foreground"
                data-testid="btn-view-user-followers"
              >
                <span className="font-black text-foreground">
                  {(user as { followerCount?: number }).followerCount ?? 0}
                </span>{" "}
                Followers
              </button>
              <button
                type="button"
                onClick={() => setFollowingOpen(true)}
                className="text-sm font-medium text-muted-foreground hover:text-foreground"
                data-testid="btn-view-user-following"
              >
                <span className="font-black text-foreground">
                  {(user as { followingCount?: number }).followingCount ?? 0}
                </span>{" "}
                Following
              </button>
            </div>
          </div>
        </div>
        <FollowListDialog
          open={followersOpen}
          onOpenChange={setFollowersOpen}
          title={`${displayName}'s followers`}
          variant={{ kind: "user-followers", userId }}
        />
        <FollowListDialog
          open={followingOpen}
          onOpenChange={setFollowingOpen}
          title={`${displayName} follows`}
          variant={{ kind: "user-following", userId }}
        />
        {(user.bio || user.website || user.city || user.state) && (
          <div className="px-6 pb-6 space-y-2">
            {user.bio && (
              <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl whitespace-pre-wrap">
                {linkify(user.bio)}
              </p>
            )}
            {/* Task #349 — Show "City, ST", just the city, or just the state
                depending on which fields the user has set. Hidden when both
                are empty. */}
            {(user.city || user.state) && (
              <p
                className="text-sm font-medium text-muted-foreground"
                data-testid="text-user-location"
              >
                {user.city && user.state
                  ? `${user.city}, ${user.state}`
                  : (user.city ?? user.state)}
              </p>
            )}
            {user.website && (
              <a
                href={user.website}
                target="_blank"
                rel="noreferrer noopener"
                className="text-sm font-bold text-primary hover:underline break-all"
                data-testid="link-user-website"
              >
                {user.website.replace(/^https?:\/\//, "")}
              </a>
            )}
          </div>
        )}
      </div>

      {/* Affiliations stack: inline on mobile (between hero and posts),
          rendered in the right rail on lg+. Only one copy mounts at a
          time so testids stay unique. */}
      {!isLg && affiliationsStack}

      {/* Posts (authored + tagged) */}
      <section>
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <h2 className="text-xl font-black tracking-tight">
            {user.isOwnProfile ? "Posts" : "Posts & tagged in"}
          </h2>
          {teams.length > 0 && (
            <Select value={teamFilter} onValueChange={setTeamFilter}>
              <SelectTrigger
                className="w-56 font-bold"
                data-testid="select-team-filter"
              >
                <SelectValue placeholder="All teams" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All teams</SelectItem>
                {teams.map((t) => (
                  <SelectItem key={t.teamId} value={t.teamId}>
                    {t.teamName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="space-y-3">
          {posts.length > 0 ? (
            posts.map((p) => <PostCard key={p.id} post={p} />)
          ) : (
            <Card className="rounded-xl border border-border">
              <CardContent className="p-8 text-center">
                <Building2 className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No posts yet.</p>
              </CardContent>
            </Card>
          )}
        </div>
      </section>
      </div>

      {/* Right rail (lg+ only — on mobile this renders inline above) */}
      {isLg && hasAnyAffiliation && (
        <aside className="lg:sticky lg:top-20 lg:self-start">
          {affiliationsStack}
        </aside>
      )}
    </div>
  );
}

function AffiliationColumn({
  title,
  icon,
  testId,
  items,
}: {
  title: string;
  icon: ReactNode;
  testId: string;
  items: ReactNode[];
}) {
  const [open, setOpen] = useState(false);
  // Caller must skip rendering this card when items is empty.
  if (items.length === 0) return null;
  const hasMore = items.length > 1;
  const [first, ...rest] = items;
  return (
    <div
      className="rounded-xl border border-border bg-card shadow-sm"
      data-testid={`affiliation-column-${testId}`}
    >
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          {icon}
          <h2 className="text-base font-black tracking-tight truncate">
            {title}
          </h2>
          <Badge
            variant="outline"
            className="text-[10px] uppercase tracking-wider font-bold"
            data-testid={`affiliation-count-${testId}`}
          >
            {items.length}
          </Badge>
        </div>
        {hasMore && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded-full p-1 hover:bg-muted/40 transition-colors shrink-0"
            data-testid={`affiliation-toggle-${testId}`}
            aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
            aria-expanded={open}
          >
            <ChevronDown
              className={`w-4 h-4 text-muted-foreground transition-transform ${
                open ? "rotate-180" : ""
              }`}
              aria-hidden
            />
          </button>
        )}
      </div>
      <div
        className="px-3 pb-3"
        data-testid={`affiliation-content-${testId}`}
      >
        <div className="flex flex-col gap-3">
          {first}
          {hasMore && open && rest}
        </div>
      </div>
    </div>
  );
}
