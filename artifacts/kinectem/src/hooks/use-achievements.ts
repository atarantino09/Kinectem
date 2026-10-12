import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";

export type AchievementSubject = "user" | "team" | "organization";
export type AchievementAward = { key: string; tier: 1 | 2 | 3; threshold: number; earnedAt: string; celebrated?: boolean };
export type AchievementCatalogItem = { key: string; name: string; subject: AchievementSubject; thresholds: number[]; criteria: string };
export type AchievementStreak = {
  teamId: string; teamName: string; current: number; best: number; paused: boolean;
  deadline: string | null; canPause?: boolean; status: "active" | "paused" | "expired" | "resumed"; lastDay: string | null;
};
export type AchievementsResponse = {
  subject: AchievementSubject; id: string; canManage: boolean; visibility: "private" | "public";
  featured: string[]; catalog: AchievementCatalogItem[]; awards: AchievementAward[];
  progress?: Record<string, number>; streaks?: AchievementStreak[];
  participation?: { teamId: string; name: string; participating: boolean }[];
  rolloutAt: string; photoRecapId?: string | null;
};
export type Contributor = {
  id: string; name: string; role: string; teams: { id: string; name: string }[];
  awards: AchievementAward[]; featured: string[];
};

export const achievementsKey = (subject: AchievementSubject, id: string) => ["achievements", subject, id] as const;
export const contributorsKey = (orgId: string) => ["achievements", "contributors", orgId] as const;

const base = (s: AchievementSubject, id: string) => `/api/v1/achievements/${s}/${encodeURIComponent(id)}`;

export function useAchievements(subject: AchievementSubject, id: string, enabled = true) {
  return useQuery({
    queryKey: achievementsKey(subject, id),
    enabled: enabled && !!id,
    staleTime: 0,
    refetchInterval: 15_000,
    queryFn: () => customFetch<AchievementsResponse>(base(subject, id), { method: "GET" }),
  });
}

export function useOrgContributors(orgId: string, enabled = true) {
  return useQuery({
    queryKey: contributorsKey(orgId),
    enabled: enabled && !!orgId,
    staleTime: 0,
    refetchInterval: 15_000,
    queryFn: async () =>
      (await customFetch<{ data: Contributor[] }>(`/api/v1/organizations/${orgId}/contributors`, { method: "GET" })).data,
  });
}

function useBroadInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["achievements"] });
}

export function useUpdateAchievementSettings(subject: AchievementSubject, id: string) {
  const inv = useBroadInvalidate();
  return useMutation({
    mutationFn: (body: { visibility?: "private" | "public"; featured?: string[] }) =>
      customFetch<{ ok: true }>(base(subject, id), {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      }),
    onSuccess: inv,
  });
}

export function usePauseTeamStreak(teamId: string) {
  const inv = useBroadInvalidate();
  return useMutation({
    mutationFn: () =>
      customFetch<{ ok: true }>(`${base("team", teamId)}/pause`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmed: true }),
      }),
    onSuccess: inv,
  });
}

export function useAcknowledgeAchievements(subject: AchievementSubject, id: string) {
  const inv = useBroadInvalidate();
  return useMutation({
    mutationFn: (keys?: string[]) =>
      customFetch<{ ok: true }>(`${base(subject, id)}/acknowledge`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(keys ? { keys } : {}),
      }),
    onSuccess: inv,
  });
}
