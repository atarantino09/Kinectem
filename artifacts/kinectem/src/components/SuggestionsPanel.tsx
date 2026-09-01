import { useEffect, useRef, useState } from "react";
import { formatOrgName } from "@/lib/format";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListFollowSuggestions,
  useFollowOrg,
  useFollowTeam,
  useFollowUser,
  getListFollowSuggestionsQueryKey,
  getListFeedQueryKey,
  customFetch,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/UserAvatar";
import { Building2, Users, UserCheck, Trophy } from "lucide-react";
import { OrgLogo } from "@/components/OrgLogoFallback";
import { cn } from "@/lib/utils";

type Variant = "full" | "compact";
type Section = "users" | "organizations" | "teams" | "competitions";

// Extra-spec field on /posts/follow-suggestions (openapi.yaml is locked):
// competitions your teams — or your children's teams — are entered in.
interface SuggestedCompetition {
  id: string;
  slug: string;
  name: string;
  type: string;
  startDate: string;
  endDate: string;
  location: string | null;
  logoUrl: string | null;
  brandColor: string | null;
}

export interface SuggestionsPanelProps {
  variant?: Variant;
  heading?: string;
  subheading?: string;
  perSectionLimit?: number;
  hideWhenEmpty?: boolean;
  /**
   * When set, restricts the (compact) panel to a single suggestion type.
   * Only takes effect for `variant="compact"`. The `full` variant always
   * renders all three sections together.
   */
  section?: Section;
}

export function SuggestionsPanel({
  variant = "full",
  heading,
  subheading,
  perSectionLimit,
  hideWhenEmpty = false,
  section,
}: SuggestionsPanelProps = {}) {
  const { data, isLoading } = useListFollowSuggestions();
  const qc = useQueryClient();
  const { toast } = useToast();
  const followOrg = useFollowOrg();
  const followTeam = useFollowTeam();
  const followUser = useFollowUser();
  const [followingComp, setFollowingComp] = useState(false);

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: getListFollowSuggestionsQueryKey() }),
      qc.invalidateQueries({ queryKey: getListFeedQueryKey() }),
    ]);
  };

  const handleFollowOrg = async (orgId: string) => {
    try {
      await followOrg.mutateAsync({ orgId });
      await refresh();
    } catch (err) {
      toast({ title: "Couldn't follow", variant: "destructive" });
      throw err;
    }
  };
  const handleFollowTeam = async (teamId: string) => {
    try {
      await followTeam.mutateAsync({ teamId });
      await refresh();
    } catch (err) {
      toast({ title: "Couldn't follow", variant: "destructive" });
      throw err;
    }
  };
  const handleFollowUser = async (userId: string) => {
    try {
      await followUser.mutateAsync({ userId });
      await refresh();
    } catch (err) {
      toast({ title: "Couldn't follow", variant: "destructive" });
      throw err;
    }
  };
  const handleFollowCompetition = async (slug: string) => {
    setFollowingComp(true);
    try {
      await customFetch(`/api/v1/competitions/${slug}/follow`, {
        method: "POST",
      });
      await refresh();
    } catch (err) {
      toast({ title: "Couldn't follow", variant: "destructive" });
      throw err;
    } finally {
      setFollowingComp(false);
    }
  };

  if (isLoading) {
    if (hideWhenEmpty && variant === "compact") {
      return (
        <Card className="rounded-xl border border-border">
          <CardContent className="p-4 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      );
    }
    return (
      <Card className="app-surface app-surface-interactive">
        <CardContent className="p-8 space-y-3">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    );
  }

  const limit = (arr: unknown[]) =>
    perSectionLimit ? arr.slice(0, perSectionLimit) : arr;
  // `section` only narrows the compact variant; the full variant always
  // renders all three sections together (used by the empty-feed state).
  const activeSection = variant === "compact" ? section : undefined;
  const showOrgs = !activeSection || activeSection === "organizations";
  const showTeams = !activeSection || activeSection === "teams";
  const showUsers = !activeSection || activeSection === "users";
  const showComps = !activeSection || activeSection === "competitions";
  const orgs = (
    showOrgs ? limit(data?.organizations ?? []) : []
  ) as NonNullable<typeof data>["organizations"];
  const teams = (showTeams ? limit(data?.teams ?? []) : []) as NonNullable<
    typeof data
  >["teams"];
  const users = (showUsers ? limit(data?.users ?? []) : []) as NonNullable<
    typeof data
  >["users"];
  const allComps =
    ((data as { competitions?: SuggestedCompetition[] } | undefined)
      ?.competitions ?? []) as SuggestedCompetition[];
  const comps = (showComps ? limit(allComps) : []) as SuggestedCompetition[];
  const empty =
    orgs.length === 0 &&
    teams.length === 0 &&
    users.length === 0 &&
    comps.length === 0;

  if (empty) {
    if (hideWhenEmpty) return null;
    return (
      <Card className="app-surface">
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          Your feed is quiet. Follow organizations or athletes to see updates here.
        </CardContent>
      </Card>
    );
  }

  if (variant === "compact") {
    return (
      <Card className="rounded-xl border border-border">
        <CardContent className="p-4">
          <div className="mb-3">
            <h4 className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
              {heading ?? "People to follow"}
            </h4>
            {subheading && (
              <p className="text-xs text-muted-foreground mt-1">{subheading}</p>
            )}
          </div>
          <div className="space-y-3">
            {users.map((u) => {
              const name = `${u.firstName} ${u.lastName}`.trim();
              return (
                <CompactRow
                  key={`u-${u.id}`}
                  href={`/users/${u.id}`}
                  avatar={
                    <UserAvatar
                      avatarUrl={u.avatarUrl}
                      displayName={name}
                      size="md"
                      fallbackClassName="bg-slate-100 text-slate-800"
                    />
                  }
                  title={name}
                  subtitle={u.bio ?? undefined}
                  onFollow={() => handleFollowUser(u.id)}
                  disabled={followUser.isPending}
                  testId={`button-follow-suggested-user-${u.id}`}
                />
              );
            })}
            {orgs.map((o) => (
              <CompactRow
                key={`o-${o.id}`}
                href={`/organizations/${o.id}`}
                avatar={
                  <OrgLogoThumb
                    logoUrl={o.logoUrl}
                    orgName={o.name}
                    orgId={o.id}
                    size="sm"
                  />
                }
                title={formatOrgName(o.name)}
                subtitle={o.description ?? undefined}
                onFollow={() => handleFollowOrg(o.id)}
                disabled={followOrg.isPending}
                testId={`button-follow-suggested-org-${o.id}`}
              />
            ))}
            {teams.map((t) => (
              <CompactRow
                key={`t-${t.id}`}
                href={`/teams/${t.id}`}
                avatar={
                  <TeamBannerThumb
                    bannerUrl={t.bannerUrl}
                    teamName={t.name}
                    teamId={t.id}
                    size="sm"
                  />
                }
                title={t.name}
                subtitle={
                  t.organization
                    ? formatOrgName(t.organization.name)
                    : "Independent team"
                }
                onFollow={() => handleFollowTeam(t.id)}
                disabled={followTeam.isPending}
                testId={`button-follow-suggested-team-${t.id}`}
              />
            ))}
            {comps.map((c) => (
              <CompactRow
                key={`c-${c.id}`}
                href={`/competitions/c/${c.slug}`}
                avatar={<CompetitionThumb comp={c} size="sm" />}
                title={c.name}
                subtitle={competitionSubtitle(c)}
                onFollow={() => handleFollowCompetition(c.slug)}
                disabled={followingComp}
                testId={`button-follow-suggested-competition-${c.id}`}
              />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-xl border border-border">
      <CardContent className="p-6 space-y-6">
        <div>
          <h3 className="font-black text-base tracking-tight">
            {heading ?? "Your feed is quiet"}
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            {subheading ??
              "Follow a few organizations, teams, or athletes to start seeing updates here."}
          </p>
        </div>

        {orgs.length > 0 && (
          <SuggestionSection
            title="Organizations"
            icon={<Building2 className="w-4 h-4" />}
          >
            {orgs.map((org) => (
              <SuggestionRow
                key={org.id}
                href={`/organizations/${org.id}`}
                avatar={
                  <OrgLogoThumb
                    logoUrl={org.logoUrl}
                    orgName={org.name}
                    orgId={org.id}
                    size="md"
                  />
                }
                title={formatOrgName(org.name)}
                subtitle={org.description ?? undefined}
                onFollow={() => handleFollowOrg(org.id)}
                disabled={followOrg.isPending}
                testId={`button-follow-suggested-org-${org.id}`}
              />
            ))}
          </SuggestionSection>
        )}

        {teams.length > 0 && (
          <SuggestionSection
            title="Teams"
            icon={<Users className="w-4 h-4" />}
          >
            {teams.map((team) => (
              <SuggestionRow
                key={team.id}
                href={`/teams/${team.id}`}
                avatar={
                  <TeamBannerThumb
                    bannerUrl={team.bannerUrl}
                    teamName={team.name}
                    teamId={team.id}
                    size="md"
                  />
                }
                title={team.name}
                subtitle={
                  team.organization
                    ? formatOrgName(team.organization.name)
                    : "Independent team"
                }
                onFollow={() => handleFollowTeam(team.id)}
                disabled={followTeam.isPending}
                testId={`button-follow-suggested-team-${team.id}`}
              />
            ))}
          </SuggestionSection>
        )}

        {comps.length > 0 && (
          <SuggestionSection
            title="Competitions"
            icon={<Trophy className="w-4 h-4" />}
          >
            {comps.map((c) => (
              <SuggestionRow
                key={c.id}
                href={`/competitions/c/${c.slug}`}
                avatar={<CompetitionThumb comp={c} size="md" />}
                title={c.name}
                subtitle={competitionSubtitle(c)}
                onFollow={() => handleFollowCompetition(c.slug)}
                disabled={followingComp}
                testId={`button-follow-suggested-competition-${c.id}`}
              />
            ))}
          </SuggestionSection>
        )}

        {users.length > 0 && (
          <SuggestionSection
            title="Athletes & Coaches"
            icon={<UserCheck className="w-4 h-4" />}
          >
            {users.map((u) => {
              const name = `${u.firstName} ${u.lastName}`.trim();
              return (
                <SuggestionRow
                  key={u.id}
                  href={`/users/${u.id}`}
                  avatar={
                    <UserAvatar
                      avatarUrl={u.avatarUrl}
                      displayName={name}
                      size="lg"
                      fallbackClassName="bg-slate-100 text-slate-800"
                    />
                  }
                  title={name}
                  subtitle={u.bio ?? undefined}
                  onFollow={() => handleFollowUser(u.id)}
                  disabled={followUser.isPending}
                  testId={`button-follow-suggested-user-${u.id}`}
                />
              );
            })}
          </SuggestionSection>
        )}
      </CardContent>
    </Card>
  );
}

function SuggestionSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
       <h4 className="app-section-heading mb-2 text-muted-foreground">
        {icon}
        {title}
      </h4>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

/**
 * Drives the "fade out + collapse, then follow" interaction for a suggestion
 * row. On click the row animates out for 300ms before the follow mutation
 * fires; if the mutation rejects, the row is restored so it can be retried.
 * The pending timer is cleared on unmount to avoid a follow firing after the
 * row is gone.
 */
function useFollowExit(onFollow: () => void | Promise<void>) {
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);
  const handleFollow = () => {
    if (exiting) return;
    setExiting(true);
    timerRef.current = window.setTimeout(async () => {
      try {
        await onFollow();
      } catch {
        if (mountedRef.current) setExiting(false);
      }
    }, 300);
  };
  return { exiting, handleFollow };
}

function SuggestionRow({
  href,
  avatar,
  title,
  subtitle,
  onFollow,
  disabled,
  testId,
}: {
  href: string;
  avatar: React.ReactNode;
  title: string;
  subtitle?: string;
  onFollow: () => void | Promise<void>;
  disabled: boolean;
  testId: string;
}) {
  const { exiting, handleFollow } = useFollowExit(onFollow);
  return (
    <div
      className={cn(
        "overflow-hidden transition-all duration-300 ease-out animate-in fade-in slide-in-from-bottom-1",
        exiting ? "max-h-0 opacity-0 -translate-x-3" : "max-h-32 opacity-100",
      )}
    >
      <div className="flex items-center gap-3 py-1.5">
        <Link href={href} className="shrink-0">
          {avatar}
        </Link>
        <div className="flex-1 min-w-0">
          <Link href={href}>
            <p className="font-bold text-sm leading-tight truncate hover:text-primary cursor-pointer">
              {title}
            </p>
          </Link>
          {subtitle && (
            <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
              {subtitle}
            </p>
          )}
        </div>
        <Button
          variant="brand"
          size="sm"
          className="shrink-0"
          onClick={handleFollow}
          disabled={disabled || exiting}
          data-testid={testId}
        >
          {exiting ? "Following" : "Follow"}
        </Button>
      </div>
    </div>
  );
}

function CompactRow({
  href,
  avatar,
  title,
  subtitle,
  onFollow,
  disabled,
  testId,
}: {
  href: string;
  avatar: React.ReactNode;
  title: string;
  subtitle?: string;
  onFollow: () => void | Promise<void>;
  disabled: boolean;
  testId: string;
}) {
  const { exiting, handleFollow } = useFollowExit(onFollow);
  return (
    <div
      className={cn(
        "overflow-hidden transition-all duration-300 ease-out animate-in fade-in slide-in-from-bottom-1",
        exiting ? "max-h-0 opacity-0 -translate-x-3" : "max-h-24 opacity-100",
      )}
    >
      <div className="flex items-center gap-2.5">
        <Link href={href} className="shrink-0">
          {avatar}
        </Link>
        <div className="flex-1 min-w-0">
          <Link href={href}>
            <p className="font-bold text-xs leading-tight truncate hover:text-primary cursor-pointer">
              {title}
            </p>
          </Link>
          {subtitle && (
            <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
              {subtitle}
            </p>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2.5 text-[11px] font-bold shrink-0"
          onClick={handleFollow}
          disabled={disabled || exiting}
          data-testid={testId}
        >
          {exiting ? "Following" : "Follow"}
        </Button>
      </div>
    </div>
  );
}

function competitionSubtitle(c: SuggestedCompetition): string {
  const kind = c.type === "league" ? "League" : "Tournament";
  return c.location ? `${kind} · ${c.location}` : kind;
}

/**
 * Logo/brand-color thumbnail for competition suggestion rows — mirrors the
 * competition page hero (logo on brand color, trophy fallback).
 */
function CompetitionThumb({
  comp,
  size,
}: {
  comp: SuggestedCompetition;
  size: "sm" | "md";
}) {
  const sizeClass = size === "sm" ? "w-9 h-9" : "w-10 h-10";
  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-lg border border-border overflow-hidden shrink-0",
        sizeClass,
      )}
      style={{ backgroundColor: comp.brandColor ?? "#0f172a" }}
    >
      {comp.logoUrl ? (
        <img
          src={comp.logoUrl}
          alt={`${comp.name} logo`}
          className="w-full h-full object-contain"
          data-testid={`img-suggested-competition-logo-${comp.id}`}
        />
      ) : (
        <Trophy className="w-4 h-4 text-white/90" />
      )}
    </div>
  );
}

/**
 * Tiny banner-cropped thumbnail for team suggestion rows. Uses the team's
 * editable `bannerUrl` (cover-cropped) to mirror the team-page hero, with
 * the same gradient empty-state when no banner has been uploaded.
 */
function TeamBannerThumb({
  bannerUrl,
  teamName,
  teamId,
  size,
}: {
  bannerUrl?: string | null;
  teamName: string;
  teamId: string;
  size: "sm" | "md";
}) {
  const sizeClass = size === "sm" ? "w-12 h-9" : "w-16 h-10";
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [bannerUrl]);
  return (
    <div
      className={cn(
        "relative rounded-md overflow-hidden border border-border shrink-0 bg-gradient-to-br from-primary/30 via-primary/10 to-primary/5",
        sizeClass,
      )}
    >
      {bannerUrl && !failed && (
        <img
          src={bannerUrl}
          alt={`${teamName} background`}
          onError={() => setFailed(true)}
          className="absolute inset-0 w-full h-full object-cover"
          data-testid={`img-suggested-team-banner-${teamId}`}
        />
      )}
    </div>
  );
}

/**
 * Square org logo thumbnail for suggestion rows. Renders the uploaded
 * `logoUrl` when available, falling back to the existing colored-initials
 * tile (and also falling back if the image fails to load) so the layout
 * never shifts.
 */
function OrgLogoThumb({
  logoUrl,
  orgName,
  orgId,
  size,
}: {
  logoUrl?: string | null;
  orgName: string;
  orgId: string;
  size: "sm" | "md";
}) {
  const sizeClass = size === "sm" ? "w-9 h-9" : "w-10 h-10";
  return (
    <OrgLogo
      logoUrl={logoUrl}
      name={orgName}
      data-testid={`img-suggested-org-logo-${orgId}`}
      className={cn("rounded-lg shrink-0", sizeClass)}
      imgClassName={cn(
        "rounded-lg object-contain border border-border bg-muted shrink-0",
        sizeClass,
      )}
    />
  );
}
