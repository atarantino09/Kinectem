import { Link, useLocation } from "wouter";
import {
  useGetLoggedInUser,
  useGetUnreadMessageCount,
  getGetLoggedInUserQueryKey,
} from "@workspace/api-client-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Plus, Home, Building2, Trophy, Mail, Tag, LogOut, UserCircle, Repeat, FileText, Users, Shield, Menu } from "lucide-react";
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
  SheetTrigger,
} from "@/components/ui/sheet";
import { getInitials } from "@/lib/format";
import { NotificationsBell } from "@/components/NotificationsBell";
import { CreateOrgDialog } from "@/components/CreateOrgDialog";
import { MasqueradeBanner } from "@/components/MasqueradeBanner";
import { useWhoami } from "@/hooks/useWhoami";
import { cn } from "@/lib/utils";

export function Layout({ children }: { children: React.ReactNode }) {
  const { data: currentUser, error: currentUserError } = useGetLoggedInUser({
    query: { queryKey: getGetLoggedInUserQueryKey(), retry: false },
  });
  const { data: unreadMsgs } = useGetUnreadMessageCount();
  const { data: whoami } = useWhoami();
  const isAdmin = whoami?.realUser?.role === "admin";
  const [location, setLocation] = useLocation();

  useEffect(() => {
    const status = (currentUserError as { status?: number } | null)?.status;
    if (status === 401 && location !== "/login") {
      if (typeof window !== "undefined") {
        window.location.assign("/login");
      } else {
        setLocation("/login");
      }
    }
  }, [currentUserError, location, setLocation]);
  const [query, setQuery] = useState("");
  const [createOrgOpen, setCreateOrgOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const qc = useQueryClient();

  const handleLogout = async () => {
    try {
      await customFetch("/api/v1/auth/logout", { method: "POST" });
    } catch {
      // ignore
    }
    await qc.invalidateQueries();
    if (typeof window !== "undefined") {
      window.location.assign("/login");
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
  const navVariant = (active: boolean) => (active ? "secondary" : "ghost") as const;

  const unreadCount = unreadMsgs?.unreadCount ?? 0;
  const formattedUnread = unreadCount > 9 ? "9+" : String(unreadCount);

  type NavItem = {
    href: string;
    label: string;
    icon: typeof Home;
    testId?: string;
    badge?: number;
  };

  const navItems: NavItem[] = [
    { href: "/", label: "Feed", icon: Home },
    { href: "/organizations", label: "Orgs", icon: Building2 },
    { href: "/messages", label: "Inbox", icon: Mail, testId: "link-messages", badge: unreadCount },
    ...(currentUser?.role === "parent"
      ? [{ href: "/family", label: "Family", icon: Users, testId: "link-family" } satisfies NavItem]
      : []),
    ...(isAdmin
      ? [{ href: "/admin", label: "Admin", icon: Shield, testId: "link-admin" } satisfies NavItem]
      : []),
  ];

  const displayName = currentUser
    ? `${currentUser.firstName} ${currentUser.lastName}`
    : "";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <MasqueradeBanner />
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 h-16 flex items-center gap-4 md:gap-6">
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden shrink-0 relative"
                aria-label="Open navigation menu"
                data-testid="btn-mobile-nav"
              >
                <Menu className="w-5 h-5" />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-black flex items-center justify-center">
                    {formattedUnread}
                  </span>
                )}
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <SheetDescription className="sr-only">
                Move between the main sections of Kinectem.
              </SheetDescription>
              <div className="flex items-center gap-2 px-6 h-16 border-b border-border">
                <img
                  src={`${import.meta.env.BASE_URL}logo-icon.png`}
                  alt="Kinectem"
                  className="w-8 h-8 rounded-lg object-cover"
                />
                <span className="font-black text-lg tracking-tight">
                  Kinect<span className="brand-gradient-text">em</span>
                </span>
              </div>
              <nav className="flex flex-col gap-1 p-3">
                {navItems.map((item) => {
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
              </nav>
            </SheetContent>
          </Sheet>

          <Link href="/" className="flex items-center gap-2 shrink-0">
            <img
              src={`${import.meta.env.BASE_URL}logo-icon.png`}
              alt="Kinectem"
              className="w-9 h-9 rounded-lg object-cover"
            />
            <span className="font-black text-xl tracking-tight hidden sm:inline">
              Kinect<span className="brand-gradient-text">em</span>
            </span>
          </Link>

          <form onSubmit={onSearchSubmit} className="flex-1 max-w-md relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search athletes, teams, organizations..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9 bg-muted border-transparent focus-visible:bg-card"
            />
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
                    className={cn("font-semibold", hasBadge && "relative")}
                    data-active={active ? "true" : undefined}
                    data-testid={item.testId}
                  >
                    <Icon className="w-4 h-4 mr-2" /> {item.label}
                    {hasBadge && (
                      <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-black flex items-center justify-center">
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
              <DropdownMenuItem onSelect={() => setLocation("/posts/new?type=long")}>
                <Trophy className="w-4 h-4 mr-2" /> Game Recap
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setLocation("/posts/new?type=short")}>
                <Plus className="w-4 h-4 mr-2" /> Highlight Clip
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => setCreateOrgOpen(true)}
                data-testid="menu-create-org"
              >
                <Building2 className="w-4 h-4 mr-2" /> New Organization
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setLocation("/organizations")}>
                <Building2 className="w-4 h-4 mr-2" /> Browse Orgs
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setLocation("/tags/pending")}>
                <Tag className="w-4 h-4 mr-2" /> Pending Tags
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => setLocation("/drafts")}
                data-testid="menu-drafts"
              >
                <FileText className="w-4 h-4 mr-2" /> My Drafts
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <CreateOrgDialog open={createOrgOpen} onOpenChange={setCreateOrgOpen} />

          <NotificationsBell />

          {currentUser && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  data-testid="btn-user-menu"
                >
                  <Avatar className="w-9 h-9 border border-border hover:ring-2 hover:ring-primary transition-all">
                    {currentUser.avatarUrl && <AvatarImage src={currentUser.avatarUrl} />}
                    <AvatarFallback className="bg-slate-900 text-primary-foreground font-bold text-xs">
                      {getInitials(displayName)}
                    </AvatarFallback>
                  </Avatar>
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
                {isAdmin && (
                  <DropdownMenuItem
                    onSelect={() => setLocation("/admin")}
                    data-testid="menu-admin"
                  >
                    <Shield className="w-4 h-4 mr-2" /> Admin
                  </DropdownMenuItem>
                )}
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

      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
