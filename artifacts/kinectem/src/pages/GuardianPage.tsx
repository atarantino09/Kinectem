import { useEffect, useState } from "react";
import { Link } from "wouter";
import { customFetch, useGetLoggedInUser } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Shield, UserPlus, Search, Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getInitials } from "@/lib/format";

interface Child {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  email: string | null;
  avatarUrl: string | null;
  requireTagConsent: boolean;
}

interface SearchUser {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  email: string | null;
  avatarUrl: string | null;
}

export default function GuardianPage() {
  const { data: me } = useGetLoggedInUser();
  const { toast } = useToast();
  const [children, setChildren] = useState<Child[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await customFetch<{ data: Child[] }>(
        "/api/v1/users/me/children",
      );
      setChildren(r.data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (!query.trim() || query.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const rows = await customFetch<SearchUser[]>(
          `/api/v1/users?q=${encodeURIComponent(query.trim())}`,
        );
        setResults(rows.filter((u) => u.role === "athlete"));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const linkChild = async (childId: string) => {
    setLinking(childId);
    try {
      await customFetch("/api/v1/users/me/children", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ childId }),
      });
      toast({ title: "Child linked to your guardian account" });
      setQuery("");
      setResults([]);
      await refresh();
    } catch (e) {
      const msg = (e as Error)?.message ?? "Failed to link child";
      toast({ title: msg, variant: "destructive" });
    } finally {
      setLinking(null);
    }
  };

  const toggleConsent = async (child: Child, value: boolean) => {
    try {
      await customFetch(
        `/api/v1/users/me/children/${child.id}/visibility`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requireTagConsent: value }),
        },
      );
      setChildren((prev) =>
        prev.map((c) =>
          c.id === child.id ? { ...c, requireTagConsent: value } : c,
        ),
      );
      toast({
        title: value
          ? `Tag consent now required for ${child.firstName}`
          : `Tag consent no longer required for ${child.firstName}`,
      });
    } catch {
      toast({ title: "Failed to update setting", variant: "destructive" });
    }
  };

  if (me && me.role !== "parent") {
    return (
      <Card className="rounded-xl border-border">
        <CardContent className="p-8 text-center space-y-2">
          <Shield className="w-10 h-10 text-muted-foreground mx-auto" />
          <h2 className="text-xl font-black tracking-tight">
            Guardian dashboard
          </h2>
          <p className="text-sm text-muted-foreground">
            This page is only available to parent or guardian accounts.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center">
          <Users className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-3xl font-black tracking-tight">Family</h1>
          <p className="text-sm text-muted-foreground">
            Link your children's accounts and control how they appear on
            Kinectem.
          </p>
        </div>
      </div>

      {/* Linked children */}
      <Card className="rounded-xl border-border">
        <CardContent className="p-6 space-y-4">
          <h2 className="font-black tracking-tight">Linked children</h2>
          {loading ? (
            <Skeleton className="h-20 rounded-lg" />
          ) : children.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              You haven't linked any children yet. Find an athlete below to get
              started.
            </p>
          ) : (
            <div className="space-y-3">
              {children.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-3 p-3 rounded-lg border border-border"
                  data-testid={`row-child-${c.id}`}
                >
                  <Avatar className="w-10 h-10 border border-border shrink-0">
                    {c.avatarUrl && <AvatarImage src={c.avatarUrl} />}
                    <AvatarFallback className="bg-slate-900 text-white font-bold text-xs">
                      {getInitials(`${c.firstName} ${c.lastName}`)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <Link href={`/users/${c.id}`}>
                      <p className="font-bold text-sm cursor-pointer hover:text-primary truncate">
                        {c.firstName} {c.lastName}
                      </p>
                    </Link>
                    <p className="text-xs text-muted-foreground truncate">
                      {c.email ?? "No email on file"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="text-right text-xs">
                      <p className="font-bold">Require tag consent</p>
                      <p className="text-muted-foreground">
                        {c.requireTagConsent
                          ? "Coaches must ask first"
                          : "Anyone may tag"}
                      </p>
                    </div>
                    <Switch
                      checked={c.requireTagConsent}
                      onCheckedChange={(v) => toggleConsent(c, v)}
                      data-testid={`switch-consent-${c.id}`}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Link a new child */}
      <Card className="rounded-xl border-border">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-primary" />
            <h2 className="font-black tracking-tight">Link a child</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Search for your child's athlete account by name. We'll attach it to
            your guardian profile.
          </p>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type a child's name..."
              className="pl-9"
              data-testid="input-search-child"
            />
          </div>
          {query.trim().length >= 2 && (
            <div className="space-y-2">
              {searching ? (
                <Skeleton className="h-12 rounded-lg" />
              ) : results.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No matching athlete accounts found.
                </p>
              ) : (
                results.map((u) => {
                  const alreadyLinked = children.some((c) => c.id === u.id);
                  return (
                    <div
                      key={u.id}
                      className="flex items-center gap-3 p-3 rounded-lg border border-border"
                    >
                      <Avatar className="w-9 h-9 border border-border shrink-0">
                        {u.avatarUrl && <AvatarImage src={u.avatarUrl} />}
                        <AvatarFallback className="bg-slate-900 text-white font-bold text-xs">
                          {getInitials(`${u.firstName} ${u.lastName}`)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-sm truncate">
                          {u.firstName} {u.lastName}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {u.email ?? "No email"}
                        </p>
                      </div>
                      {alreadyLinked ? (
                        <Badge variant="outline" className="font-bold">
                          Linked
                        </Badge>
                      ) : (
                        <Button
                          size="sm"
                          className="font-bold rounded-full"
                          disabled={linking === u.id}
                          onClick={() => linkChild(u.id)}
                          data-testid={`btn-link-${u.id}`}
                        >
                          {linking === u.id ? "Linking..." : "Link"}
                        </Button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
