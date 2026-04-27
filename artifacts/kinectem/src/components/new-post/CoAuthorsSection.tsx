import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export function CoAuthorsSection({
  postId,
  myId,
}: {
  postId: string;
  myId: string;
}) {
  const { toast } = useToast();
  const [coAuthors, setCoAuthors] = useState<
    { id: string; firstName: string; lastName: string }[]
  >([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<
    { id: string; displayName: string }[]
  >([]);

  const refresh = () =>
    customFetch<{ data: typeof coAuthors }>(
      `/api/v1/posts/${postId}/co-authors`,
      { method: "GET" },
    ).then((res) => setCoAuthors(res.data ?? []));

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = window.setTimeout(() => {
      customFetch<{ data: typeof results }>(
        `/users?q=${encodeURIComponent(query.trim())}`,
        { method: "GET" },
      )
        .then((res) => setResults(res.data ?? []))
        .catch(() => setResults([]));
    }, 250);
    return () => window.clearTimeout(t);
  }, [query]);

  const add = async (userId: string) => {
    try {
      await customFetch(`/api/v1/posts/${postId}/co-authors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      setQuery("");
      setResults([]);
      await refresh();
      toast({ title: "Co-author added" });
    } catch {
      toast({ title: "Couldn't add co-author", variant: "destructive" });
    }
  };

  const remove = async (userId: string) => {
    try {
      await customFetch(`/api/v1/posts/${postId}/co-authors/${userId}`, {
        method: "DELETE",
      });
      await refresh();
    } catch {
      toast({ title: "Couldn't remove", variant: "destructive" });
    }
  };

  return (
    <Card className="mt-6 rounded-xl border border-border shadow-sm">
      <CardContent className="p-6">
        <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-3">
          Co-authors
        </h3>
        {coAuthors.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            No co-authors yet.
          </p>
        ) : (
          <div className="space-y-2 mb-3">
            {coAuthors.map((u) => (
              <div
                key={u.id}
                className="flex items-center justify-between gap-2 p-2 rounded-md border border-border bg-muted/30"
              >
                <span className="text-sm font-bold">
                  {u.firstName} {u.lastName}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => remove(u.id)}
                  className="h-7 px-2 text-xs"
                  data-testid={`button-remove-coauthor-${u.id}`}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        )}
        <div className="relative">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search teammates to add as co-author..."
            data-testid="input-search-coauthor"
          />
          {results.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-md shadow-md z-10 max-h-56 overflow-y-auto">
              {results
                .filter(
                  (u) =>
                    u.id !== myId && !coAuthors.some((c) => c.id === u.id),
                )
                .map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => add(u.id)}
                    className="w-full text-left p-2 hover:bg-muted text-sm font-semibold"
                    data-testid={`button-add-coauthor-${u.id}`}
                  >
                    {u.displayName}
                  </button>
                ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
