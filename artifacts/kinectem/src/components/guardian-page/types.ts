import type { ChildNotificationItem } from "@workspace/api-client-react";

export interface Child {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  email: string | null;
  avatarUrl: string | null;
  requireTagConsent: boolean;
  guardianEmail: string | null;
  guardianConfirmedAt: string | null;
  confirmationStatus: "none" | "confirmed" | "pending" | "expired";
  confirmedByMe: boolean;
}

export interface SearchUser {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  email: string | null;
  avatarUrl: string | null;
}

export interface ChildNotificationsState {
  loading: boolean;
  items: ChildNotificationItem[];
  unreadCount: number;
  // When true, the next fetch (and refresh) for this child requests
  // `?includeDecided=true` so the "Recently decided" history strip is
  // populated alongside the still-undecided items. Defaults to false so
  // the dashboard stays focused on what still needs attention.
  showDecided?: boolean;
}

export interface PendingTeamInvite {
  entryId: string;
  teamId: string;
  teamName: string;
  teamLogoUrl: string | null;
  organization: { id: string; name: string };
  role: string;
  position: string | null;
  invitedAt: string;
  invitedBy: {
    id: string;
    displayName: string;
    avatarUrl: string | null;
  } | null;
}

export type DecisionInFlight = {
  itemKey: string;
  decision: "approved" | "removed";
} | null;
