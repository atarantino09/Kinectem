import { customFetch } from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Broadcasts (bulk messaging) — client types + fetch helpers.
//
// Like Schedule / Tournaments, the broadcast endpoints are intentionally NOT
// in the locked `openapi.yaml`, so there are no generated hooks/Zod schemas.
// We mirror the server response shapes here and talk to the API through the
// same `customFetch` pattern.
// ---------------------------------------------------------------------------

export type BroadcastScope = "organization" | "team";
export type BroadcastRecipientRole = "coach" | "player" | "parent";

export interface BroadcastSender {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

// A row in the viewer's inbox (GET /me/broadcasts).
export interface BroadcastInboxItem {
  id: string;
  scope: BroadcastScope;
  body: string;
  allowReplies: boolean;
  createdAt: string;
  sourceName: string | null;
  teamId: string | null;
  organizationId: string | null;
  sender: BroadcastSender | null;
  recipientRole: BroadcastRecipientRole;
  read: boolean;
  canReply: boolean;
}

export interface BroadcastReply {
  id: string;
  body: string;
  createdAt: string;
  sender: BroadcastSender | null;
  isMine: boolean;
}

// One private per-family thread. Parents see only their own; staff see all.
export interface BroadcastThread {
  familyParentUserId: string;
  familyName: string | null;
  replies: BroadcastReply[];
}

export interface BroadcastDetail {
  id: string;
  scope: BroadcastScope;
  body: string;
  allowReplies: boolean;
  createdAt: string;
  sourceName: string | null;
  teamId: string | null;
  organizationId: string | null;
  sender: BroadcastSender | null;
  recipientRole: BroadcastRecipientRole | null;
  read: boolean;
  isStaff: boolean;
  canReply: boolean;
  threads: BroadcastThread[];
}

export interface SendBroadcastResult {
  id: string;
  recipientCount: number;
}

// Query keys (kept local — these aren't generated).
export const inboxQueryKey = () => ["broadcasts", "inbox"] as const;
export const unreadCountQueryKey = () =>
  ["broadcasts", "unread-count"] as const;
export const broadcastDetailQueryKey = (id: string) =>
  ["broadcasts", "detail", id] as const;

export async function fetchInbox(): Promise<BroadcastInboxItem[]> {
  const res = await customFetch<{ data: BroadcastInboxItem[] }>(
    `/api/v1/me/broadcasts`,
  );
  return res.data;
}

export async function fetchUnreadCount(): Promise<number> {
  const res = await customFetch<{ count: number }>(
    `/api/v1/me/broadcasts/unread-count`,
  );
  return res.count;
}

export async function fetchBroadcast(id: string): Promise<BroadcastDetail> {
  return customFetch<BroadcastDetail>(`/api/v1/broadcasts/${id}`);
}

export async function sendOrgBroadcast(
  orgId: string,
  body: string,
): Promise<SendBroadcastResult> {
  return customFetch<SendBroadcastResult>(
    `/api/v1/organizations/${orgId}/broadcasts`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    },
  );
}

export async function sendTeamBroadcast(
  teamId: string,
  body: string,
): Promise<SendBroadcastResult> {
  return customFetch<SendBroadcastResult>(
    `/api/v1/teams/${teamId}/broadcasts`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    },
  );
}

export async function markBroadcastRead(id: string): Promise<void> {
  await customFetch(`/api/v1/broadcasts/${id}/read`, { method: "POST" });
}

// Parents omit `familyParentUserId` (server posts into their own thread);
// staff must name the family thread they're replying into.
export async function postBroadcastReply(
  id: string,
  body: string,
  familyParentUserId?: string,
): Promise<{ id: string }> {
  return customFetch<{ id: string }>(`/api/v1/broadcasts/${id}/replies`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      familyParentUserId ? { body, familyParentUserId } : { body },
    ),
  });
}

export const SCOPE_LABEL: Record<BroadcastScope, string> = {
  organization: "Organization",
  team: "Team",
};

// "Tue, Apr 14, 3:30 PM" style timestamp (local).
export function formatBroadcastTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
