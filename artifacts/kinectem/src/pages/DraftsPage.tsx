import { useEffect, useState } from "react";
import { Link } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

type DraftItem = {
  id: string;
  title?: string | null;
  description?: string | null;
  team?: { id: string; name: string };
  createdAt: string;
};

export default function DraftsPage() {
  const [drafts, setDrafts] = useState<DraftItem[] | null>(null);

  useEffect(() => {
    let mounted = true;
    customFetch<{ data: DraftItem[] }>("/drafts", { method: "GET" }).then(
      (res) => {
        if (mounted) setDrafts(res.data ?? []);
      },
      () => {
        if (mounted) setDrafts([]);
      },
    );
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Drafts</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Posts you're still working on, including ones you co-author.
          </p>
        </div>
        <Link href="/posts/new">
          <Button className="font-bold rounded-full" data-testid="button-new-draft">
            <Plus className="w-4 h-4 mr-1.5" /> New
          </Button>
        </Link>
      </div>

      {drafts === null ? (
        <>
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
        </>
      ) : drafts.length === 0 ? (
        <Card className="rounded-xl border border-dashed">
          <CardContent className="p-10 text-center">
            <FileText className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
            <p className="font-bold text-muted-foreground">No drafts yet.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Click "New" and choose Save Draft to come back later.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {drafts.map((d) => (
            <Link key={d.id} href={`/posts/new?draftId=${d.id}`}>
              <Card
                className="rounded-xl border border-border shadow-sm hover:border-primary/50 cursor-pointer transition-colors"
                data-testid={`card-draft-${d.id}`}
              >
                <CardContent className="p-4 flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center shrink-0">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <h3 className="font-black tracking-tight truncate">
                        {d.title || "Untitled draft"}
                      </h3>
                      <span className="text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
                        Draft
                      </span>
                    </div>
                    {d.description && (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                        {d.description}
                      </p>
                    )}
                    <div className="text-[11px] text-muted-foreground mt-2 font-semibold">
                      {d.team?.name ?? ""} •{" "}
                      {new Date(d.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
