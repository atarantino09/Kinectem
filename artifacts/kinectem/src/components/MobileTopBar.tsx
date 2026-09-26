import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { NotificationsBell } from "@/components/NotificationsBell";
import { Bell, Mail, Menu, Search } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  meId: string | undefined;
  unreadCount: number;
  onOpenNav: () => void;
};

export function MobileTopBar({ meId, unreadCount, onOpenNav }: Props) {
  const [, setLocation] = useLocation();

  return (
    <header
      data-testid="mobile-top-bar"
      className="app-shell-header sticky top-0 z-30 border-b border-border bg-background md:hidden"
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
            className="h-11 w-11 shrink-0"
          >
            <Menu className="w-5 h-5" />
          </Button>

          <Link
            href="/"
            className="flex items-center shrink-0"
            data-testid="mobile-top-logo"
          >
            <img
              src={`${import.meta.env.BASE_URL}logo-horizontal.png`}
              alt="Kinectem"
              className="h-7 w-auto max-[359px]:max-w-24 max-[359px]:object-contain"
            />
          </Link>
        </div>

        <div className="flex shrink-0 items-center gap-1 [&_[data-testid=button-notifications]]:!h-11 [&_[data-testid=button-notifications]]:!w-11 [&_[data-testid=button-notifications]]:!px-0">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Search"
            data-testid="mobile-top-search"
            onClick={() => setLocation("/search")}
            className="h-11 w-11"
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
            className="relative h-11 w-11"
          >
            <Mail className="w-5 h-5" />
            {unreadCount > 0 && (
              <span
                aria-hidden="true"
                className={cn(
                  "brand-unread-dot absolute top-1.5 right-1.5 w-2 h-2 rounded-full",
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
              className="h-11 w-11"
            >
              <Bell className="w-5 h-5" />
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
