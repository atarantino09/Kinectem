import { useMemo } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import type { TeamOption, TeamOptionsPage } from "./model";

export function usePartnerTeamOptions({
  competitionId, pageId, clubId, search, enabled,
}: {
  competitionId: string;
  pageId: string;
  clubId: string;
  search: string;
  enabled: boolean;
}) {
  const query = useInfiniteQuery({
    queryKey: ["competition-partner-team-options", competitionId, "continuous", pageId, clubId, search],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams({ pageId });
      if (clubId) params.set("organizationId", clubId);
      if (search) params.set("q", search);
      if (pageParam) params.set("cursor", pageParam);
      const page = await customFetch<TeamOptionsPage>(
        `/api/v1/admin/competitions/${encodeURIComponent(competitionId)}/partner-team-options?${params}`,
        { method: "GET", signal },
      );
      if (!Array.isArray(page.data) || (page.hasMore && !page.nextCursor)) {
        throw new Error("The team list is incomplete. Reload the directory and try again.");
      }
      return page;
    },
    getNextPageParam: (page) => page.hasMore ? page.nextCursor : undefined,
    enabled,
    retry: false,
  });
  const data = useMemo(() => {
    const teams = new Map<string, TeamOption>();
    query.data?.pages.forEach((page) => page.data.forEach((team) => teams.set(team.id, team)));
    return { data: [...teams.values()], hasMore: query.hasNextPage };
  }, [query.data, query.hasNextPage]);
  return { ...query, data };
}

export function usePartnerTeamSuggestions({
  competitionId, pageId, participantId, enabled,
}: { competitionId: string; pageId: string; participantId: string | null; enabled: boolean }) {
  return useQuery({
    queryKey: ["competition-partner-team-options", competitionId, "suggestions", pageId, participantId],
    queryFn: ({ signal }) => customFetch<TeamOptionsPage>(
      `/api/v1/admin/competitions/${encodeURIComponent(competitionId)}/partner-team-options?${new URLSearchParams({
        pageId, suggestedFor: participantId!,
      })}`,
      { method: "GET", signal },
    ),
    enabled: enabled && !!participantId,
    retry: false,
  });
}
