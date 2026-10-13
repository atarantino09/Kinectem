import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { AdminLayout } from "@/components/AdminLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ActivityItem = {
  id: string;
  actionType: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  actorType: "user" | "admin";
  source: "activity" | "audit" | "historical";
  effectiveUserId: string | null;
  admin: { id: string; name: string; email: string } | null;
};

type ActivityResponse = {
  data: ActivityItem[];
  pagination: {
    nextCursor: string | null;
    hasMore: boolean;
    totalCount: number;
    limit: number;
    offset: number;
  };
};

const ACTION_TYPES = [
  "hide_content",
  "unhide_content",
  "delete_content",
  "resolve_report",
  "dismiss_report",
  "create_user",
  "update_user",
  "soft_delete_user",
  "restore_user",
  "reset_password",
  "masquerade_start",
  "masquerade_stop",
];

const PAGE_SIZE = 50;

export default function AdminActivity() {
  const [adminUserId, setAdminUserId] = useState<string>("");
  const [actionType, setActionType] = useState<string>("");
  const [page, setPage] = useState(0);
  const [actorType, setActorType] = useState("all");
  const [order, setOrder] = useState("newest");
  const [source, setSource] = useState("all");

  const params = new URLSearchParams();
  if (adminUserId) params.set("adminUserId", adminUserId);
  if (actionType) params.set("actionType", actionType);
  params.set("limit", String(PAGE_SIZE));
  params.set("actorType", actorType);
  params.set("order", order);
  params.set("source", source);
  params.set("offset", String(page * PAGE_SIZE));

  const { data, isLoading, isError } = useQuery<ActivityResponse>({
    queryKey: ["admin", "activity", adminUserId, actionType, actorType, order, source, page],
    refetchInterval: 30_000,
    queryFn: () =>
      customFetch<ActivityResponse>(`/api/v1/admin/activity?${params}`, {
        method: "GET",
      }),
  });

  const { data: adminsList } = useQuery<{
    data: Array<{ id: string; name: string; email: string }>;
  }>({
    queryKey: ["admin", "activity", "admins"],
    refetchInterval: 30_000,
    queryFn: () =>
      customFetch<{ data: Array<{ id: string; name: string; email: string }> }>(
        "/api/v1/admin/activity/admins",
        { method: "GET" },
      ),
  });

  const totalCount = data?.pagination.totalCount ?? 0;
  const { data: actions } = useQuery<{ data: string[] }>({
    queryKey: ["admin", "activity", "actions"],
    queryFn: () => customFetch("/api/v1/admin/activity/actions", { method: "GET" }),
    refetchInterval: 30_000,
  });
  const showingFrom = totalCount === 0 ? 0 : page * PAGE_SIZE + 1;
  const showingTo = Math.min(totalCount, page * PAGE_SIZE + (data?.data.length ?? 0));

  return (
    <AdminLayout>
      <h1 className="text-2xl font-black mb-4">Activity log</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Tracked account actions, audit details, and historical records recovered from saved data.
        Historical records are not a complete action history: removed records and earlier edits may be missing,
        and sign-ins and RSVPs show only the latest saved value. They may overlap tracked actions.
        For historical records, the person is associated with the record and the role is their current role.
        Admins means platform admins, not team or organization staff. Page views are not included.
      </p>
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <Select value={source} onValueChange={(v) => { setSource(v); setPage(0); }}>
          <SelectTrigger className="w-52" aria-label="Activity source"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            <SelectItem value="activity">Tracked actions</SelectItem>
            <SelectItem value="audit">Audit details</SelectItem>
            <SelectItem value="historical">Historical records</SelectItem>
          </SelectContent>
        </Select>
        <Select value={actorType} onValueChange={(v) => { setActorType(v); setPage(0); }}>
          <SelectTrigger className="w-44" aria-label="Activity by role"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All activity</SelectItem>
            <SelectItem value="user">Users only</SelectItem>
            <SelectItem value="admin">Admins only</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={adminUserId || "all"}
          onValueChange={(v) => {
            setPage(0);
            setAdminUserId(v === "all" ? "" : v);
          }}
        >
          <SelectTrigger className="w-56" data-testid="select-admin-filter">
            <SelectValue placeholder="All people" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All people</SelectItem>
            {(adminsList?.data ?? []).map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={actionType || "all"}
          onValueChange={(v) => {
            setPage(0);
            setActionType(v === "all" ? "" : v);
          }}
        >
          <SelectTrigger className="w-52" data-testid="select-action-filter">
            <SelectValue placeholder="All actions" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            {(actions?.data ?? ACTION_TYPES).map((t) => (
              <SelectItem key={t} value={t}>
                {t.replaceAll("_", " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={order} onValueChange={(v) => { setOrder(v); setPage(0); }}>
          <SelectTrigger className="w-40" aria-label="Sort activity"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Newest first</SelectItem>
            <SelectItem value="oldest">Oldest first</SelectItem>
          </SelectContent>
        </Select>
        {(adminUserId || actionType || actorType !== "all" || order !== "newest" || source !== "all") && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setAdminUserId("");
              setActionType("");
              setActorType("all");
              setOrder("newest");
              setSource("all");
              setPage(0);
            }}
          >
            Clear filters
          </Button>
        )}
      </div>
      {isError ? (
        <p role="alert" className="text-destructive">Could not load activity. Please try again.</p>
      ) : isLoading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : (data?.data ?? []).length === 0 ? (
        <Card>
          <CardContent className="p-6 text-muted-foreground text-sm">
            No activity matches the current filters.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {(data?.data ?? []).map((a) => (
            <Card key={a.id} data-testid={`activity-${a.id}`}>
              <CardContent className="p-3 flex items-center gap-3 flex-wrap">
                <Badge variant={a.actorType === "admin" ? "default" : "secondary"}>
                  {a.actorType === "admin" ? "Admin" : "User"}
                </Badge>
                <Badge variant="outline">{a.actionType.replaceAll("_", " ")}</Badge>
                {a.source === "audit" && <Badge variant="outline">Audit detail</Badge>}
                {a.source === "historical" && <Badge variant="outline">Historical record</Badge>}
                {a.effectiveUserId && <Badge variant="outline">Acting as another user</Badge>}
                {a.targetType && <Badge variant="secondary">{a.targetType}</Badge>}
                <span className="text-sm font-medium">
                  {a.admin?.name ?? "Unknown or deleted user"}
                </span>
                {a.targetId && (
                  <span className="text-sm text-muted-foreground">
                    → {a.targetId.slice(0, 8)}
                  </span>
                )}
                {a.metadata && Object.keys(a.metadata).length > 0 && (
                  <span className="text-xs text-muted-foreground break-words min-w-0">
                    {a.source === "historical" && typeof a.metadata.note === "string"
                      ? a.metadata.note : JSON.stringify(a.metadata)}
                  </span>
                )}
                <span className="text-xs text-muted-foreground ml-auto">
                  {new Date(a.createdAt).toLocaleString()}
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
        <div data-testid="activity-pagination-info">
          Showing {showingFrom}–{showingTo} of {totalCount}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            data-testid="btn-activity-prev"
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!data?.pagination.hasMore}
            onClick={() => setPage((p) => p + 1)}
            data-testid="btn-activity-next"
          >
            Next
          </Button>
        </div>
      </div>
    </AdminLayout>
  );
}
