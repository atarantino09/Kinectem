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

  // Affiliation priority: org affiliations first, then the first rostered
  // team. Cap at 2 chips to keep the bar uncluttered on narrow phones.
  const chips: Chip[] = [];
  for (const o of orgsResp?.data ?? []) {
    if (chips.length >= 2) break;
    chips.push({
      key: `org-${o.id}`,
      href: `/organizations/${o.id}`,
      label: o.name,
      avatarUrl: o.logoUrl,
      initials: initialsOf(o.name) || "O",
      testId: `mobile-top-chip-org-${o.id}`,
    });
  }
  for (const t of teamsResp?.data ?? []) {
    if (chips.length >= 2) break;
    chips.push({
      key: `team-${t.teamId}`,
      href: `/teams/${t.teamId}`,
      label: t.teamName,
      avatarUrl: t.teamAvatarUrl,
      initials: initialsOf(t.teamName) || "T",
      testId: `mobile-top-chip-team-${t.teamId}`,
    });
  }

  const formattedUnread = unreadCount > 9 ? "9+" : String(unreadCount);

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
            aria-label="Messages"
            data-testid="mobile-top-messages"
            onClick={() => setLocation("/messages")}
            className="relative"
          >
            <Mail className="w-5 h-5" />
            {unreadCount > 0 && (
              <span
                className={cn(
                  "absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-black flex items-center justify-center",
                )}
              >
                {formattedUnread}
              </span>
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
