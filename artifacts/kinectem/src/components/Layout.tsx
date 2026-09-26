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

  // Task #864 — published game recap pages are publicly viewable. A
  // logged-out visitor on /posts/:id gets a slim read-only shell instead
  // of a redirect to /login; every interaction on the page routes them to
  // the signup screen (see the click gate below). `/posts/new` is a
  // different route entirely (registered outside Layout).
  const isPublicPostRoute = /^\/posts\/[^/]+$/.test(location);
  // whoami answers 200 `{authenticated:false}` immediately for logged-out
  // visitors, while the users/me query can spend seconds retrying its 401
  // (other mounts of the same query use default retries) — so key visitor
  // detection on whoami and use the 401 only as a fallback.
  const authStatus = (currentUserError as { status?: number } | null)?.status;
  const isVisitor =
    (whoami as { authenticated?: boolean } | undefined)?.authenticated ===
      false || authStatus === 401;

  // Only game recaps (long-form articles) are publicly viewable; highlights
  // and org posts keep the login wall even though the API serves them. We
  // peek at the post (shared queryKey with PostPage, so this is one fetch)
  // to decide before letting the visitor shell render.
  const publicPostId = isPublicPostRoute ? location.split("/")[2] : null;
  const publicPostQuery = useQuery<{ postType?: string }>({
    queryKey: ["post", publicPostId],
    queryFn: () => customFetch(`/api/v1/posts/${publicPostId}`),
    enabled: isVisitor && !!publicPostId,
    retry: false,
  });
  const publicPostPending =
    isVisitor && isPublicPostRoute && publicPostQuery.isLoading;
  const publicPostAllowed =
    isVisitor &&
    isPublicPostRoute &&
    publicPostQuery.data?.postType === "long";

  useEffect(() => {
    // Task #850 — claim-link visits (`?claimToken=`) must stay viewable
    // logged-out so the recipient can preview the real page before signing
    // up; the claim banner on the page owns the signup hand-off.
    const hasClaimToken =
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).has("claimToken");
    // Public recap pages don't bounce to login while we're checking (or
    // once we've confirmed) that the post is a publicly viewable game
    // recap (Task #864). Anything else falls through to the redirect.
    if (
      /^\/posts\/[^/]+$/.test(location) &&
      isVisitor &&
      (publicPostQuery.isLoading || publicPostQuery.data?.postType === "long")
    )
      return;
    if (isVisitor && location !== "/login" && !hasClaimToken) {
      if (typeof window !== "undefined") {
        const base = import.meta.env.BASE_URL.replace(/\/$/, "");
        // Older family-invite emails pointed at /family without an invite id.
        // Preserve that destination through authentication so their pending
        // invitation still appears after signup or sign-in.
        const familyReturn = location === "/family"
          ? "?familyInvite=1&returnTo=%2Ffamily"
          : "";
        window.location.assign(`${base}/login${familyReturn}`);
      } else {
        setLocation("/login");
      }
    }
  }, [
    currentUserError,
    isVisitor,
    location,
    setLocation,
    publicPostQuery.isLoading,
    publicPostQuery.data,
  ]);
  const [query, setQuery] = useState("");
  const [createOrgOpen, setCreateOrgOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const isMobile = useIsMobile();
  const qc = useQueryClient();

  useEffect(() => {
    // Keep the submitted term visible while the search results are open, but
    // don't carry it into the next page in the shared header.
    const pathname = location.split("?")[0];
    if (pathname !== "/search") setQuery("");
  }, [location]);

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
    // Nav hrefs may carry a query string (e.g. /competitions?organizer=x) but
    // wouter's location never includes one — match on the pathname only.
    const clean = path.split("?")[0];
    if (clean === "/") return location === "/";
    return location === clean || location.startsWith(`${clean}/`);
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
    { href: "/competitions", label: "Competitions", icon: Trophy, testId: "link-competitions" },
    { href: "/messages", label: "Inbox", icon: Mail, testId: "link-messages", badge: unreadCount },
    { href: "/announcements", label: "Announcements", icon: Megaphone, testId: "link-announcements", badge: announcementsUnread },
    ...navItems.slice(2),
  ];

  const displayName = currentUser
    ? `${currentUser.firstName} ${currentUser.lastName}`
    : "";

  // Task #864 — slim public shell for logged-out recap visitors. Reading is
  // free; any click inside the page content (links, reactions, share — all
  // of it) hands the visitor to the signup screen with a return-to so they
  // land right back on this recap after creating an account.
  // Avoid flashing the full logged-in chrome while we check whether this
  // post is publicly viewable.
  if (publicPostPending) {
    return <div className="min-h-screen" />;
  }

  if (publicPostAllowed) {
    const signupUrl = () => {
      const returnTo =
        typeof window !== "undefined"
          ? window.location.pathname.replace(
              new RegExp(`^${import.meta.env.BASE_URL.replace(/\/$/, "")}`),
              "",
            ) + window.location.search
          : location;
      return `/login?signup=1&gate=recap&returnTo=${encodeURIComponent(returnTo)}`;
    };
    const gateClicks = (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      const interactive = target.closest(
        "a, button, input, textarea, select, [role='button']",
      );
      if (!interactive) return;
      e.preventDefault();
      e.stopPropagation();
      setLocation(signupUrl());
    };
    return (
      <div className="min-h-screen text-foreground">
        <header className="app-shell-header sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur">
          <div className="mx-auto max-w-6xl px-4 h-16 flex items-center gap-3">
            <a
              href={signupUrl()}
              onClick={(e) => {
                e.preventDefault();
                setLocation(signupUrl());
              }}
              className="flex items-center shrink-0 cursor-pointer"
              aria-label="Kinectem"
            >
              <img
                src={`${import.meta.env.BASE_URL}logo-horizontal.png`}
                alt="Kinectem"
                className="block h-8 md:h-9 w-auto"
              />
            </a>
            <div className="flex-1" />
            <Button
              variant="ghost"
              size="sm"
              className="font-semibold"
              onClick={() =>
                setLocation(
                  `/login?returnTo=${encodeURIComponent(location)}`,
                )
              }
              data-testid="btn-visitor-login"
            >
              Log in
            </Button>
            <Button
              variant="brand"
              size="sm"
              className="font-bold"
              onClick={() => setLocation(signupUrl())}
              data-testid="btn-visitor-join"
            >
              Join Kinectem — it's free
            </Button>
          </div>
        </header>
        <main
          className="mx-auto max-w-6xl px-4 py-6 pb-16 md:pb-8"
          onClickCapture={gateClicks}
          data-testid="visitor-post-shell"
        >
          {children}
        </main>
        <div className="mx-auto max-w-3xl px-4 pb-12">
          <div className="rounded-2xl border border-border bg-card p-6 text-center space-y-3">
            <p className="font-black text-lg tracking-tight">
              You've caught the highlights — don't miss the season.
            </p>
            <p className="text-sm text-muted-foreground">
              Create your free Kinectem account to cheer, comment, and follow
              this team all season long.
            </p>
            <Button
              variant="brand"
              className="font-bold"
              onClick={() => setLocation(signupUrl())}
              data-testid="btn-visitor-join-footer"
            >
              Create your free account
            </Button>
          </div>
        </div>
      </div>
    );
  }

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
                    <span className="brand-count-marker min-w-[20px] h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[11px] font-black flex items-center justify-center">
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
          onOpenNav={() => setMobileNavOpen(true)}
        />
      ) : (
      <header className="app-shell-header hidden md:block sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 h-16 flex items-center gap-4 md:gap-6">
          <Link href="/" className="flex items-center shrink-0 cursor-pointer">
            <img
              src={`${import.meta.env.BASE_URL}logo-horizontal.png`}
              alt="Kinectem"
              className="block h-9 w-auto"
            />
          </Link>

          <form onSubmit={onSearchSubmit} className="relative hidden min-w-0 max-w-md flex-1 lg:block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search athletes, teams, organizations..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
               className="pl-9 bg-muted/80 border-transparent focus-visible:bg-card focus-visible:border-primary/30"
              data-testid="input-header-search"
            />
          </form>
          <Link
            href="/search"
            aria-label="Search"
            className="ml-auto flex h-10 w-10 shrink-0 items-center justify-center rounded-md hover:bg-muted lg:hidden"
          >
            <Search className="h-5 w-5" />
          </Link>

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
                    aria-label={item.label}
                    className={cn("px-2 font-semibold lg:px-3", active && "shadow-sm")}
                    data-active={active ? "true" : undefined}
                    data-testid={item.testId}
                  >
                    <Icon className="h-4 w-4 lg:mr-2" />
                    <span className="hidden lg:inline">{item.label}</span>
                    {hasBadge && (
                      <span
                        className="brand-count-marker ml-2 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-black flex items-center justify-center"
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
                <span className="hidden font-semibold lg:inline">Create</span>
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
                      className="brand-count-marker absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-black flex items-center justify-center"
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
                  data-testid="menu-organizer-hubs"
                >
                  <Trophy className="w-4 h-4 mr-2" /> Competitions
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

      <main className="mx-auto max-w-6xl px-4 py-6 pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-8">{children}</main>

      {isMobile && (
        <MobileBottomNav
          meId={currentUser?.id}
          canAuthorRecap={canAuthorRecap}
        />
      )}
    </div>
  );
}
