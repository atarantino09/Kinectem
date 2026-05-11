import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { NotificationsBell } from "@/components/NotificationsBell";
import { Bell, Mail, Menu, Search, Users } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  meId: string | undefined;
  unreadCount: number;
  isGuardian: boolean;
  onOpenNav: () => void;
};

export function MobileTopBar({ meId, unreadCount, isGuardian, onOpenNav }: Props) {
  const [location, setLocation] = useLocation();
  const familyActive =
    location === "/family" || location.startsWith("/family/");

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

          <Link
            href="/"
            className="flex items-center gap-2 shrink-0"
            data-testid="mobile-top-logo"
          >
            <img
              src={`${import.meta.env.BASE_URL}logo-icon.png`}
              alt="Kinectem"
              className="w-8 h-8 rounded-lg object-cover"
            />
            <span className="font-black text-base tracking-tight">
              Kinect<span className="brand-gradient-text">em</span>
            </span>
          </Link>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {isGuardian && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Family"
              aria-current={familyActive ? "page" : undefined}
              data-testid="mobile-top-family"
              data-active={familyActive ? "true" : undefined}
              onClick={() => setLocation("/family")}
              className={cn(familyActive && "bg-secondary text-secondary-foreground")}
            >
              <Users className="w-5 h-5" />
            </Button>
          )}
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
