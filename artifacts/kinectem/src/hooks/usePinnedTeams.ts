import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetMyPinnedTeams,
  useUpdateMyPinnedTeams,
  getGetMyPinnedTeamsQueryKey,
  useGetLoggedInUser,
  queryOpts,
  type PinnedTeamsResponse,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

export const MAX_PINNED_TEAMS_PER_ORG = 5;

/**
 * The viewer's own personalization: pinned teams that float to the top of
 * their team lists (feed sidebar, profile Teams card, org page rail). The cap
 * is 5 pinned teams PER organization (independent/solo teams share one
 * "no-org" bucket). Callers pass the sibling team ids of the toggled team's
 * bucket to `togglePin` so the cap is scoped correctly. Backed by
 * GET/PUT /users/me/pinned-teams. Pinning is only available while logged in;
 * `enabled` reflects that so logged-out visitors get no toggles and no 401s.
 */
export function usePinnedTeams() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: me } = useGetLoggedInUser();
  const enabled = !!me?.id;

  const { data } = useGetMyPinnedTeams({
    query: queryOpts<PinnedTeamsResponse>({ enabled }),
  });

  const pinnedIds = useMemo(() => data?.teamIds ?? [], [data?.teamIds]);
  const pinnedSet = useMemo(() => new Set(pinnedIds), [pinnedIds]);

  const queryKey = getGetMyPinnedTeamsQueryKey();

  const mutation = useUpdateMyPinnedTeams({
    mutation: {
      // Optimistically reflect the new order so the star + sort update
      // instantly; roll back on error.
      onMutate: async ({ data: body }) => {
        await qc.cancelQueries({ queryKey });
        const previous = qc.getQueryData<PinnedTeamsResponse>(queryKey);
        qc.setQueryData<PinnedTeamsResponse>(queryKey, {
          teamIds: body.teamIds ?? [],
        });
        return { previous };
      },
      onError: (_err, _vars, ctx) => {
        if (ctx?.previous) qc.setQueryData(queryKey, ctx.previous);
        toast({
          title: "Couldn't update pins",
          description: "Please try again.",
          variant: "destructive",
        });
      },
      onSettled: () => {
        qc.invalidateQueries({ queryKey });
      },
    },
  });

  const isPinned = useCallback(
    (teamId: string) => pinnedSet.has(teamId),
    [pinnedSet],
  );

  /**
   * Toggle a team's pin. `groupTeamIds` is the full set of team ids that share
   * the toggled team's bucket (its organization, or the independent/solo
   * group). It's used to enforce the per-org cap of 5 when pinning.
   */
  const togglePin = useCallback(
    (teamId: string, groupTeamIds: string[]) => {
      const already = pinnedSet.has(teamId);
      if (!already) {
        const pinnedInGroup = groupTeamIds.reduce(
          (n, id) => (pinnedSet.has(id) ? n + 1 : n),
          0,
        );
        if (pinnedInGroup >= MAX_PINNED_TEAMS_PER_ORG) {
          toast({
            title: `You can pin up to ${MAX_PINNED_TEAMS_PER_ORG} teams per organization`,
            description: "Unpin one first to make room.",
          });
          return;
        }
      }
      const next = already
        ? pinnedIds.filter((id) => id !== teamId)
        : [...pinnedIds, teamId];
      mutation.mutate({ data: { teamIds: next } });
    },
    [pinnedSet, pinnedIds, mutation, toast],
  );

  return {
    enabled,
    pinnedIds,
    pinnedSet,
    isPinned,
    togglePin,
  };
}
