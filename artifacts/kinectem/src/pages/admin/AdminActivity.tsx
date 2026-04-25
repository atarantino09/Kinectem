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

  const params = new URLSearchParams();
  if (adminUserId) params.set("adminUserId", adminUserId);
  if (actionType) params.set("actionType", actionType);
  params.set("limit", String(PAGE_SIZE));
  params.set("offset", String(page * PAGE_SIZE));

  const { data, isLoading } = useQuery<ActivityResponse>({
    queryKey: ["admin", "activity", adminUserId, actionType, page],
    queryFn: () =>
      customFetch<ActivityResponse>(`/api/v1/admin/activity?${params}`, {
        method: "GET",
      }),
  });

  const { data: adminsList } = useQuery<{
    data: Array<{ id: string; name: string; email: string }>;
  }>({
    queryKey: ["admin", "activity", "admins"],
    queryFn: () =>
      customFetch<{ data: Array<{ id: string; name: string; email: string }> }>(
        "/api/v1/admin/activity/admins",
        { method: "GET" },
      ),
  });

  const totalCount = data?.pagination.totalCount ?? 0;
  const showingFrom = totalCount === 0 ? 0 : page * PAGE_SIZE + 1;
  const showingTo = Math.min(totalCount, page * PAGE_SIZE + (data?.data.length ?? 0));

  return (
    <AdminLayout>
      <h1 className="text-2xl font-black mb-4">Activity log</h1>
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <Select
          value={adminUserId || "all"}
          onValueChange={(v) => {
            setPage(0);
            setAdminUserId(v === "all" ? "" : v);
          }}
        >
          <SelectTrigger className="w-56" data-testid="select-admin-filter">
            <SelectValue placeholder="All admins" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All admins</SelectItem>
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
            {ACTION_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(adminUserId || actionType) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setAdminUserId("");
              setActionType("");
              setPage(0);
            }}
          >
            Clear filters
          </Button>
        )}
      </div>
      {isLoading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : (data?.data ?? []).length === 0 ? (
        <Card>
          <CardContent className="p-6 text-muted-foreground text-sm">
            No admin actions match the current filters.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {(data?.data ?? []).map((a) => (
            <Card key={a.id} data-testid={`activity-${a.id}`}>
              <CardContent className="p-3 flex items-center gap-3 flex-wrap">
                <Badge variant="outline">{a.actionType}</Badge>
                {a.targetType && <Badge variant="secondary">{a.targetType}</Badge>}
                <span className="text-sm font-medium">
                  {a.admin?.name ?? "Unknown admin"}
                </span>
                {a.targetId && (
                  <span className="text-sm text-muted-foreground">
                    → {a.targetId.slice(0, 8)}
                  </span>
                )}
                {a.metadata && Object.keys(a.metadata).length > 0 && (
                  <span className="text-xs text-muted-foreground font-mono truncate">
                    {JSON.stringify(a.metadata)}
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
