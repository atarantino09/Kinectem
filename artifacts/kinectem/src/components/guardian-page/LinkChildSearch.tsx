import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/UserAvatar";
import { UserPlus, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Child, SearchUser } from "./types";

interface Props {
  children: Child[];
  onLinked: () => void | Promise<void>;
}

// "Link a child" search card. Owns its own query/results/linking state
// so GuardianPage doesn't have to thread search bookkeeping through
// the rest of the dashboard.
export function LinkChildSearch({ children, onLinked }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);

  useEffect(() => {
    if (!query.trim() || query.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await customFetch<{ data: SearchUser[] }>(
          `/api/v1/users?role=athlete&q=${encodeURIComponent(query.trim())}`,
        );
        setResults(r.data ?? []);
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
      await qc.invalidateQueries({ queryKey: ["whoami"] });
      await onLinked();
    } catch (e) {
      const msg = (e as Error)?.message ?? "Failed to link child";
      toast({ title: msg, variant: "destructive" });
    } finally {
      setLinking(null);
    }
  };

  return (
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
                    <UserAvatar
                      avatarUrl={u.avatarUrl}
                      displayName={`${u.firstName} ${u.lastName}`}
                      size="md"
                      className="border border-border shrink-0"
                      fallbackClassName="bg-slate-900 text-white"
                    />
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
  );
}
