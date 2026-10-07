import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import type { TeamOption } from "./model";

export function usePartnerTeamSuggestions(props: {
  competitionId: string;
  pageId: string;
  clubId: string;
  participantId: string | null;
  sourceName: string;
  enabled: boolean;
}) {
  return useQuery<{ data: TeamOption[]; hasMoreMatches: boolean }>({
    queryKey: ["competition-partner-team-suggestions", props.competitionId, props.pageId,
      props.clubId, props.participantId, props.sourceName],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ pageId: props.pageId, suggestFor: props.participantId! });
      if (props.clubId) params.set("organizationId", props.clubId);
      const response = await customFetch<{ data: TeamOption[]; hasMoreMatches: boolean }>(
        `/api/v1/admin/competitions/${encodeURIComponent(props.competitionId)}/partner-team-options?${params}`,
        { method: "GET", signal },
      );
      if (!Array.isArray(response.data) || typeof response.hasMoreMatches !== "boolean") {
        throw new Error("Could not check suggested team pages.");
      }
      return response;
    },
    enabled: props.enabled && !!props.participantId && !!props.pageId,
    retry: false,
  });
}
