import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";

export type PracticePlan = {
  id: string;
  title: string;
  body: string;
  status: "draft" | "published";
  practiceDates: string[];
  createdAt: string;
  author?: {
    displayName?: string;
  } | null;
};

export const getListPracticePlansQueryKey = (teamId: string) => ["team-practice-plans", teamId];

export function useListPracticePlans(teamId: string, enabled: boolean) {
  return useQuery({
    queryKey: getListPracticePlansQueryKey(teamId),
    queryFn: async () => {
      const res = await customFetch<{ data: PracticePlan[] }>(`/api/v1/teams/${teamId}/practice-plans`);
      return res.data;
    },
    enabled,
  });
}

export function useCreatePracticePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ teamId, data }: { teamId: string; data: { title: string; body: string; practiceDates: string[]; status: "draft" | "published" } }) => {
      const res = await customFetch<{ data: PracticePlan }>(`/api/v1/teams/${teamId}/practice-plans`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      return res.data;
    },
    onSuccess: (_, { teamId }) => {
      qc.invalidateQueries({ queryKey: getListPracticePlansQueryKey(teamId) });
    },
  });
}

export function useUpdatePracticePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ teamId, planId, data }: { teamId: string; planId: string; data: { title?: string; body?: string; practiceDates?: string[]; status?: "draft" | "published" } }) => {
      const res = await customFetch<{ data: PracticePlan }>(`/api/v1/teams/${teamId}/practice-plans/${planId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      return res.data;
    },
    onSuccess: (_, { teamId }) => {
      qc.invalidateQueries({ queryKey: getListPracticePlansQueryKey(teamId) });
    },
  });
}
