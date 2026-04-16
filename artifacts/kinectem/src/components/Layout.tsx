import { Link, useLocation } from "wouter";
import { useGetCurrentUser } from "@workspace/api-client-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Plus, Home, Building2, Trophy } from "lucide-react";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { data: currentUser } = useGetCurrentUser();
  const [, setLocation] = useLocation();
  const [query, setQuery] = useState("");

  const onSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) setLocation(`/?q=${encodeURIComponent(query.trim())}`);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 h-16 flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <div className="w-9 h-9 rounded-lg bg-slate-900 flex items-center justify-center">
              <span className="text-primary font-black text-sm tracking-tighter">K</span>
            </div>
            <span className="font-black text-xl tracking-tight">Kinectem</span>
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
          </nav>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-9 px-2 gap-2">
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline font-semibold">Create</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onSelect={() => setLocation("/articles/new")}>
                <Trophy className="w-4 h-4 mr-2" /> Game Recap
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setLocation("/highlights/new")}>
                <Plus className="w-4 h-4 mr-2" /> Highlight Clip
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setLocation("/organizations")}>
                <Building2 className="w-4 h-4 mr-2" /> Browse Orgs
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {currentUser && (
            <Link href={`/users/${currentUser.id}`} className="shrink-0">
              <Avatar className="w-9 h-9 border border-border hover:ring-2 hover:ring-primary transition-all">
                {currentUser.avatarUrl && <AvatarImage src={currentUser.avatarUrl} />}
                <AvatarFallback className="bg-slate-900 text-primary-foreground font-bold text-xs">
                  {getInitials(currentUser.name)}
                </AvatarFallback>
              </Avatar>
            </Link>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
