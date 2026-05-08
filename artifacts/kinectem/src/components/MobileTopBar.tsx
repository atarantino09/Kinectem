import { Link, useLocation } from "wouter";
import {
  useListUserOrganizations,
  useListUserTeams,
  queryOpts,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { NotificationsBell } from "@/components/NotificationsBell";
import { Bell, Mail, Menu, Search } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  meId: string | undefined;
  unreadCount: number;
  onOpenNav: () => void;
};

type Chip = {
  key: string;
  href: string;
  label: string;
  avatarUrl: string | null | undefined;
  initials: string;
  testId: string;
};

function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function MobileTopBar({ meId, unreadCount, onOpenNav }: Props) {
  const [, setLocation] = useLocation();
  const { data: orgsResp } = useListUserOrganizations(meId ?? "", undefined, {
    query: queryOpts({ enabled: !!meId }),
  });
  const { data: teamsResp } = useListUserTeams(meId ?? "", undefined, {
    query: queryOpts({ enabled: !!meId }),
  });

  // Affiliation priority: first org affiliation, then first rostered team.
  // Falls through to a second org chip only when no team exists, so the
  // common case of "one org + one team" gets exactly one of each.
  const chips: Chip[] = [];
  const orgs = orgsResp?.data ?? [];
  const teams = teamsResp?.data ?? [];
  const firstOrg = orgs[0];
  const firstTeam = teams[0];
  if (firstOrg) {
    chips.push({
      key: `org-${firstOrg.id}`,
      href: `/organizations/${firstOrg.id}`,
      label: firstOrg.name,
      avatarUrl: firstOrg.logoUrl,
      initials: initialsOf(firstOrg.name) || "O",
      testId: `mobile-top-chip-org-${firstOrg.id}`,
    });
  }
  if (firstTeam) {
    chips.push({
      key: `team-${firstTeam.teamId}`,
      href: `/teams/${firstTeam.teamId}`,
      label: firstTeam.teamName,
      avatarUrl: firstTeam.teamAvatarUrl,
      initials: initialsOf(firstTeam.teamName) || "T",
      testId: `mobile-top-chip-team-${firstTeam.teamId}`,
    });
  } else if (orgs[1]) {
    const o = orgs[1];
    chips.push({
      key: `org-${o.id}`,
      href: `/organizations/${o.id}`,
      label: o.name,
      avatarUrl: o.logoUrl,
      initials: initialsOf(o.name) || "O",
      testId: `mobile-top-chip-org-${o.id}`,
    });
  }

  return (
    <header
      data-testid="mobile-top-bar"
      className="sticky top-0 z-30 border-b border-border bg-background md:hidden"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="flex items-center justify-between px-3 h-14 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenNav}
            aria-label="Open navigation menu"
            data-testid="mobile-top-menu"
            className="shrink-0"
          >
            <Menu className="w-5 h-5" />
          </Button>

          {meId && chips.length > 0 ? (
            <div className="flex items-center gap-1.5">
              {chips.map((c) => (
                <Link
                  key={c.key}
                  href={c.href}
                  aria-label={c.label}
                  data-testid={c.testId}
                >
                  <Avatar className="w-8 h-8 border border-border">
                    {c.avatarUrl && (
                      <AvatarImage
                        src={c.avatarUrl}
                        alt={c.label}
                        className="object-cover"
                      />
                    )}
                    <AvatarFallback className="bg-secondary text-[10px] font-bold text-secondary-foreground">
                      {c.initials}
                    </AvatarFallback>
                  </Avatar>
                </Link>
              ))}
            </div>
          ) : (
            <Link href="/" className="flex items-center gap-2 shrink-0">
              <img
                src={`${import.meta.env.BASE_URL}logo-icon.png`}
                alt="Kinectem"
                className="w-8 h-8 rounded-lg object-cover"
              />
              <span className="font-black text-base tracking-tight">
                Kinect<span className="brand-gradient-text">em</span>
              </span>
            </Link>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Search"
            data-testid="mobile-top-search"
            onClick={() => setLocation("/search")}
          >
            <Search className="w-5 h-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={
              unreadCount > 0
                ? `Messages, ${unreadCount} unread`
                : "Messages"
            }
            data-testid="mobile-top-messages"
            onClick={() => setLocation("/messages")}
            className="relative"
          >
            <Mail className="w-5 h-5" />
            {unreadCount > 0 && (
              <span
                aria-hidden="true"
                className={cn(
                  "absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-primary",
                )}
              />
            )}
          </Button>
          {meId ? (
            <NotificationsBell />
          ) : (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Notifications"
              onClick={() => setLocation("/login")}
            >
              <Bell className="w-5 h-5" />
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
