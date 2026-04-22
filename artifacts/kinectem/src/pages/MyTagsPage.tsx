import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  customFetch,
  useGetLoggedInUser,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tag, Trash2, ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type TagItem = {
  id: string;
  kind: "article" | "highlight";
  postId: string;
  title: string;
  teamName: string;
  orgName: string;
  createdAt: string;
};

export default function MyTagsPage() {
  const { toast } = useToast();
  const { data: me } = useGetLoggedInUser();
  const [tags, setTags] = useState<TagItem[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [requireConsent, setRequireConsent] = useState<boolean>(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    customFetch<{ data: TagItem[] }>("/users/me/tags", { method: "GET" }).then(
      (r) => setTags(r.data ?? []),
      () => setTags([]),
    );
  }, []);

  useEffect(() => {
    if (me && "requireTagConsent" in me) {
      setRequireConsent(Boolean((me as { requireTagConsent?: boolean }).requireTagConsent));
    }
  }, [me]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const removeOne = async (t: TagItem) => {
    const path =
      t.kind === "article" ? `/article-tags/${t.id}` : `/highlight-tags/${t.id}`;
    try {
      await customFetch(path, { method: "DELETE" });
      setTags((cur) => (cur ? cur.filter((x) => x.id !== t.id) : cur));
      setSelected((prev) => {
        const n = new Set(prev);
        n.delete(t.id);
        return n;
      });
    } catch {
      toast({ title: "Couldn't remove tag", variant: "destructive" });
    }
  };

  const removeSelected = async () => {
    if (!tags || selected.size === 0) return;
    setBusy(true);
    try {
      const targets = tags.filter((t) => selected.has(t.id));
      await Promise.all(
        targets.map((t) =>
          customFetch(
            t.kind === "article"
              ? `/article-tags/${t.id}`
              : `/highlight-tags/${t.id}`,
            { method: "DELETE" },
          ),
        ),
      );
      setTags((cur) => (cur ? cur.filter((x) => !selected.has(x.id)) : cur));
      setSelected(new Set());
      toast({ title: `Removed ${targets.length} tag(s)` });
    } catch {
      toast({ title: "Couldn't remove some tags", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const onConsentChange = async (val: boolean) => {
    setRequireConsent(val);
    try {
      await customFetch("/users/me/tag-consent", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requireTagConsent: val }),
      });
    } catch {
      setRequireConsent(!val);
      toast({ title: "Couldn't update setting", variant: "destructive" });
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-black tracking-tight">My Tags</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Posts and highlights you've been tagged in. Remove any you don't want
          on your profile.
        </p>
      </div>

      <Card className="rounded-xl border border-border shadow-sm">
        <CardContent className="p-5 flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-primary mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-bold text-sm">
                  Require my approval before being tagged
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  New tags will go to a pending queue you can approve or
                  decline.
                </p>
              </div>
              <Switch
                checked={requireConsent}
                onCheckedChange={onConsentChange}
                data-testid="switch-tag-consent"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {selected.size > 0 && (
        <div className="sticky top-16 z-10 bg-card border border-border rounded-xl shadow-sm p-3 flex items-center justify-between">
          <span className="text-sm font-bold">{selected.size} selected</span>
          <Button
            variant="destructive"
            size="sm"
            onClick={removeSelected}
            disabled={busy}
            className="font-bold rounded-full"
            data-testid="button-bulk-remove"
          >
            <Trash2 className="w-4 h-4 mr-1.5" />
            Remove selected
          </Button>
        </div>
      )}

      {tags === null ? (
        <>
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
        </>
      ) : tags.length === 0 ? (
        <Card className="rounded-xl border border-dashed">
          <CardContent className="p-10 text-center">
            <Tag className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
            <p className="font-bold text-muted-foreground">
              You haven't been tagged in anything yet.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {tags.map((t) => (
            <Card
              key={t.id}
              className={`rounded-xl border ${
                selected.has(t.id) ? "border-primary" : "border-border"
              } shadow-sm`}
              data-testid={`card-tag-${t.id}`}
            >
              <CardContent className="p-4 flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={selected.has(t.id)}
                  onChange={() => toggle(t.id)}
                  className="w-4 h-4 accent-primary"
                  data-testid={`checkbox-tag-${t.id}`}
                />
                <Link href={`/posts/${t.postId}`} className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-bold uppercase tracking-wider bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
                      {t.kind === "article" ? "Recap" : "Highlight"}
                    </span>
                    <span className="font-bold truncate">{t.title}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 font-semibold">
                    {t.teamName} · {t.orgName} ·{" "}
                    {new Date(t.createdAt).toLocaleDateString()}
                  </p>
                </Link>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeOne(t)}
                  className="text-destructive hover:bg-destructive/10"
                  data-testid={`button-remove-tag-${t.id}`}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
