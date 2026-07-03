import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetMyPinnedOrgs,
  useUpdateMyPinnedOrgs,
  getGetMyPinnedOrgsQueryKey,
  useGetLoggedInUser,
  queryOpts,
  type PinnedOrgsResponse,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

export const MAX_PINNED_ORGS = 5;

/**
 * The viewer's own personalization: up to 5 pinned orgs that float to the
 * top of the "Your Orgs and Teams" sidebar on the feed. Backed by
 * GET/PUT /users/me/pinned-orgs. Pinning is only available while logged in;
 * `enabled` reflects that so logged-out visitors get no toggles and no 401s.
 */
export function usePinnedOrgs() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: me } = useGetLoggedInUser();
  const enabled = !!me?.id;

  const { data } = useGetMyPinnedOrgs({
    query: queryOpts<PinnedOrgsResponse>({ enabled }),
  });

  const pinnedIds = useMemo(() => data?.orgIds ?? [], [data?.orgIds]);
  const pinnedSet = useMemo(() => new Set(pinnedIds), [pinnedIds]);

  const queryKey = getGetMyPinnedOrgsQueryKey();

  const mutation = useUpdateMyPinnedOrgs({
    mutation: {
      // Optimistically reflect the new order so the star + sort update
      // instantly; roll back on error.
      onMutate: async ({ data: body }) => {
        await qc.cancelQueries({ queryKey });
        const previous = qc.getQueryData<PinnedOrgsResponse>(queryKey);
        qc.setQueryData<PinnedOrgsResponse>(queryKey, {
          orgIds: body.orgIds ?? [],
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
    (orgId: string) => pinnedSet.has(orgId),
    [pinnedSet],
  );

  const canPinMore = pinnedIds.length < MAX_PINNED_ORGS;

  const togglePin = useCallback(
    (orgId: string) => {
      const already = pinnedSet.has(orgId);
      if (!already && pinnedIds.length >= MAX_PINNED_ORGS) {
        toast({
          title: `You can pin up to ${MAX_PINNED_ORGS} organizations`,
          description: "Unpin one first to make room.",
        });
        return;
      }
      const next = already
        ? pinnedIds.filter((id) => id !== orgId)
        : [...pinnedIds, orgId];
      mutation.mutate({ data: { orgIds: next } });
    },
    [pinnedSet, pinnedIds, mutation, toast],
  );

  return {
    enabled,
    pinnedIds,
    pinnedSet,
    isPinned,
    canPinMore,
    togglePin,
  };
}
