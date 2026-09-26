import { useState } from "react";
import { Link } from "wouter";
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

type ModerationTab =
  | "reports"
  | "content"
  | "takedowns"
  | "org-claims"
  | "competitions";

export function moderationTabFromSearch(search: string): ModerationTab {
  const params = new URLSearchParams(search);
  // Existing claim-review emails only carry claimId, so keep those links
  // working while newer emails also identify the tab explicitly.
  if (params.has("claimId")) return "org-claims";

  const requested = params.get("tab");
  if (
    requested === "reports" ||
    requested === "content" ||
    requested === "takedowns" ||
    requested === "org-claims" ||
    requested === "competitions"
  ) {
    return requested;
  }
  return "reports";
}

export default function AdminModeration() {
  const initialTab = moderationTabFromSearch(window.location.search);

  return (
    <AdminLayout>
      <h1 className="text-2xl font-black mb-4">Moderation</h1>
      <Tabs defaultValue={initialTab}>
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:inline-flex sm:h-9 sm:w-auto">
          <TabsTrigger value="reports" data-testid="tab-reports">Reports</TabsTrigger>
          <TabsTrigger value="content" data-testid="tab-content">Content</TabsTrigger>
          <TabsTrigger value="takedowns" data-testid="tab-takedowns">Takedowns</TabsTrigger>
          <TabsTrigger value="org-claims" data-testid="tab-org-claims">Org claims</TabsTrigger>
          <TabsTrigger value="competitions" className="col-span-2 sm:col-auto" data-testid="tab-competitions">Competitions</TabsTrigger>
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
        <TabsContent value="org-claims">
          <OrgClaimsPanel />
        </TabsContent>
        <TabsContent value="competitions">
          <CompetitionsModerationPanel />
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

type OrgClaim = {
  id: string;
  status: "pending" | "approved" | "declined";
  createdAt: string;
  decidedAt: string | null;
  organization: {
    id: string;
    name: string;
    city: string | null;
    state: string | null;
    logoUrl: string | null;
  } | null;
  requester: {
    id: string;
    name: string;
    email: string | null;
    avatarUrl: string | null;
  } | null;
  submittedOrganizationName: string | null;
  requesterFullName: string | null;
  requesterTitle: string | null;
  partner: {
    id: string;
    slug: string;
    officialName: string;
  } | null;
};

function OrgClaimsPanel() {
  const [status, setStatus] = useState<"pending" | "approved" | "declined">(
    "pending",
  );
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<{ data: OrgClaim[] }>({
    queryKey: ["admin", "org-claims", status],
    queryFn: () =>
      customFetch<{ data: OrgClaim[] }>(
        `/api/v1/admin/org-claims?status=${status}`,
        { method: "GET" },
      ),
  });

  const decide = async (id: string, decision: "approve" | "decline") => {
    if (
      decision === "approve" &&
      !confirm("Approve claim? This makes the requester the page owner.")
    ) {
      return;
    }
    try {
      await customFetch(`/api/v1/admin/org-claims/${id}/${decision}`, {
        method: "POST",
      });
      toast({
        title: decision === "approve" ? "Claim approved" : "Claim declined",
      });
      qc.invalidateQueries({ queryKey: ["admin", "org-claims"] });
    } catch (err) {
      toast({
        title: "Failed",
        description: (err as Error).message,
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-3 mt-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">Status:</span>
        <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
          <SelectTrigger className="w-40" data-testid="select-claim-status">
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
            No organization claims here.
          </CardContent>
        </Card>
      ) : (
        (data?.data ?? []).map((c) => (
          <Card key={c.id} data-testid={`org-claim-${c.id}`}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge
                  variant={c.status === "pending" ? "destructive" : "secondary"}
                >
                  {c.status}
                </Badge>
                <span className="text-xs text-muted-foreground ml-auto">
                  {new Date(c.createdAt).toLocaleString()}
                </span>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">Organization:</span>{" "}
                <span className="font-medium">
                  {c.organization?.name ?? "—"}
                </span>
                {c.organization?.city && (
                  <span className="text-muted-foreground">
                    {" "}
                    — {c.organization.city}
                    {c.organization.state ? `, ${c.organization.state}` : ""}
                  </span>
                )}
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">Requested by:</span>{" "}
                {c.requester
                  ? `${c.requester.name} (${c.requester.email ?? "—"})`
                  : "—"}
              </div>
              {(c.requesterFullName || c.requesterTitle || c.partner) && (
                <div className="grid gap-1 rounded-md border bg-muted/30 p-3 text-sm">
                  <div>
                    <span className="text-muted-foreground">Submitted organization:</span>{" "}
                    <span className="font-medium">{c.submittedOrganizationName ?? "—"}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Identity:</span>{" "}
                    <span className="font-medium">
                      {[c.requesterFullName, c.requesterTitle].filter(Boolean).join(" · ") || "—"}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Partner source:</span>{" "}
                    <span className="font-medium">
                      {c.partner ? `${c.partner.officialName} (/${c.partner.slug})` : "Direct / legacy request"}
                    </span>
                  </div>
                </div>
              )}
              {c.status === "pending" && (
                <div className="flex gap-2 pt-2 flex-wrap">
                  <Button
                    size="sm"
                    variant="brand"
                    onClick={() => decide(c.id, "approve")}
                    data-testid={`btn-approve-claim-${c.id}`}
                  >
                    Approve (grant ownership)
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => decide(c.id, "decline")}
                    data-testid={`btn-decline-claim-${c.id}`}
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

// Competitions moderation (§11) — self-serve competition pages are a public
// branding surface; admins can strip junk branding, rename, and unfeature
// recaps here. Reuses operator endpoints (platform admin passes the
// canOperateCompetition gate). customFetch — routes are outside openapi.yaml.
type CompetitionModRow = {
  id: string;
  slug: string;
  name: string;
  type: "tournament" | "league";
  startDate: string;
  endDate: string;
  location: string | null;
  ownerUserId: string | null;
  brandColor: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  websiteUrl: string | null;
  matchCount: number;
  participantCount: number;
  featuredCount: number;
  createdAt: string;
};

type CompetitionRecapRow = {
  id: string;
  title: string;
  teamName: string;
  featured: boolean;
  createdAt: string;
};

function CompetitionsModerationPanel() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<{ data: CompetitionModRow[] }>({
    queryKey: ["admin", "competitions", "moderation"],
    queryFn: () =>
      customFetch<{ data: CompetitionModRow[] }>(`/api/v1/admin/tournaments`, {
        method: "GET",
      }),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin", "competitions", "moderation"] });
    qc.invalidateQueries({ queryKey: ["competition"] });
  };

  const patch = async (id: string, body: Record<string, unknown>, done: string) => {
    try {
      await customFetch(`/api/v1/competitions/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      toast({ title: done });
      refresh();
    } catch (err) {
      toast({ title: "Failed", description: (err as Error).message, variant: "destructive" });
    }
  };

  const rows = data?.data ?? [];
  return (
    <div className="space-y-3 mt-3">
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No competitions yet.</p>
      ) : (
        rows.map((c) => (
          <CompetitionModCard key={c.id} row={c} onPatch={patch} />
        ))
      )}
    </div>
  );
}

function CompetitionModCard({
  row: c,
  onPatch,
}: {
  row: CompetitionModRow;
  onPatch: (id: string, body: Record<string, unknown>, done: string) => Promise<void>;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(c.name);
  const [showRecaps, setShowRecaps] = useState(false);

  const { data: recapData, isLoading: recapsLoading } = useQuery<{
    data: CompetitionRecapRow[];
  }>({
    queryKey: ["admin", "competition-recaps", c.id],
    queryFn: () =>
      customFetch<{ data: CompetitionRecapRow[] }>(
        `/api/v1/competitions/${c.id}/recaps`,
        { method: "GET" },
      ),
    enabled: showRecaps,
  });

  const unfeature = async (articleId: string) => {
    try {
      await customFetch(`/api/v1/competitions/${c.id}/recaps/${articleId}/feature`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ featured: false }),
      });
      toast({ title: "Recap removed from public rail" });
      qc.invalidateQueries({ queryKey: ["admin", "competition-recaps", c.id] });
      qc.invalidateQueries({ queryKey: ["admin", "competitions", "moderation"] });
    } catch (err) {
      toast({ title: "Failed", description: (err as Error).message, variant: "destructive" });
    }
  };

  const featuredRecaps = (recapData?.data ?? []).filter((r) => r.featured);
  const hasBranding = !!(c.brandColor || c.logoUrl || c.bannerUrl || c.websiteUrl);

  return (
    <Card data-testid={`card-mod-competition-${c.id}`}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            {c.logoUrl ? (
              <img
                src={c.logoUrl}
                alt=""
                className="h-10 w-10 rounded-md border border-border object-contain bg-background shrink-0"
              />
            ) : (
              <span
                className="h-10 w-10 rounded-md border border-border shrink-0"
                style={{ backgroundColor: c.brandColor ?? "#e2e8f0" }}
              />
            )}
            <div className="min-w-0">
              {renaming ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    maxLength={200}
                    className="h-8 w-56"
                    data-testid={`input-rename-${c.id}`}
                  />
                  <Button
                    size="sm"
                    variant="brand"
                    disabled={!newName.trim()}
                    onClick={async () => {
                      await onPatch(c.id, { name: newName.trim() }, "Competition renamed");
                      setRenaming(false);
                    }}
                    data-testid={`btn-rename-save-${c.id}`}
                  >
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setRenaming(false)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Link href={`/competitions/c/${c.slug}`}>
                  <p
                    className="font-bold truncate cursor-pointer hover:underline"
                    data-testid={`text-mod-comp-name-${c.id}`}
                  >
                    {c.name}
                  </p>
                </Link>
              )}
              <p className="text-xs text-muted-foreground truncate">
                /c/{c.slug} · {c.startDate} → {c.endDate}
                {c.location ? ` · ${c.location}` : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary" className="capitalize">{c.type}</Badge>
            {c.brandColor && (
              <span
                className="h-5 w-5 rounded border border-border"
                title={c.brandColor}
                style={{ backgroundColor: c.brandColor }}
              />
            )}
            {c.featuredCount > 0 && (
              <Badge variant="outline">{c.featuredCount} featured</Badge>
            )}
          </div>
        </div>
        {c.websiteUrl && (
          <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
            Website: {c.websiteUrl}
          </p>
        )}
        {c.bannerUrl && (
          <img
            src={c.bannerUrl}
            alt=""
            className="max-h-24 rounded-md border border-border object-contain"
          />
        )}
        <div className="flex gap-2 pt-1 flex-wrap">
          {!renaming && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setNewName(c.name);
                setRenaming(true);
              }}
              data-testid={`btn-rename-${c.id}`}
            >
              Rename
            </Button>
          )}
          {hasBranding && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                onPatch(
                  c.id,
                  { brandColor: null, logoUrl: null, bannerUrl: null, websiteUrl: null },
                  "Branding cleared",
                )
              }
              data-testid={`btn-clear-branding-${c.id}`}
            >
              Clear branding
            </Button>
          )}
          {c.featuredCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowRecaps((v) => !v)}
              data-testid={`btn-toggle-featured-${c.id}`}
            >
              {showRecaps ? "Hide featured recaps" : "Review featured recaps"}
            </Button>
          )}
        </div>
        {showRecaps && (
          <div className="space-y-2 border-t border-border pt-3">
            {recapsLoading ? (
              <p className="text-sm text-muted-foreground">Loading recaps…</p>
            ) : featuredRecaps.length === 0 ? (
              <p className="text-sm text-muted-foreground">No featured recaps.</p>
            ) : (
              featuredRecaps.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-2 text-sm"
                  data-testid={`row-featured-recap-${r.id}`}
                >
                  <span className="min-w-0 truncate">
                    <span className="font-semibold">{r.title}</span>{" "}
                    <span className="text-muted-foreground">— {r.teamName}</span>
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => unfeature(r.id)}
                    data-testid={`btn-unfeature-${r.id}`}
                  >
                    Unfeature
                  </Button>
                </div>
              ))
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
