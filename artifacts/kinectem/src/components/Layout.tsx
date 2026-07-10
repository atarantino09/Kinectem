import { Link, useLocation } from "wouter";
import {
  useGetLoggedInUser,
  useGetUnreadMessageCount,
  getGetLoggedInUserQueryKey,
} from "@workspace/api-client-react";
import { UserAvatar } from "@/components/UserAvatar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Plus, Home, Building2, Mail, LogOut, UserCircle, Repeat, Users, Shield, Tag, FileText, Megaphone, Settings, Trophy } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchUnreadCount,
  unreadCountQueryKey,
} from "@/components/broadcasts/broadcastsApi";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { NotificationsBell } from "@/components/NotificationsBell";
import { CreateOrgDialog } from "@/components/CreateOrgDialog";
import { MasqueradeBanner } from "@/components/MasqueradeBanner";
import { AnnouncementBanner } from "@/components/AnnouncementBanner";
import { CreateMenuItems } from "@/components/CreateMenuItems";
import { MobileBottomNav } from "@/components/MobileBottomNav";
import { MobileTopBar } from "@/components/MobileTopBar";
import { useWhoami } from "@/hooks/useWhoami";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

export function Layout({ children }: { children: React.ReactNode }) {
  const { data: currentUser, error: currentUserError } = useGetLoggedInUser({
    query: { queryKey: getGetLoggedInUserQueryKey(), retry: false },
  });
  const { data: unreadMsgs } = useGetUnreadMessageCount();
  const { data: whoami } = useWhoami();
  const isAdmin = whoami?.realUser?.role === "admin";
  // Hide the "Game Recap" Create-menu item from people who can't author a
  // recap on any team (typical parents). When the value is missing — e.g.
  // whoami is still loading or the field hasn't shipped to the backend
  // yet — we err on the side of hiding so we never render a dead-end.
  const canAuthorRecap = whoami?.canAuthorRecap === true;
  const [location, setLocation] = useLocation();

  useEffect(() => {
    const status = (currentUserError as { status?: number } | null)?.status;
    if (status === 401 && location !== "/login") {
      if (typeof window !== "undefined") {
        const base = import.meta.env.BASE_URL.replace(/\/$/, "");
        window.location.assign(`${base}/login`);
      } else {
        setLocation("/login");
      }
    }
  }, [currentUserError, location, setLocation]);
  const [query, setQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [createOrgOpen, setCreateOrgOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const isMobile = useIsMobile();
  const qc = useQueryClient();

  const handleLogout = async () => {
    try {
      await customFetch("/api/v1/auth/logout", { method: "POST" });
    } catch {
      // ignore
    }
    // Drop all cached data synchronously instead of invalidating (which awaits
    // a refetch of every query and blocks the redirect, keeping the stale
    // signed-in UI on screen and letting the refetches 401 in the background).
    // Cancelling first stops any in-flight refetches from re-populating.
    void qc.cancelQueries();
    qc.clear();
    if (typeof window !== "undefined") {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      window.location.assign(`${base}/login`);
    } else {
      setLocation("/login");
    }
  };

  const onSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) setLocation(`/search?q=${encodeURIComponent(query.trim())}`);
  };

  const isNavActive = (path: string) => {
    if (path === "/") return location === "/";
    return location === path || location.startsWith(`${path}/`);
  };
  const navVariant = (active: boolean): "secondary" | "ghost" =>
    active ? "secondary" : "ghost";

  const unreadCount = unreadMsgs?.unreadCount ?? 0;
  const { data: broadcastUnread } = useQuery({
    queryKey: unreadCountQueryKey(),
    queryFn: fetchUnreadCount,
    enabled: !!currentUser,
  });
  const announcementsUnread = broadcastUnread ?? 0;

  type NavItem = {
    href: string;
    label: string;
    icon: typeof Home;
    testId?: string;
    badge?: number;
  };

  // Inbox + Announcements moved into the avatar dropdown on desktop to
  // de-crowd the top bar; they stay as full entries in the mobile drawer.
  const menuBadgeTotal = unreadCount + announcementsUnread;

  const navItems: NavItem[] = [
    { href: "/", label: "Feed", icon: Home },
    { href: "/organizations", label: "Orgs", icon: Building2 },
    ...(whoami?.isGuardian || whoami?.realUser?.role === "parent"
      ? [{ href: "/family", label: "Family", icon: Users, testId: "link-family" } satisfies NavItem]
      : []),
    ...(isAdmin
      ? [{ href: "/admin", label: "Admin", icon: Shield, testId: "link-admin" } satisfies NavItem]
      : []),
  ];

  const drawerNavItems: NavItem[] = [
    { href: "/", label: "Feed", icon: Home },
    { href: "/organizations", label: "Orgs", icon: Building2 },
    { href: "/messages", label: "Inbox", icon: Mail, testId: "link-messages", badge: unreadCount },
    { href: "/announcements", label: "Announcements", icon: Megaphone, testId: "link-announcements", badge: announcementsUnread },
    ...navItems.slice(2),
  ];

  const displayName = currentUser
    ? `${currentUser.firstName} ${currentUser.lastName}`
    : "";

  return (
    <div className="min-h-screen text-foreground">
      <MasqueradeBanner />
      <AnnouncementBanner />

      {/* Drawer is rendered at top-level (outside the desktop-only header) so
          the mobile top bar can open it without depending on the desktop tree. */}
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">
            Move between the main sections of Kinectem.
          </SheetDescription>
          <Link
            href="/"
            onClick={() => setMobileNavOpen(false)}
            className="flex items-center w-full px-6 h-16 border-b border-border"
          >
            <img
              src={`${import.meta.env.BASE_URL}logo-horizontal.png`}
              alt="Kinectem"
              className="block h-8 w-auto"
            />
          </Link>
          <nav className="flex flex-col gap-1 p-3">
            {drawerNavItems.map((item) => {
              const active = isNavActive(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileNavOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-md font-semibold text-sm transition-colors",
                    active
                      ? "bg-secondary text-secondary-foreground"
                      : "hover:bg-muted text-foreground",
                  )}
                  data-active={active ? "true" : undefined}
                  data-testid={item.testId ? `mobile-${item.testId}` : undefined}
                >
                  <Icon className="w-5 h-5" />
                  <span className="flex-1">{item.label}</span>
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[11px] font-black flex items-center justify-center">
                      {item.badge > 9 ? "9+" : item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
            {currentUser && (
              <button
                type="button"
                onClick={() => {
                  setMobileNavOpen(false);
                  void handleLogout();
                }}
                className="flex items-center gap-3 px-3 py-2.5 rounded-md font-semibold text-sm transition-colors hover:bg-muted text-foreground text-left"
                data-testid="mobile-btn-logout"
              >
                <LogOut className="w-5 h-5" />
                <span className="flex-1">Log out</span>
              </button>
            )}
          </nav>
        </SheetContent>
      </Sheet>

      <CreateOrgDialog open={createOrgOpen} onOpenChange={setCreateOrgOpen} />

      {/* Mount mobile vs desktop chrome by viewport rather than CSS-hiding,
          so we never double-mount expensive subtrees like NotificationsBell. */}
      {isMobile ? (
        <MobileTopBar
          meId={currentUser?.id}
          unreadCount={unreadCount}
          isGuardian={
            whoami?.isGuardian === true || whoami?.realUser?.role === "parent"
          }
          onOpenNav={() => setMobileNavOpen(true)}
        />
      ) : (
      <header className="hidden md:block sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 h-16 flex items-center gap-4 md:gap-6">
          <Link href="/" className="flex items-center shrink-0 cursor-pointer">
            <img
              src={`${import.meta.env.BASE_URL}logo-horizontal.png`}
              alt="Kinectem"
              className="block h-9 w-auto"
            />
          </Link>

          {/* The header is packed, so growing via flex has no free space to
              claim. Instead, on focus the input breaks out of flow and
              overlays the nav (z-20) at a comfortable width; the form keeps
              its flex slot so the layout doesn't jump. */}
          <form
            onSubmit={onSearchSubmit}
            className="relative flex-1 max-w-md min-w-0 h-10"
          >
            <div
              className={`transition-all duration-200 ease-out ${
                searchFocused
                  ? "absolute left-0 top-0 z-20 w-[clamp(14rem,calc(100vw-32rem),36rem)]"
                  : "absolute inset-0"
              }`}
            >
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground z-10" />
              <Input
                type="search"
                placeholder="Search athletes, teams, organizations..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                className={`pl-9 border-transparent ${
                  searchFocused ? "bg-card shadow-md" : "bg-muted"
                }`}
                data-testid="input-header-search"
              />
            </div>
          </form>

          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => {
              const active = isNavActive(item.href);
              const Icon = item.icon;
              const hasBadge = item.badge !== undefined && item.badge > 0;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                >
                  <Button
                    variant={navVariant(active)}
                    size="sm"
                    className="font-semibold"
                    data-active={active ? "true" : undefined}
                    data-testid={item.testId}
                  >
                    <Icon className="w-4 h-4 mr-2" /> {item.label}
                    {hasBadge && (
                      <span
                        className="ml-2 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-black flex items-center justify-center"
                        data-testid={
                          item.testId ? `badge-${item.testId}` : undefined
                        }
                      >
                        {item.badge! > 9 ? "9+" : item.badge}
                      </span>
                    )}
                  </Button>
                </Link>
              );
            })}
          </nav>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-9 px-2 gap-2">
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline font-semibold">Create</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <CreateMenuItems
                canAuthorRecap={canAuthorRecap}
                onCreateOrg={() => setCreateOrgOpen(true)}
              />
            </DropdownMenuContent>
          </DropdownMenu>

          <NotificationsBell />

          {currentUser && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="relative shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  data-testid="btn-user-menu"
                >
                  <UserAvatar
                    avatarUrl={currentUser.avatarUrl}
                    displayName={displayName}
                    size="md"
                    className="border border-border hover:ring-2 hover:ring-primary transition-all"
                    fallbackClassName="bg-slate-900 text-primary-foreground"
                  />
                  {menuBadgeTotal > 0 && (
                    <span
                      className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-black flex items-center justify-center ring-2 ring-card"
                      data-testid="badge-user-menu"
                    >
                      {menuBadgeTotal > 9 ? "9+" : menuBadgeTotal}
                    </span>
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <div className="px-2 py-1.5">
                  <p className="font-bold text-sm truncate">{displayName}</p>
                  {currentUser.email && (
                    <p className="text-xs text-muted-foreground truncate">{currentUser.email}</p>
                  )}
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setLocation(`/users/${currentUser.id}`)}>
                  <UserCircle className="w-4 h-4 mr-2" /> View profile
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => setLocation("/messages")}
                  data-testid="menu-messages"
                >
                  <Mail className="w-4 h-4 mr-2" /> Inbox
                  {unreadCount > 0 && (
                    <span
                      className="ml-auto min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-black flex items-center justify-center"
                      data-testid="badge-menu-messages"
                    >
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => setLocation("/announcements")}
                  data-testid="menu-announcements"
                >
                  <Megaphone className="w-4 h-4 mr-2" /> Announcements
                  {announcementsUnread > 0 && (
                    <span
                      className="ml-auto min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-black flex items-center justify-center"
                      data-testid="badge-menu-announcements"
                    >
                      {announcementsUnread > 9 ? "9+" : announcementsUnread}
                    </span>
                  )}
                </DropdownMenuItem>
                {isAdmin && (
                  <DropdownMenuItem
                    onSelect={() => setLocation("/admin")}
                    data-testid="menu-admin"
                  >
                    <Shield className="w-4 h-4 mr-2" /> Admin
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => setLocation("/tags/pending")}
                  data-testid="menu-pending-tags"
                >
                  <Tag className="w-4 h-4 mr-2" /> Pending Tags
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => setLocation("/drafts")}
                  data-testid="menu-drafts"
                >
                  <FileText className="w-4 h-4 mr-2" /> My Drafts
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => setLocation("/competitions")}
                  data-testid="menu-competitions"
                >
                  <Trophy className="w-4 h-4 mr-2" /> My Competitions
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => setLocation("/settings")}
                  data-testid="menu-settings"
                >
                  <Settings className="w-4 h-4 mr-2" /> Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setLocation("/login")}>
                  <Repeat className="w-4 h-4 mr-2" /> Switch user
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={handleLogout} data-testid="btn-logout">
                  <LogOut className="w-4 h-4 mr-2" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </header>
      )}

      <main className="mx-auto max-w-6xl px-4 py-6 pb-16 md:pb-8">{children}</main>

      {isMobile && (
        <MobileBottomNav
          meId={currentUser?.id}
          canAuthorRecap={canAuthorRecap}
        />
      )}
    </div>
  );
}
