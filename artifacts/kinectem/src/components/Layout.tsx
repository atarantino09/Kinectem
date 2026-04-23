import { Link, useLocation } from "wouter";
import {
  useGetLoggedInUser,
  useGetUnreadMessageCount,
} from "@workspace/api-client-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Plus, Home, Building2, Trophy, Mail, Tag, LogOut, UserCircle, Repeat, FileText, Users } from "lucide-react";
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
import { getInitials } from "@/lib/format";
import { NotificationsBell } from "@/components/NotificationsBell";
import { CreateOrgDialog } from "@/components/CreateOrgDialog";

export function Layout({ children }: { children: React.ReactNode }) {
  const { data: currentUser, error: currentUserError } = useGetLoggedInUser({
    query: { retry: false },
  });
  const { data: unreadMsgs } = useGetUnreadMessageCount();
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

  const displayName = currentUser
    ? `${currentUser.firstName} ${currentUser.lastName}`
    : "";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 h-16 flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <img
              src={`${import.meta.env.BASE_URL}logo-icon.png`}
              alt="Kinectem"
              className="w-9 h-9 rounded-lg object-cover"
            />
            <span className="font-black text-xl tracking-tight">
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
            <Link href="/">
              <Button variant="ghost" size="sm" className="font-semibold">
                <Home className="w-4 h-4 mr-2" /> Feed
              </Button>
            </Link>
            <Link href="/organizations">
              <Button variant="ghost" size="sm" className="font-semibold">
                <Building2 className="w-4 h-4 mr-2" /> Orgs
              </Button>
            </Link>
            <Link href="/messages">
              <Button
                variant="ghost"
                size="sm"
                className="font-semibold relative"
                data-testid="link-messages"
              >
                <Mail className="w-4 h-4 mr-2" /> Inbox
                {(unreadMsgs?.unreadCount ?? 0) > 0 && (
                  <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-black flex items-center justify-center">
                    {(unreadMsgs?.unreadCount ?? 0) > 9
                      ? "9+"
                      : unreadMsgs?.unreadCount}
                  </span>
                )}
              </Button>
            </Link>
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
              {currentUser?.role === "parent" && (
                <DropdownMenuItem
                  onSelect={() => setLocation("/family")}
                  data-testid="menu-family"
                >
                  <Users className="w-4 h-4 mr-2" /> Family
                </DropdownMenuItem>
              )}
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
