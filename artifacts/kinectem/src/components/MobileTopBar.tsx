import { Link, useLocation } from "wouter";
import { useListUserTeams, queryOpts } from "@workspace/api-client-react";
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

function teamInitials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function MobileTopBar({ meId, unreadCount, onOpenNav }: Props) {
  const [, setLocation] = useLocation();
  const { data: teamsResp } = useListUserTeams(meId ?? "", undefined, {
    query: queryOpts({ enabled: !!meId }),
  });
  const teams = (teamsResp?.data ?? []).slice(0, 2);
  const formattedUnread = unreadCount > 9 ? "9+" : String(unreadCount);

  return (
    <header
      data-testid="mobile-top-bar"
      className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur md:hidden"
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

          {meId && teams.length > 0 ? (
            <div className="flex items-center gap-1.5">
              {teams.map((t) => (
                <Link
                  key={t.teamId}
                  href={`/teams/${t.teamId}`}
                  aria-label={t.teamName}
                  data-testid={`mobile-top-chip-${t.teamId}`}
                >
                  <Avatar className="w-8 h-8 border border-border">
                    {t.teamAvatarUrl && (
                      <AvatarImage
                        src={t.teamAvatarUrl}
                        alt={t.teamName}
                        className="object-cover"
                      />
                    )}
                    <AvatarFallback className="bg-secondary text-[10px] font-bold text-secondary-foreground">
                      {teamInitials(t.teamName) || "T"}
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
