import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { AdminLayout } from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

type ContentType = "article" | "highlight" | "org_post" | "comment";

type ContentItem = {
  id: string;
  type: ContentType;
  title: string;
  body: string;
  authorId: string | null;
  authorName: string | null;
  createdAt: string;
  hiddenAt: string | null;
};

type Report = {
  id: string;
  contentType: ContentType;
  contentId: string;
  reason: string;
  note: string | null;
  status: "open" | "resolved" | "dismissed";
  createdAt: string;
  resolvedAt: string | null;
  resolution: string | null;
  reporter: { id: string; name: string; email: string } | null;
  content: { title: string | null; body: string | null; hidden: boolean } | null;
};

export default function AdminModeration() {
  return (
    <AdminLayout>
      <h1 className="text-2xl font-black mb-4">Moderation</h1>
      <Tabs defaultValue="reports">
        <TabsList>
          <TabsTrigger value="reports" data-testid="tab-reports">Reports</TabsTrigger>
          <TabsTrigger value="content" data-testid="tab-content">Content</TabsTrigger>
          <TabsTrigger value="takedowns" data-testid="tab-takedowns">Takedowns</TabsTrigger>
        </TabsList>
        <TabsContent value="reports">
          <ReportsPanel />
        </TabsContent>
        <TabsContent value="content">
          <ContentPanel />
        </TabsContent>
        <TabsContent value="takedowns">
          <TakedownsPanel />
        </TabsContent>
      </Tabs>
    </AdminLayout>
  );
}

function ReportsPanel() {
  const [status, setStatus] = useState<"open" | "resolved" | "dismissed" | "all">("open");
  const qc = useQueryClient();
  const { toast } = useToast();

  const params = new URLSearchParams();
  if (status !== "all") params.set("status", status);

  const { data, isLoading } = useQuery<{ data: Report[] }>({
    queryKey: ["admin", "reports", status],
    queryFn: () =>
      customFetch<{ data: Report[] }>(`/api/v1/admin/reports?${params}`, {
        method: "GET",
      }),
  });

  const resolve = async (
    id: string,
    action: "dismiss" | "hide_content" | "delete_content" | "mark_resolved",
  ) => {
    try {
      await customFetch(`/api/v1/admin/reports/${id}/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      toast({ title: "Report processed" });
      qc.invalidateQueries({ queryKey: ["admin", "reports"] });
      qc.invalidateQueries({ queryKey: ["admin", "analytics"] });
    } catch (err) {
      toast({ title: "Failed", description: (err as Error).message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-3 mt-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">Status:</span>
        <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
          <SelectTrigger className="w-40" data-testid="select-report-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value="dismissed">Dismissed</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {isLoading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : (data?.data ?? []).length === 0 ? (
        <Card>
          <CardContent className="p-6 text-muted-foreground text-sm">
            No reports here.
          </CardContent>
        </Card>
      ) : (
        (data?.data ?? []).map((r) => (
          <Card key={r.id} data-testid={`report-${r.id}`}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline">{r.contentType}</Badge>
                <Badge
                  variant={r.status === "open" ? "destructive" : "secondary"}
                >
                  {r.status}
                </Badge>
                {r.content?.hidden && <Badge variant="outline">hidden</Badge>}
                <span className="text-xs text-muted-foreground ml-auto">
                  {new Date(r.createdAt).toLocaleString()}
                </span>
              </div>
              <div className="font-semibold">{r.reason}</div>
              {r.note && (
                <div className="text-sm text-muted-foreground italic">
                  "{r.note}"
                </div>
              )}
              <div className="text-sm">
                <span className="text-muted-foreground">Reported by:</span>{" "}
                {r.reporter ? `${r.reporter.name} (${r.reporter.email})` : "—"}
              </div>
              {r.content?.title && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Content:</span>{" "}
                  <span className="font-medium">{r.content.title}</span>
                </div>
              )}
              {r.content?.body && (
                <div className="text-sm border-l-2 border-muted-foreground pl-2 text-muted-foreground line-clamp-3">
                  {r.content.body}
                </div>
              )}
              {r.status === "open" && (
                <div className="flex gap-2 pt-2 flex-wrap">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => resolve(r.id, "dismiss")}
                    data-testid={`btn-dismiss-${r.id}`}
                  >
                    Dismiss
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => resolve(r.id, "hide_content")}
                    data-testid={`btn-hide-${r.id}`}
                  >
                    Hide content
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => {
                      if (confirm("Delete this content permanently?")) {
                        resolve(r.id, "delete_content");
                      }
                    }}
                    data-testid={`btn-delete-${r.id}`}
                  >
                    Delete content
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

type Takedown = {
  id: string;
  status: "pending" | "approved" | "declined";
  reason: string | null;
  createdAt: string;
  decidedAt: string | null;
  child: { id: string; name: string; email: string | null; avatarUrl: string | null } | null;
  guardian: { id: string; name: string; email: string | null } | null;
  post: { id: string; kind: "article" | "highlight" | "org_post"; title: string | null; exists: boolean };
};

function TakedownsPanel() {
  const [status, setStatus] = useState<"pending" | "approved" | "declined">("pending");
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<{ data: Takedown[] }>({
    queryKey: ["admin", "takedowns", status],
    queryFn: () =>
      customFetch<{ data: Takedown[] }>(`/api/v1/admin/takedowns?status=${status}`, {
        method: "GET",
      }),
  });

  const decide = async (id: string, decision: "approve" | "decline") => {
    if (decision === "approve" && !confirm("Approve takedown? This permanently deletes the post.")) {
      return;
    }
    try {
      await customFetch(`/api/v1/admin/takedowns/${id}/${decision}`, { method: "POST" });
      toast({ title: decision === "approve" ? "Post taken down" : "Takedown declined" });
      qc.invalidateQueries({ queryKey: ["admin", "takedowns"] });
    } catch (err) {
      toast({ title: "Failed", description: (err as Error).message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-3 mt-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">Status:</span>
        <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
          <SelectTrigger className="w-40" data-testid="select-takedown-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="declined">Declined</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {isLoading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : (data?.data ?? []).length === 0 ? (
        <Card>
          <CardContent className="p-6 text-muted-foreground text-sm">
            No takedown requests here.
          </CardContent>
        </Card>
      ) : (
        (data?.data ?? []).map((t) => (
          <Card key={t.id} data-testid={`takedown-${t.id}`}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline">{t.post.kind}</Badge>
                <Badge variant={t.status === "pending" ? "destructive" : "secondary"}>
                  {t.status}
                </Badge>
                {!t.post.exists && <Badge variant="outline">post deleted</Badge>}
                <span className="text-xs text-muted-foreground ml-auto">
                  {new Date(t.createdAt).toLocaleString()}
                </span>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">Child:</span>{" "}
                <span className="font-medium">{t.child?.name ?? "—"}</span>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">Guardian:</span>{" "}
                {t.guardian ? `${t.guardian.name} (${t.guardian.email ?? "—"})` : "—"}
              </div>
              {t.post.title && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Post:</span>{" "}
                  <span className="font-medium">{t.post.title}</span>
                </div>
              )}
              {t.reason && (
                <div className="text-sm border-l-2 border-muted-foreground pl-2 text-muted-foreground italic">
                  "{t.reason}"
                </div>
              )}
              {t.status === "pending" && (
                <div className="flex gap-2 pt-2 flex-wrap">
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => decide(t.id, "approve")}
                    data-testid={`btn-approve-takedown-${t.id}`}
                  >
                    Approve (delete post)
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => decide(t.id, "decline")}
                    data-testid={`btn-decline-takedown-${t.id}`}
                  >
                    Decline
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

function ContentPanel() {
  const [type, setType] = useState<ContentType>("article");
  const [q, setQ] = useState("");
  const [onlyHidden, setOnlyHidden] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();

  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (onlyHidden) params.set("hidden", "1");

  const { data, isLoading } = useQuery<{ data: ContentItem[] }>({
    queryKey: ["admin", "content", type, q, onlyHidden],
    queryFn: () =>
      customFetch<{ data: ContentItem[] }>(
        `/api/v1/admin/content/${type}?${params}`,
        { method: "GET" },
      ),
  });

  const refetch = () => qc.invalidateQueries({ queryKey: ["admin", "content"] });

  const hide = async (item: ContentItem) => {
    try {
      await customFetch(
        `/api/v1/admin/content/${type}/${item.id}/${item.hiddenAt ? "unhide" : "hide"}`,
        { method: "POST" },
      );
      toast({ title: item.hiddenAt ? "Content unhidden" : "Content hidden" });
      refetch();
    } catch (err) {
      toast({ title: "Failed", description: (err as Error).message, variant: "destructive" });
    }
  };

  const remove = async (item: ContentItem) => {
    if (!confirm("Delete this content permanently?")) return;
    try {
      await customFetch(`/api/v1/admin/content/${type}/${item.id}`, {
        method: "DELETE",
      });
      toast({ title: "Deleted" });
      refetch();
    } catch (err) {
      toast({ title: "Failed", description: (err as Error).message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-3 mt-3">
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={type} onValueChange={(v) => setType(v as ContentType)}>
          <SelectTrigger className="w-40" data-testid="select-content-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="article">Articles</SelectItem>
            <SelectItem value="highlight">Highlights</SelectItem>
            <SelectItem value="org_post">Org posts</SelectItem>
            <SelectItem value="comment">Comments</SelectItem>
          </SelectContent>
        </Select>
        <Input
          placeholder="Search…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
          data-testid="input-content-search"
        />
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={onlyHidden}
            onCheckedChange={setOnlyHidden}
            data-testid="switch-only-hidden"
          />
          Only hidden
        </label>
      </div>
      {isLoading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : (data?.data ?? []).length === 0 ? (
        <Card>
          <CardContent className="p-6 text-muted-foreground text-sm">
            No content found.
          </CardContent>
        </Card>
      ) : (
        (data?.data ?? []).map((item) => (
          <Card key={item.id} data-testid={`content-${item.id}`}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline">{item.type}</Badge>
                {item.hiddenAt && <Badge variant="secondary">hidden</Badge>}
                <span className="text-xs text-muted-foreground ml-auto">
                  {new Date(item.createdAt).toLocaleDateString()}
                </span>
              </div>
              <div className="font-semibold">{item.title}</div>
              <div className="text-sm text-muted-foreground line-clamp-3">
                {item.body}
              </div>
              <div className="text-xs text-muted-foreground">
                by {item.authorName ?? "Unknown"}
              </div>
              <div className="flex gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={() => hide(item)} data-testid={`btn-toggle-hide-${item.id}`}>
                  {item.hiddenAt ? "Unhide" : "Hide"}
                </Button>
                <Button size="sm" variant="destructive" onClick={() => remove(item)} data-testid={`btn-delete-content-${item.id}`}>
                  Delete
                </Button>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
