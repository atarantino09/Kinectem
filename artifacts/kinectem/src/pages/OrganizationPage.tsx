import { Fragment, useEffect, useMemo, useState } from "react";
import { useParams, Link, useSearch } from "wouter";
import { useQueryClient, useQuery, useInfiniteQuery } from "@tanstack/react-query";
import {
  useGetOrganizationById,
  useListOrgTeams,
  useListArchivedOrgTeams,
  queryOpts,
  listOrgPosts,
  getListOrgPostsQueryKey,
  useListMembers,
  useListOrgJoinRequests,
  useListOrgPostApprovals,
  useFollowOrg,
  useUnfollowOrg,
  useGetLoggedInUser,
  getGetOrganizationByIdQueryKey,
  getListFeedQueryKey,
  customFetch,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useIsLg } from "@/hooks/use-mobile";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { usePinnedTeams } from "@/hooks/usePinnedTeams";
import { PinTeamButton, PinnedSectionLabel } from "@/components/PinTeamButton";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Archive,
  Building2,
  ChevronDown,
  Compass,
  Search,
  X,
  ExternalLink,
  ListPlus,
  Mail,
  Megaphone,
  Newspaper,
  Pencil,
  Plus,
  Share2,
  Shield,
  UserPlus,
  Users,
} from "lucide-react";
import { PostCard } from "@/components/PostCard";
import { AvatarLightbox } from "@/components/AvatarLightbox";
import { FitText } from "@/components/FitText";
import { PersonaPill } from "@/components/PersonaPill";
import { OrgLogo } from "@/components/OrgLogoFallback";
import { OrgAdminPanel } from "@/components/OrgAdminPanel";
import {
  OrgSetupChecklist,
  RolesPermissionsCard,
} from "@/components/OrgSetupChecklist";
import { CreateTeamDialog } from "@/components/CreateTeamDialog";
import { BulkAddTeamsDialog } from "@/components/BulkAddTeamsDialog";
import { BulkAddCoachesDialog } from "@/components/BulkAddCoachesDialog";
import {
  StageCoachesDialog,
  useStagedCoaches,
} from "@/components/StageCoachesDialog";
import {
  CoachSetupDialog,
  canReopenCoachSetup,
} from "@/components/CoachSetupDialog";
import { EditOrgDialog } from "@/components/EditOrgDialog";
import { FollowListDialog } from "@/components/FollowListDialog";
import { NewOrgPostDialog } from "@/components/NewOrgPostDialog";
import { NewsletterDialog } from "@/components/NewsletterDialog";
import { ManageMembersDialog } from "@/components/ManageMembersDialog";
import { BroadcastComposeDialog } from "@/components/broadcasts/BroadcastComposeDialog";
import {
  SpotlightTour,
  type TourStep,
} from "@/components/team-page/SpotlightTour";
import { OrganizationDescription } from "@/components/organization-page/OrganizationDescription";
import { formatOrgName } from "@/lib/format";
import { readOrgBrandColors, orgHeroGradient } from "@/lib/orgBrand";
import { PLANS, type OrgPlanUsage } from "@/lib/plans";
import { useInfiniteScrollSentinel } from "@/hooks/useInfiniteScrollSentinel";
import { useWhoami } from "@/hooks/useWhoami";
import { OrgClaimBanner } from "@/components/ClaimTokenBanner";
import { OrgPageShareDialog } from "@/components/OrgPageShareDialog";
import { OrgPreInviteDialog } from "@/components/OrgPreInviteDialog";

type TeamRailItem = {
  id: string;
  name: string;
  sport?: string | null;
  avatarUrl?: string | null;
  bannerUrl?: string | null;
  followerCount?: number | null;
};

// First-run org walkthrough is shown ONCE per user, per browser (the OpenAPI
// contract is locked, so there's no server-side "seen onboarding" flag). The
// "seen" flag is a single global key — the first time an owner/admin lands on
// any org page they get the tour, and never again on any other org. Bump the
// key to re-show the tour to everyone after a meaningful revision.
const ORG_TOUR_KEY = "kinectem:org-tour-v3";

export default function OrganizationPage() {
  const params = useParams<{ orgId: string }>();
  const orgId = params.orgId;
  const search = useSearch();
  const showAroundQuery =
    new URLSearchParams(search.replace(/^\?/, "")).get("showAround") === "1";
  const qc = useQueryClient();
  const { toast } = useToast();
  const [createTeamOpen, setCreateTeamOpen] = useState(false);
  const [bulkTeamsOpen, setBulkTeamsOpen] = useState(false);
  const [bulkCoachesOpen, setBulkCoachesOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [followersOpen, setFollowersOpen] = useState(false);
  const [newPostOpen, setNewPostOpen] = useState(false);
  const [newsletterOpen, setNewsletterOpen] = useState(false);
  const [manageMembersOpen, setManageMembersOpen] = useState(false);
  const [adminQueueOpen, setAdminQueueOpen] = useState(false);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [sharePageOpen, setSharePageOpen] = useState(false);
  const [preInviteOpen, setPreInviteOpen] = useState(false);
  const [preInviteAutomatic, setPreInviteAutomatic] = useState(false);
  const [handoffAdvance, setHandoffAdvance] = useState(0);
  // Task #443 — celebratory popup shown once right after a successful
  // org create. CreateOrgDialog stashes the org name under
  // `kinectem:welcome-org:<orgId>` and we consume it on mount so a
  // refresh / revisit can never re-trigger the modal.
  const [welcomeOrgName, setWelcomeOrgName] = useState<string | null>(null);
  const [orgTourOpen, setOrgTourOpen] = useState(false);
  const [showAroundRequested, setShowAroundRequested] =
    useState(showAroundQuery);
  const [manageMenuOpen, setManageMenuOpen] = useState(false);
  const [communicationMenuOpen, setCommunicationMenuOpen] = useState(false);
  // Gate the first-run tour until the post-create welcome / bulk-add popups
  // have been resolved on mount, so the tour never flashes on top of them.
  const [firstRunResolved, setFirstRunResolved] = useState(false);
  // Task #808 — post-claim coach setup. ClaimOrgPage stashes this flag right
  // after a successful claim; when the org already has teams we open the
  // one-time "add coaches to your teams" prompt (pre-filled with any drafts
  // the platform admin staged before the claim).
  const [coachSetupPending, setCoachSetupPending] = useState(false);
  // Task #836 — manual re-entry into the coach setup dialog (persistent
  // banner below) so staged coaches aren't a one-time-only prompt.
  const [coachSetupOpen, setCoachSetupOpen] = useState(false);
  const [stageCoachesOpen, setStageCoachesOpen] = useState(false);
  useEffect(() => {
    if (!orgId) return;
    try {
      const preInviteKey = `kinectem:pre-invite-org:${orgId}`;
      if (sessionStorage.getItem(preInviteKey) === "1") {
        sessionStorage.removeItem(preInviteKey);
        setPreInviteAutomatic(true);
        setPreInviteOpen(true);
        setFirstRunResolved(false);
        return;
      }
    } catch {
      // sessionStorage unavailable; continue to the existing prompts.
    }
    try {
      const coachKey = `kinectem:coach-setup:${orgId}`;
      if (sessionStorage.getItem(coachKey) === "1") {
        sessionStorage.removeItem(coachKey);
        sessionStorage.removeItem(`kinectem:bulk-add-org:${orgId}`);
        sessionStorage.removeItem(`kinectem:welcome-org:${orgId}`);
        setCoachSetupPending(true);
        setFirstRunResolved(true);
        return;
      }
    } catch {
      // sessionStorage unavailable; fall through to the other popups.
    }
    // After checkout, OrgSubscribePage stashes a bulk-add flag so we land
    // straight on the "Bulk add teams" popup. It takes priority over the
    // org-create welcome popup so the user never sees two modals at once.
    try {
      const bulkKey = `kinectem:bulk-add-org:${orgId}`;
      if (sessionStorage.getItem(bulkKey) === "1") {
        sessionStorage.removeItem(bulkKey);
        sessionStorage.removeItem(`kinectem:welcome-org:${orgId}`);
        setBulkTeamsOpen(true);
        setFirstRunResolved(true);
        return;
      }
    } catch {
      // sessionStorage unavailable; fall through to the welcome popup.
    }
    let name: string | null = null;
    try {
      const key = `kinectem:welcome-org:${orgId}`;
      name = sessionStorage.getItem(key);
      if (name != null) sessionStorage.removeItem(key);
    } catch {
      // sessionStorage unavailable; nothing to show.
    }
    if (name) setWelcomeOrgName(name);
    setFirstRunResolved(true);
  }, [orgId, handoffAdvance]);
  const isLg = useIsLg();
  const { data: me } = useGetLoggedInUser();
  const { data: who } = useWhoami();
  // Platform admins manage every org — mirrors the server's
  // canManageOrganization bypass. Session-user semantics: during
  // masquerade the viewed user's role applies, matching the server.
  const isPlatformAdmin =
    (who?.isMasquerading ? who?.viewingAs?.role : who?.realUser?.role) ===
    "admin";
  const { data: organization, isLoading } = useGetOrganizationById(orgId);
  const { data: teamsResp } = useListOrgTeams(orgId);
  // Task #808 — teamless orgs skip the post-claim coach prompt silently:
  // clear the pending flag once team data resolves empty so it can't linger
  // and keep suppressing the org tour for the rest of the session.
  useEffect(() => {
    if (coachSetupPending && teamsResp && teamsResp.data.length === 0) {
      setCoachSetupPending(false);
    }
  }, [coachSetupPending, teamsResp]);
  const { data: archivedTeamsResp } = useListArchivedOrgTeams(
    orgId,
    undefined,
    {
      query: queryOpts({
        enabled:
          !!orgId &&
          (isPlatformAdmin ||
            organization?.role === "owner" ||
            organization?.role === "admin"),
      }),
    },
  );
  // Task #785 — infinite scroll. The endpoint now honors cursor +
  // limit, so consume it with useInfiniteQuery (no generated infinite
  // hook exists — build on the raw `listOrgPosts` fetcher). The key
  // extends the generated one so composer invalidations still hit it.
  const ORG_POSTS_PAGE_SIZE = 20;
  const {
    data: postPages,
    fetchNextPage: fetchMorePosts,
    hasNextPage: hasMorePosts,
    isFetchingNextPage: isFetchingMorePosts,
    isFetchNextPageError: fetchMorePostsFailed,
  } = useInfiniteQuery({
    queryKey: [...getListOrgPostsQueryKey(orgId), "infinite"] as const,
    queryFn: ({ pageParam }) =>
      listOrgPosts(orgId, {
        limit: ORG_POSTS_PAGE_SIZE,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasMore
        ? lastPage.pagination.nextCursor ?? undefined
        : undefined,
    enabled: !!orgId,
  });
  const orgPostsSentinelRef = useInfiniteScrollSentinel({
    hasMore: !!hasMorePosts,
    isLoading: isFetchingMorePosts,
    hasError: fetchMorePostsFailed,
    onLoadMore: fetchMorePosts,
  });
  const { data: membersResp } = useListMembers(orgId);
  const { data: planUsageResp } = useQuery<{ usage: OrgPlanUsage }>({
    queryKey: ["org-plan-usage", orgId],
    enabled:
      !!orgId &&
      (isPlatformAdmin ||
        organization?.role === "owner" ||
        organization?.role === "admin"),
    queryFn: () =>
      customFetch<{ usage: OrgPlanUsage }>(
        `/api/v1/organizations/${orgId}/subscription`,
        { method: "GET" },
      ),
  });
  const isManagerRole =
    isPlatformAdmin ||
    organization?.role === "owner" ||
    organization?.role === "admin";
  // Task #836 — staged coaches persist until invited or removed; managers
  // see a persistent banner to reopen the coach setup dialog while any
  // staged entries remain.
  const stagedCoachesQuery = useStagedCoaches(orgId, isManagerRole);
  const stagedCoachCount = stagedCoachesQuery.data?.data.length ?? 0;
  const { data: joinReqResp } = useListOrgJoinRequests(orgId, undefined, {
    query: queryOpts({ enabled: !!orgId && isManagerRole }),
  });
  const { data: postApprovalsResp } = useListOrgPostApprovals(
    orgId,
    undefined,
    {
      query: queryOpts({ enabled: !!orgId && isManagerRole }),
    },
  );
  const pendingAdminCount =
    (joinReqResp?.data?.length ?? 0) + (postApprovalsResp?.data?.length ?? 0);
  const followOrg = useFollowOrg();
  const unfollowOrg = useUnfollowOrg();

  // Role-tailored first-run walkthrough for org owners/admins. The targets are
  // all rendered whenever `isOrgManager` is true (see JSX below); the tour
  // scrolls each into view. Steps whose target never mounts fall back to a
  // centered card, so this stays resilient if a control is conditionally hidden.
  const orgTourSteps = useMemo<TourStep[]>(
    () => [
      {
        targetTestId: "btn-org-manage-menu",
        onEnter: () => {
          setManageMenuOpen(false);
          setCommunicationMenuOpen(false);
        },
        title: "Manage admins & members",
        body: (
          <>
            Open <strong>Manage</strong>, then choose{" "}
            <strong>Manage members</strong> to add co-admins, promote members,
            and invite people to help you run the organization.
          </>
        ),
      },
      {
        targetTestId: "btn-org-manage-menu",
        onEnter: () => {
          setManageMenuOpen(false);
          setCommunicationMenuOpen(false);
        },
        title: "Manage your organization",
        body: (
          <>
            The <strong>Manage</strong> menu is where you{" "}
            <strong>edit the organization</strong> (name, logo, details), manage
            members, review your plan, and handle the admin queue.
          </>
        ),
      },
      {
        targetTestId: "btn-add-team",
        additionalTargetTestIds: ["btn-bulk-add-teams"],
        onEnter: () => {
          setManageMenuOpen(false);
          setCommunicationMenuOpen(false);
        },
        title: "Add your teams",
        body: (
          <>
            Use <strong>Add team</strong> to create a team, or{" "}
            <strong>Bulk add</strong> to spin up a whole season at once. Add a
            coach to each team so they can manage their own roster.
          </>
        ),
      },
      {
        targetTestId: "btn-new-org-post",
        onEnter: () => {
          setManageMenuOpen(false);
          setCommunicationMenuOpen(false);
        },
        title: "Post an update",
        body: (
          <>
            Click <strong>New post</strong> to share news with everyone who
            follows your organization.
          </>
        ),
      },
      {
        targetTestId: "btn-org-newsletter",
        onEnter: () => {
          setManageMenuOpen(false);
          setCommunicationMenuOpen(false);
        },
        title: "Send a newsletter",
        body: (
          <>
            <strong>Newsletter</strong> emails a roundup to your followers —
            perfect for a monthly recap or a big announcement.
          </>
        ),
      },
      {
        targetTestId: "btn-org-communication-menu",
        additionalTargetTestIds: ["btn-org-pre-invite"],
        onEnter: () => {
          setManageMenuOpen(false);
          setCommunicationMenuOpen(true);
        },
        title: "Prepare your pre-invite message",
        body: (
          <>
            Open <strong>Pre-invite message</strong> for ready-to-send language
            that introduces Kinectem before you invite coaches and teams.
          </>
        ),
      },
      {
        targetTestId: "btn-bulk-add-coaches",
        onEnter: () => {
          setManageMenuOpen(false);
          setCommunicationMenuOpen(false);
        },
        title: "Bulk add coaches",
        body: (
          <>
            Use <strong>Bulk add coach</strong> to invite coaches across your
            organization’s teams in one pass.
          </>
        ),
      },
      {
        targetTestId: "btn-org-communication-menu",
        additionalTargetTestIds: ["btn-org-roster-outreach"],
        onEnter: () => {
          setManageMenuOpen(false);
          setCommunicationMenuOpen(true);
        },
        title: "Invite every team",
        body: (
          <>
            Open <strong>Roster outreach</strong> to review the right
            team-specific invite for every roster. Each message includes that
            team’s unique link, ready for parents and players in the team tool
            you already use.
          </>
        ),
      },
    ],
    [],
  );

  // Partner landing links include showAround=1 so the existing eight-step org
  // walkthrough starts after the organization page has had time to render.
  // Remove the one-shot query from the browser URL so a refresh does not
  // replay it.
  useEffect(() => {
    if (!showAroundQuery || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.delete("showAround");
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }, [showAroundQuery]);

  // Open the org walkthrough once per user (per browser), the first time an
  // owner/admin lands on any org page. Gated on `isManagerRole` so a
  // non-manager viewer never triggers it. Suppressed until the post-create
  // welcome / bulk-add popups resolve so tours never stack.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!orgId || !firstRunResolved || !isManagerRole) return;
    if (showAroundRequested) return;
    if (
      welcomeOrgName !== null ||
      preInviteOpen ||
      createTeamOpen ||
      bulkTeamsOpen ||
      coachSetupPending
    )
      return;
    let alreadySeen = false;
    try {
      alreadySeen = localStorage.getItem(ORG_TOUR_KEY) === "1";
    } catch {
      // storage blocked (private mode etc.) — treat as not seen
    }
    if (!alreadySeen) setOrgTourOpen(true);
  }, [
    orgId,
    firstRunResolved,
    isManagerRole,
    welcomeOrgName,
    preInviteOpen,
    createTeamOpen,
    bulkTeamsOpen,
    coachSetupPending,
    showAroundRequested,
  ]);

  // The partner-page tour is intentionally delayed until the visitor has seen
  // the organization page, rather than opening over the navigation transition.
  // It reuses the normal six-step manager walkthrough.
  useEffect(() => {
    if (
      !showAroundRequested ||
      !orgId ||
      !organization ||
      !firstRunResolved ||
      !isManagerRole ||
      orgTourSteps.length === 0 ||
      welcomeOrgName !== null ||
      preInviteOpen ||
      createTeamOpen ||
      bulkTeamsOpen ||
      coachSetupPending
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      setOrgTourOpen(true);
      setShowAroundRequested(false);
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [
    showAroundRequested,
    orgId,
    organization,
    firstRunResolved,
    isManagerRole,
    orgTourSteps.length,
    welcomeOrgName,
    preInviteOpen,
    createTeamOpen,
    bulkTeamsOpen,
    coachSetupPending,
  ]);

  const finishOrgTour = () => {
    try {
      localStorage.setItem(ORG_TOUR_KEY, "1");
    } catch {
      // ignore storage failures (private mode etc.) — tour just won't persist
    }
    setOrgTourOpen(false);
    setManageMenuOpen(false);
    setCommunicationMenuOpen(false);
  };

  const onToggleFollow = async () => {
    if (!organization) return;
    try {
      if (organization.isFollowing) {
        await unfollowOrg.mutateAsync({ orgId });
      } else {
        await followOrg.mutateAsync({ orgId });
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: getGetOrganizationByIdQueryKey(orgId) }),
        qc.invalidateQueries({ queryKey: getListFeedQueryKey() }),
      ]);
    } catch {
      toast({ title: "Couldn't update follow", variant: "destructive" });
    }
  };

  if (isLoading || !organization) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const teams = teamsResp?.data ?? [];
  const archivedTeams = archivedTeamsResp?.data ?? [];
  const posts = postPages?.pages.flatMap((p) => p.data) ?? [];
  const members = membersResp?.data ?? [];
  const isOrgManager =
    isPlatformAdmin ||
    organization.role === "admin" ||
    organization.role === "owner";
  const planUsage = planUsageResp?.usage;
  const atTeamLimit =
    !!planUsage &&
    planUsage.teamsLimit != null &&
    planUsage.teamsUsed >= planUsage.teamsLimit;
  // Task #603 — "Unclaimed" badge for ownerless (bulk-imported) org pages.
  // `hasOwner` is appended by the server outside the locked openapi.yaml, so
  // read it via a narrow cast. Claiming is invite-only via a secret token
  // link (/app/claim/<token>); there is no in-app "claim this org" action.
  const claimInfo = organization as { hasOwner?: boolean };
  const isUnclaimed = claimInfo.hasOwner === false;

  return (
    <>
      <CreateTeamDialog
        orgId={orgId}
        open={createTeamOpen}
        onOpenChange={setCreateTeamOpen}
        usage={planUsage}
      />
      <BulkAddTeamsDialog
        orgId={orgId}
        open={bulkTeamsOpen}
        onOpenChange={setBulkTeamsOpen}
        usage={planUsage}
        staging={isPlatformAdmin && isUnclaimed}
      />
      {/* Task #835 — bulk coach invites across the org's existing teams. */}
      <BulkAddCoachesDialog
        orgId={orgId}
        teams={teams.map((t) => ({ id: t.id, name: t.name, sport: t.sport }))}
        open={bulkCoachesOpen}
        onOpenChange={setBulkCoachesOpen}
      />
      {/* Task #808 — platform-admin draft staging on an unclaimed org. */}
      {isPlatformAdmin && isUnclaimed && (
        <StageCoachesDialog
          orgId={orgId}
          teams={teams.map((t) => ({ id: t.id, name: t.name }))}
          open={stageCoachesOpen}
          onOpenChange={setStageCoachesOpen}
        />
      )}
      {/* Task #808 — one-time post-claim coach setup prompt. Only opens when
          the org actually has teams; a teamless org skips it silently. */}
      <CoachSetupDialog
        orgId={orgId}
        teams={teams.map((t) => ({ id: t.id, name: t.name }))}
        open={
          (coachSetupPending || coachSetupOpen) &&
          isOrgManager &&
          // Staged drafts stay side-effect-free until the post-claim owner
          // confirms — never surface the invite-sending dialog pre-claim.
          !isUnclaimed &&
          teams.length > 0
        }
        onOpenChange={(v) => {
          if (!v) {
            setCoachSetupPending(false);
            setCoachSetupOpen(false);
          }
        }}
      />
      <Dialog
        open={welcomeOrgName !== null && isOrgManager}
        onOpenChange={(v) => {
          if (!v) setWelcomeOrgName(null);
        }}
      >
        <DialogContent
          className="sm:max-w-md"
          data-testid="dialog-welcome-org"
        >
          <DialogHeader>
            <DialogTitle className="font-black tracking-tight">
              Congratulations on creating {formatOrgName(welcomeOrgName)}!
            </DialogTitle>
            <DialogDescription>
              Next step: create teams and invite coaches, players, and
              parents so they can start sharing updates and highlights.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setWelcomeOrgName(null)}
              data-testid="btn-welcome-org-dismiss"
            >
              Maybe later
            </Button>
            <Button
              type="button"
              variant="brand"
              onClick={() => {
                setWelcomeOrgName(null);
                setCreateTeamOpen(true);
              }}
              data-testid="btn-welcome-org-create-team"
            >
              Create your first team
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <NewOrgPostDialog
        orgId={orgId}
        orgName={organization.name}
        open={newPostOpen}
        onOpenChange={setNewPostOpen}
      />
      {isOrgManager && (
        <NewsletterDialog
          orgId={orgId}
          orgName={organization.name}
          open={newsletterOpen}
          onOpenChange={setNewsletterOpen}
        />
      )}
      <FollowListDialog
        open={followersOpen}
        onOpenChange={setFollowersOpen}
        title={formatOrgName(organization.name)}
        variant={{ kind: "org-followers", orgId }}
        members={members.map((m) => ({
          userId: m.userId,
          displayName: m.displayName,
          avatarUrl: m.avatarUrl ?? null,
          role: m.role,
        }))}
      />
      {isOrgManager && (
        <Dialog open={adminQueueOpen} onOpenChange={setAdminQueueOpen}>
          <DialogContent
            className="sm:max-w-lg max-h-[85vh] overflow-y-auto"
            data-testid="dialog-admin-queue"
          >
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 font-black tracking-tight">
                <Shield className="w-4 h-4 text-primary" />
                Admin Queue
              </DialogTitle>
            </DialogHeader>
            <OrgAdminPanel orgId={orgId} hideHeader />
          </DialogContent>
        </Dialog>
      )}
      {isOrgManager && (
        <EditOrgDialog
          organization={organization}
          open={editOpen}
          onOpenChange={setEditOpen}
        />
      )}
      {me?.id && isOrgManager && (
        <ManageMembersDialog
          open={manageMembersOpen}
          onOpenChange={setManageMembersOpen}
          orgId={orgId}
          orgName={organization.name}
          myUserId={me.id}
          myRole={organization.role!}
          onBulkAddCoaches={() => setBulkCoachesOpen(true)}
        />
      )}
      {isOrgManager && (
        <BroadcastComposeDialog
          open={broadcastOpen}
          onOpenChange={setBroadcastOpen}
          target={{
            kind: "organization",
            id: orgId,
            name: organization.name,
          }}
        />
      )}
      {isOrgManager && (
        <OrgPageShareDialog
          orgId={orgId}
          organizationName={organization.name}
          open={sharePageOpen}
          onOpenChange={setSharePageOpen}
        />
      )}
      {isOrgManager && (
        <OrgPreInviteDialog
          orgId={orgId}
          organizationName={organization.name}
          open={preInviteOpen}
          automatic={preInviteAutomatic}
          onOpenChange={(open) => {
            setPreInviteOpen(open);
            if (!open && preInviteAutomatic) {
              setPreInviteAutomatic(false);
              setHandoffAdvance((value) => value + 1);
            }
          }}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
        {/* Main column */}
        <div className="space-y-6 min-w-0">
          {/* Task #836 — persistent re-entry into coach setup while staged
              coach suggestions remain. Hidden while the dialog itself is
              pending/open to avoid a redundant prompt. */}
          {canReopenCoachSetup({
            isOrgManager,
            isUnclaimed,
            stagedCount: stagedCoachCount,
            teamsCount: teams.length,
          }) &&
            !coachSetupPending &&
            !coachSetupOpen && (
              <div
                className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3"
                data-testid="banner-coach-setup"
              >
                <p className="flex-1 text-sm font-medium">
                  {stagedCoachCount === 1
                    ? "1 suggested coach is"
                    : `${stagedCoachCount} suggested coaches are`}{" "}
                  waiting to be invited to your teams.
                </p>
                <Button
                  type="button"
                  variant="brand"
                  size="sm"
                  onClick={() => setCoachSetupOpen(true)}
                  data-testid="btn-open-coach-setup"
                >
                  Review &amp; invite
                </Button>
              </div>
            )}
          {/* Task #850 — red claim CTA when a valid ?claimToken= is present. */}
          <OrgClaimBanner orgId={orgId} />
          {/* Hero */}
          <div className="app-surface relative overflow-hidden bg-card">
            <PersonaPill
              persona="organization"
              size="sm"
              className="!absolute top-3 right-3 z-20 shadow-sm"
            />
            {/* Task #733 — when the org has brand colors set, the hero
                renders a soft gradient of the pair; otherwise the default
                generic gradient. */}
            {(() => {
              const brand = readOrgBrandColors(organization);
              return brand ? (
                <div
                  className="h-32 relative"
                  style={{ background: orgHeroGradient(brand) }}
                  data-testid="org-hero-brand-gradient"
                >
                  {/* Fade the lower edge into the card so the org name /
                      buttons that overlap the hero stay readable on any
                      brand color pair. */}
                  <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-b from-transparent to-card" />
                </div>
              ) : (
                <div className="h-32 bg-gradient-to-br from-primary/30 via-primary/10 to-primary/5 relative" />
              );
            })()}
            <div className="px-4 sm:px-6 pb-4 sm:pb-6 -mt-16 sm:-mt-20 space-y-4 relative z-10">
              <div
                className="flex w-full items-end gap-3 sm:gap-4 min-w-0"
                data-testid="org-header-identity"
              >
                <div className="shrink-0">
                  <AvatarLightbox
                    avatarUrl={organization.logoUrl}
                    displayName={formatOrgName(organization.name)}
                    ariaLabel={`View ${organization.name}'s logo`}
                    triggerClassName="rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    triggerTestId="btn-open-org-logo-lightbox"
                    dialogTestId="dialog-org-logo-lightbox"
                    imageTestId="img-org-logo-lightbox"
                  >
                    <div className="w-24 h-24 sm:w-36 sm:h-36 bg-card rounded-xl shadow-lg border-4 border-card flex items-center justify-center overflow-hidden">
                      <OrgLogo
                        logoUrl={organization.logoUrl}
                        name={organization.name}
                        className="w-full h-full"
                        imgClassName="w-full h-full object-contain"
                      />
                    </div>
                  </AvatarLightbox>
                </div>
                <div className="pb-1 sm:pb-2 min-w-0 flex-1">
                  <FitText
                    as="h1"
                    max={36}
                    min={14}
                    className="font-black tracking-tight"
                  >
                    {formatOrgName(organization.name)}
                  </FitText>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mt-2 font-medium flex-wrap">
                    <span className="font-bold text-foreground">@{organization.slug}</span>
                    {organization.role && (
                      <>
                        <span className="opacity-50">•</span>
                        <span className="font-bold uppercase tracking-wider">
                          {organization.role}
                        </span>
                      </>
                    )}
                    {(() => {
                      const o = organization as {
                        city?: string | null;
                        state?: string | null;
                        zipCode?: string | null;
                      };
                      if (!o.city && !o.state && !o.zipCode) return null;
                      // Render as "City, ST 07090" — falling through to
                      // whichever pieces are present so older orgs that
                      // never collected zip / state keep their existing
                      // "City, ST" rendering.
                      const cityState = [o.city, o.state]
                        .filter(Boolean)
                        .join(", ");
                      const text = [cityState, o.zipCode]
                        .filter(Boolean)
                        .join(" ");
                      return (
                        <>
                          <span className="opacity-50">•</span>
                          <span
                            className="font-medium"
                            data-testid="text-org-address"
                          >
                            {text}
                          </span>
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>
              <div className="w-full">
                {isUnclaimed && (
                  <Badge
                    variant="outline"
                    className="font-bold rounded-full border-amber-400 text-amber-700 dark:text-amber-300"
                    data-testid="badge-org-unclaimed"
                  >
                    Unclaimed
                  </Badge>
                )}
                <div
                  className="flex flex-wrap items-center justify-end gap-2"
                  data-testid="org-header-action-menus"
                >
                  <div data-testid="org-community-actions">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="sm"
                          variant="outline"
                          className="brand-community-trigger rounded-full font-bold focus-visible:ring-[var(--k-magenta)]"
                          data-testid="btn-org-community-menu"
                        >
                          <Users className="w-4 h-4" />
                          Community
                          <ChevronDown className="w-3.5 h-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuItem
                          onClick={onToggleFollow}
                          disabled={followOrg.isPending || unfollowOrg.isPending}
                          data-testid="btn-follow-org"
                        >
                          <Users className="w-4 h-4 mr-2" />
                          {organization.isFollowing ? "Following" : "Follow"}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => setFollowersOpen(true)}
                          data-testid="btn-view-org-followers"
                        >
                          <Users className="w-4 h-4 mr-2" />
                          View{" "}
                          {(organization as { followerCount?: number })
                            .followerCount ?? 0}{" "}
                          followers
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {isOrgManager && (
                    <>
                      <div data-testid="org-guides-actions">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="sm"
                              variant="outline"
                              className="rounded-full border-blue-200 bg-blue-50 font-bold text-blue-800 hover:bg-blue-100 focus-visible:ring-blue-500 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200 dark:hover:bg-blue-950/70"
                              data-testid="btn-org-guides-menu"
                            >
                              <Compass className="w-4 h-4" />
                              Guides
                              <ChevronDown className="w-3.5 h-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56">
                            {orgTourSteps.length > 0 && (
                              <DropdownMenuItem
                                onClick={() => setOrgTourOpen(true)}
                                data-testid="btn-org-replay-tour"
                              >
                                <Compass className="w-4 h-4 mr-2" />
                                Take a page tour
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              asChild
                              data-testid="link-org-getting-started"
                            >
                              <a
                                href="/getting-started.html"
                                target="_blank"
                                rel="noreferrer"
                              >
                                <ExternalLink className="w-4 h-4 mr-2" />
                                Getting started guide
                              </a>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>

                      <div data-testid="org-manager-actions">
                        <DropdownMenu
                          modal={!orgTourOpen}
                          open={manageMenuOpen}
                          onOpenChange={setManageMenuOpen}
                        >
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="sm"
                              variant="outline"
                              className="rounded-full border-purple-200 bg-purple-50 font-bold text-purple-800 hover:bg-purple-100 focus-visible:ring-purple-500 dark:border-purple-800 dark:bg-purple-950/40 dark:text-purple-200 dark:hover:bg-purple-950/70"
                              data-testid="btn-org-manage-menu"
                            >
                              <Shield className="w-4 h-4" />
                              Manage
                              <ChevronDown className="w-3.5 h-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-64">
                            <DropdownMenuItem
                              onClick={() => setEditOpen(true)}
                              data-testid="btn-edit-org"
                            >
                              <Pencil className="w-4 h-4 mr-2" />
                              Edit organization
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setManageMembersOpen(true)}
                              data-testid="btn-manage-admins-hero"
                            >
                              <Shield className="w-4 h-4 mr-2" />
                              Manage members
                            </DropdownMenuItem>
                            {planUsage && (
                              <DropdownMenuItem
                                asChild
                                data-testid="pill-plan-name"
                              >
                                <Link href={`/organizations/${orgId}/subscribe`}>
                                  <Shield className="w-4 h-4 mr-2" />
                                  {PLANS.find((p) => p.id === planUsage.plan)
                                    ?.name ??
                                    planUsage.plan.charAt(0).toUpperCase() +
                                      planUsage.plan.slice(1)}{" "}
                                  plan{" "}
                                  <span
                                    className="font-medium text-muted-foreground"
                                    data-testid="text-plan-usage"
                                  >
                                    {planUsage.teamsLimit == null
                                      ? `· ${planUsage.teamsUsed} teams`
                                      : `· ${planUsage.teamsUsed}/${planUsage.teamsLimit} teams`}
                                  </span>
                                </Link>
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              onClick={() => setAdminQueueOpen(true)}
                              data-testid="btn-org-admin-queue"
                            >
                              <Shield className="w-4 h-4 mr-2" />
                              Admin queue
                              {pendingAdminCount > 0 && (
                                <Badge
                                  className="ml-auto px-1.5 min-w-5 justify-center rounded-full font-bold"
                                  data-testid="badge-admin-queue-count"
                                >
                                  {pendingAdminCount}
                                </Badge>
                              )}
                            </DropdownMenuItem>
                            {isUnclaimed && isPlatformAdmin && (
                              <DropdownMenuItem
                                onClick={() => setStageCoachesOpen(true)}
                                data-testid="btn-stage-coaches"
                              >
                                <UserPlus className="w-4 h-4 mr-2" />
                                Stage coaches
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>

                      <div data-testid="org-communication-actions">
                        <DropdownMenu
                          modal={!orgTourOpen}
                          open={communicationMenuOpen}
                          onOpenChange={setCommunicationMenuOpen}
                        >
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="sm"
                              className="rounded-full border border-blue-800 bg-blue-700 font-bold text-white hover:bg-blue-800 focus-visible:ring-blue-600 dark:border-blue-500 dark:bg-blue-700 dark:hover:bg-blue-600"
                              data-testid="btn-org-communication-menu"
                            >
                              <Mail className="w-4 h-4" />
                              Communication
                              <ChevronDown className="w-3.5 h-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-64">
                            <DropdownMenuItem
                              onClick={() => {
                                setPreInviteAutomatic(false);
                                setPreInviteOpen(true);
                              }}
                              data-testid="btn-org-pre-invite"
                            >
                              <Megaphone className="w-4 h-4 mr-2" />
                              Pre-invite message
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              asChild
                            >
                              <Link
                                href={`/organizations/${orgId}/roster-outreach`}
                                className="flex items-center w-full cursor-pointer"
                              >
                                <span
                                  className="flex items-center"
                                  data-testid="btn-org-roster-outreach"
                                >
                                  <Mail className="w-4 h-4 mr-2" />
                                  Roster outreach
                                </span>
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setBroadcastOpen(true)}
                              data-testid="btn-org-broadcast"
                            >
                              <Megaphone className="w-4 h-4 mr-2" />
                              Send announcement
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setSharePageOpen(true)}
                              data-testid="btn-share-org-page"
                            >
                              <Share2 className="w-4 h-4 mr-2" />
                              Share page
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>

                    </>
                  )}
                </div>
              </div>
            </div>
            {(organization.description || organization.website) && (
              <div className="px-4 sm:px-6 pb-4 sm:pb-6">
                {organization.description && (
                  <OrganizationDescription
                    description={organization.description}
                    organizationName={organization.name}
                  />
                )}
                {organization.website && (
                  <a
                    href={organization.website}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-bold text-primary mt-2 inline-block hover:underline"
                    data-testid="link-org-website"
                  >
                    {organization.website}
                  </a>
                )}
              </div>
            )}
          </div>

          {isOrgManager && (
            <OrgSetupChecklist
              orgId={orgId}
              actions={{
                onEditLogo: () => setEditOpen(true),
                onCreateTeam: () => setCreateTeamOpen(true),
                onManageMembers: () => setManageMembersOpen(true),
                onPromoteAdmin: () => setManageMembersOpen(true),
                onGoToTeams: () => {
                  // Scroll the teams rail / inline teams section into view,
                  // expanding it first if it's collapsed (mobile default).
                  const toggle = document.querySelector<HTMLButtonElement>(
                    '[data-testid="btn-toggle-teams"][aria-expanded="false"]',
                  );
                  if (toggle) toggle.click();
                  const el = document.querySelector(
                    '[data-testid="rail-teams"]',
                  );
                  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                },
              }}
            />
          )}

          {/* Teams + archived: inline on mobile, in rail on lg+. The
              hook ensures only one instance mounts at a time so testids
              stay unique. */}
          {!isLg && (
            <div className="space-y-4">
              <TeamsRail
                teams={teams}
                canManage={isOrgManager}
                atLimit={atTeamLimit}
                onAddTeam={() => setCreateTeamOpen(true)}
                onBulkAddTeams={() => setBulkTeamsOpen(true)}
                onBulkAddCoaches={() => setBulkCoachesOpen(true)}
                defaultOpen={false}
              />
              {isOrgManager && archivedTeams.length > 0 && (
                <ArchivedTeamsCard teams={archivedTeams} defaultOpen={false} />
              )}
            </div>
          )}

          {/* Task #548 — Roles & permissions reference, visible to any
              org member (the checklist card already includes the same
              accordion for owners/admins, so this only renders for
              non-managers to avoid duplication). */}
          {!isOrgManager && organization.role && <RolesPermissionsCard />}

          {/* Posts */}
          <section data-testid="org-posts">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
              <h2 className="text-xl font-black tracking-tight">Recent Posts</h2>
              {isOrgManager && (
                <div
                  className="flex items-center gap-2 flex-wrap"
                  data-testid="org-post-actions"
                >
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground mr-1">
                    Publish
                  </span>
                  <Button
                    size="sm"
                    onClick={() => setNewPostOpen(true)}
                    className="font-bold rounded-full"
                    data-testid="btn-new-org-post"
                  >
                    <Plus className="w-4 h-4 mr-1" /> New post
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setNewsletterOpen(true)}
                    className="font-bold rounded-full"
                    data-testid="btn-org-newsletter"
                  >
                    <Newspaper className="w-4 h-4 mr-1" /> Newsletter
                  </Button>
                </div>
              )}
            </div>
            <div className="space-y-3">
              {posts.length > 0 ? (
                <>
                  {posts.map((p) => (
                    <PostCard key={p.id} post={p} />
                  ))}
                  {/* Task #785 — auto-load older posts on scroll; on
                      fetch failure, pause and offer a manual retry. */}
                  {hasMorePosts &&
                    (fetchMorePostsFailed ? (
                      <div className="flex flex-col items-center gap-2 py-3">
                        <span className="text-xs text-muted-foreground">
                          Couldn't load older posts.
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => fetchMorePosts()}
                          disabled={isFetchingMorePosts}
                          data-testid="btn-retry-load-more-org-posts"
                        >
                          Retry loading older posts
                        </Button>
                      </div>
                    ) : (
                      <div
                        ref={orgPostsSentinelRef}
                        className="flex justify-center py-3"
                        data-testid="sentinel-load-more-org-posts"
                      >
                        {isFetchingMorePosts && (
                          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                            Loading older posts…
                          </span>
                        )}
                      </div>
                    ))}
                </>
              ) : (
                <Card className="rounded-xl border border-border">
                  <CardContent className="p-6 text-center text-sm text-muted-foreground space-y-3">
                    <p>No posts yet.</p>
                    {isOrgManager && (
                      <Button
                        size="sm"
                        onClick={() => setNewPostOpen(true)}
                        className="font-bold rounded-full"
                        data-testid="btn-empty-new-org-post"
                      >
                        <Plus className="w-4 h-4 mr-1" /> Be the first to post
                      </Button>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          </section>
        </div>

        {/* Right rail (lg+ only — on mobile this renders inline above) */}
        {isLg && (
          <aside className="lg:sticky lg:top-20 lg:self-start space-y-4">
            <TeamsRail
              teams={teams}
              canManage={isOrgManager}
              atLimit={atTeamLimit}
              onAddTeam={() => setCreateTeamOpen(true)}
              onBulkAddTeams={() => setBulkTeamsOpen(true)}
              onBulkAddCoaches={() => setBulkCoachesOpen(true)}
            />
            {isOrgManager && archivedTeams.length > 0 && (
              <ArchivedTeamsCard teams={archivedTeams} defaultOpen={false} />
            )}
          </aside>
        )}
      </div>
      {orgTourOpen && orgTourSteps.length > 0 && (
        <SpotlightTour steps={orgTourSteps} onFinish={finishOrgTour} />
      )}
    </>
  );
}

function TeamsRail({
  teams,
  canManage,
  atLimit = false,
  onAddTeam,
  onBulkAddTeams,
  onBulkAddCoaches,
  defaultOpen = true,
}: {
  teams: TeamRailItem[];
  canManage: boolean;
  atLimit?: boolean;
  onAddTeam: () => void;
  onBulkAddTeams: () => void;
  onBulkAddCoaches: () => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [query, setQuery] = useState("");
  const {
    pinnedSet,
    pinnedIds,
    togglePin,
    enabled: pinEnabled,
  } = usePinnedTeams();

  const q = query.trim().toLowerCase();
  const filteredTeams = q
    ? teams.filter((t) => (t.name ?? "").toLowerCase().includes(q))
    : teams;
  // Pinned teams (the viewer's own personalization) float to the top, in pin
  // order, within whatever the current search shows.
  const pinnedOrder = new Map(pinnedIds.map((id, i) => [id, i] as const));
  const sortedTeams = [...filteredTeams].sort((a, b) => {
    const ap = pinnedSet.has(a.id);
    const bp = pinnedSet.has(b.id);
    if (ap && bp) {
      return (pinnedOrder.get(a.id) ?? 0) - (pinnedOrder.get(b.id) ?? 0);
    }
    if (ap) return -1;
    if (bp) return 1;
    return 0;
  });
  const pinnedCount = pinEnabled
    ? sortedTeams.filter((t) => pinnedSet.has(t.id)).length
    : 0;

  return (
    <Card
      className="rounded-xl border border-border shadow-sm overflow-hidden"
      data-testid="rail-teams"
    >
      <div
        className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 ${open ? "border-b border-border" : ""}`}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 min-w-0 text-left"
          aria-expanded={open}
          data-testid="btn-toggle-teams"
        >
          <Shield className="w-5 h-5 text-primary shrink-0" />
          <h2 className="text-base font-black tracking-tight truncate">
            Teams
          </h2>
          <Badge
            variant="outline"
            className="text-[10px] uppercase tracking-wider font-bold"
            data-testid="rail-teams-count"
          >
            {teams.length}
          </Badge>
          <ChevronDown
            className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
        {canManage && (
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <Button
              variant="outline"
              size="sm"
              className="font-bold rounded-full"
              onClick={onBulkAddTeams}
              disabled={atLimit}
              title={
                atLimit
                  ? "You've reached your plan's team limit. Upgrade to add more."
                  : undefined
              }
              data-testid="btn-bulk-add-teams"
            >
              <ListPlus className="w-4 h-4 mr-1" /> Bulk add
            </Button>
            {/* Task #835 — invite one coach per existing team. Not gated on
                the team limit: it doesn't create teams. */}
            <Button
              variant="outline"
              size="sm"
              className="font-bold rounded-full"
              onClick={onBulkAddCoaches}
              data-testid="btn-bulk-add-coaches"
            >
              <UserPlus className="w-4 h-4 mr-1" /> Bulk add coach
            </Button>
            <Button
              variant="brand"
              size="sm"
              onClick={onAddTeam}
              disabled={atLimit}
              title={
                atLimit
                  ? "You've reached your plan's team limit. Upgrade to add more."
                  : undefined
              }
              data-testid="btn-add-team"
            >
              <Plus className="w-4 h-4 mr-1" /> Add team
            </Button>
          </div>
        )}
      </div>

      {!open ? null : teams.length === 0 ? (
        <div className="p-8 text-center">
          <Building2 className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No teams yet.</p>
        </div>
      ) : (
        <>
          <div className="px-2 pt-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search teams…"
                className="pl-8 pr-8 h-9"
                data-testid="input-search-teams"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Clear team search"
                  data-testid="btn-clear-team-search"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
          {filteredTeams.length === 0 ? (
            <div className="p-8 text-center">
              <Search className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">
                No teams match “{query.trim()}”.
              </p>
            </div>
          ) : (
          <div
            className="overflow-y-auto scrollbar-thin max-h-[calc(100vh-14rem)]"
          >
            <div className="flex flex-col gap-2 p-2">
              {pinnedCount > 0 && (
                <PinnedSectionLabel
                  label="Pinned"
                  showStar
                  testId="pinned-divider-org"
                />
              )}
              {sortedTeams.map((team, i) => (
                <Fragment key={team.id}>
                  {pinnedCount > 0 &&
                    i === pinnedCount &&
                    pinnedCount < sortedTeams.length && (
                      <PinnedSectionLabel label="All teams" />
                    )}
                  <Link href={`/teams/${team.id}?showAround=1`}>
                    <div
                      className="rounded-lg overflow-hidden border border-border hover:border-primary/40 hover:shadow-md cursor-pointer group transition-all"
                      data-testid={`card-team-${team.id}`}
                    >
                    {/* Banner visual: team-specific photo if set, otherwise
                        the same gradient empty-state used by the team-page
                        hero so branding stays consistent. */}
                    <div className="relative h-20 bg-gradient-to-br from-primary/30 via-primary/10 to-primary/5">
                      {team.bannerUrl && (
                        <img
                          src={team.bannerUrl}
                          alt={`${team.name} background`}
                          className="absolute inset-0 w-full h-full object-cover"
                          data-testid={`img-team-banner-${team.id}`}
                        />
                      )}
                    </div>
                    <div className="p-2.5">
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <h3 className="font-bold text-sm truncate group-hover:text-primary transition-colors">
                            {team.name}
                          </h3>
                          {team.sport && (
                            <Badge
                              variant="outline"
                              className="text-[10px] uppercase tracking-wider font-bold shrink-0"
                            >
                              {team.sport}
                            </Badge>
                          )}
                        </div>
                        {pinEnabled && (
                          <PinTeamButton
                            teamId={team.id}
                            pinned={pinnedSet.has(team.id)}
                            onToggle={(id) =>
                              togglePin(
                                id,
                                teams.map((x) => x.id),
                              )
                            }
                            className="-mr-1"
                          />
                        )}
                      </div>
                      <div className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground mt-0.5">
                        <Users className="w-3 h-3" />
                        {team.followerCount ?? 0} Followers
                      </div>
                    </div>
                    </div>
                  </Link>
                </Fragment>
              ))}
            </div>
          </div>
          )}
        </>
      )}
    </Card>
  );
}

export function ArchivedTeamsCard({
  teams,
  defaultOpen = false,
}: {
  teams: TeamRailItem[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card
      className="rounded-xl border border-border shadow-sm overflow-hidden"
      data-testid="section-archived-teams"
    >
      <div
        className={`flex items-center justify-between gap-2 px-4 py-3 ${open ? "border-b border-border" : ""}`}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 min-w-0 text-left"
          aria-expanded={open}
          data-testid="btn-toggle-archived-teams"
        >
          <Archive className="w-5 h-5 text-muted-foreground shrink-0" />
          <h2 className="text-base font-black tracking-tight truncate">
            Archived teams
          </h2>
          <Badge
            variant="outline"
            className="text-[10px] uppercase tracking-wider font-bold"
          >
            {teams.length}
          </Badge>
          <ChevronDown
            className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      </div>
      {open && (
      <CardContent className="p-2">
        <div className="flex flex-col divide-y divide-border">
          {teams.map((t) => (
            <Link key={t.id} href={`/teams/${t.id}?showAround=1`}>
              <div
                className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-muted/40 rounded-lg cursor-pointer"
                data-testid={`card-archived-team-${t.id}`}
              >
                <div className="min-w-0">
                  <p className="font-bold text-sm truncate">{t.name}</p>
                  {t.sport && (
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-bold">
                      {t.sport}
                    </p>
                  )}
                </div>
                <Badge
                  variant="outline"
                  className="text-[10px] uppercase tracking-wider font-bold shrink-0"
                >
                  Archived
                </Badge>
              </div>
            </Link>
          ))}
        </div>
      </CardContent>
      )}
    </Card>
  );
}
