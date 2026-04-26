import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListFollowSuggestions,
  useFollowOrg,
  useFollowTeam,
  useFollowUser,
  getListFollowSuggestionsQueryKey,
  getListFeedQueryKey,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { UserAvatar, TeamAvatar } from "@/components/UserAvatar";
import { Building2, Users, UserCheck } from "lucide-react";
import { getInitials } from "@/lib/format";

type Variant = "full" | "compact";

export interface SuggestionsPanelProps {
  variant?: Variant;
  heading?: string;
  subheading?: string;
  perSectionLimit?: number;
  hideWhenEmpty?: boolean;
}

export function SuggestionsPanel({
  variant = "full",
  heading,
  subheading,
  perSectionLimit,
  hideWhenEmpty = false,
}: SuggestionsPanelProps = {}) {
  const { data, isLoading } = useListFollowSuggestions();
  const qc = useQueryClient();
  const { toast } = useToast();
  const followOrg = useFollowOrg();
  const followTeam = useFollowTeam();
  const followUser = useFollowUser();

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
    } catch {
      toast({ title: "Couldn't follow", variant: "destructive" });
    }
  };
  const handleFollowTeam = async (teamId: string) => {
    try {
      await followTeam.mutateAsync({ teamId });
      await refresh();
    } catch {
      toast({ title: "Couldn't follow", variant: "destructive" });
    }
  };
  const handleFollowUser = async (userId: string) => {
    try {
      await followUser.mutateAsync({ userId });
      await refresh();
    } catch {
      toast({ title: "Couldn't follow", variant: "destructive" });
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
      <Card className="rounded-xl border border-border">
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
  const orgs = limit(data?.organizations ?? []) as NonNullable<
    typeof data
  >["organizations"];
  const teams = limit(data?.teams ?? []) as NonNullable<typeof data>["teams"];
  const users = limit(data?.users ?? []) as NonNullable<typeof data>["users"];
  const empty = orgs.length === 0 && teams.length === 0 && users.length === 0;

  if (empty) {
    if (hideWhenEmpty) return null;
    return (
      <Card className="rounded-xl border border-border">
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
                  <div className="w-9 h-9 rounded-lg brand-gradient-dark flex items-center justify-center text-primary font-black text-[10px] shrink-0">
                    {getInitials(o.name)}
                  </div>
                }
                title={o.name}
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
                  <TeamAvatar
                    avatarUrl={t.avatarUrl}
                    displayName={t.name}
                    size="md"
                    rounded="full"
                    fallbackClassName="bg-slate-100 text-slate-800"
                  />
                }
                title={t.name}
                subtitle={t.organization.name}
                onFollow={() => handleFollowTeam(t.id)}
                disabled={followTeam.isPending}
                testId={`button-follow-suggested-team-${t.id}`}
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
                  <div className="w-10 h-10 rounded-lg brand-gradient-dark flex items-center justify-center text-primary font-black text-xs shrink-0">
                    {getInitials(org.name)}
                  </div>
                }
                title={org.name}
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
                  <TeamAvatar
                    avatarUrl={team.avatarUrl}
                    displayName={team.name}
                    size="lg"
                    rounded="full"
                    fallbackClassName="bg-slate-100 text-slate-800"
                  />
                }
                title={team.name}
                subtitle={team.organization.name}
                onFollow={() => handleFollowTeam(team.id)}
                disabled={followTeam.isPending}
                testId={`button-follow-suggested-team-${team.id}`}
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
      <h4 className="text-[11px] font-black uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1.5">
        {icon}
        {title}
      </h4>
      <div className="space-y-2">{children}</div>
    </div>
  );
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
  onFollow: () => void;
  disabled: boolean;
  testId: string;
}) {
  return (
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
        size="sm"
        className="font-bold shrink-0"
        onClick={onFollow}
        disabled={disabled}
        data-testid={testId}
      >
        Follow
      </Button>
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
  onFollow: () => void;
  disabled: boolean;
  testId: string;
}) {
  return (
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
        onClick={onFollow}
        disabled={disabled}
        data-testid={testId}
      >
        Follow
      </Button>
    </div>
  );
}
