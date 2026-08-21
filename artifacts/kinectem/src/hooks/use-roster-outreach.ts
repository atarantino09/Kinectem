import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";

export interface OutreachTeam {
  id: string;
  name: string;
  sport: string;
  season?: string;
  level?: string;
  gender?: string;
  sentAt: string | null;
  sentBy: { id: string; displayName: string } | null;
}

export interface PreparedMessage {
  teamId: string;
  message: string;
  joinLink: string;
}

export interface OutreachStatus {
  teamId: string;
  sentAt: string | null;
  sentBy: { id: string; displayName: string } | null;
}

export function useGetRosterOutreach(orgId: string) {
  return useQuery({
    queryKey: ["org-roster-outreach", orgId],
    queryFn: () =>
      customFetch<{ data: OutreachTeam[] }>(`/api/v1/organizations/${orgId}/roster-outreach`, {
        method: "GET",
      }),
    enabled: !!orgId,
    refetchInterval: 30_000,
  });
}

export function usePrepareOutreachMessage(orgId: string, teamId: string) {
  return useMutation({
    mutationFn: () =>
      customFetch<PreparedMessage>(`/api/v1/organizations/${orgId}/roster-outreach/${teamId}/message`, {
        method: "POST",
      }),
  });
}

export function useUpdateOutreachStatus(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ teamId, sent }: { teamId: string; sent: boolean }) =>
      customFetch<OutreachStatus>(`/api/v1/organizations/${orgId}/roster-outreach/${teamId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sent }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["org-roster-outreach", orgId] });
    },
  });
}
