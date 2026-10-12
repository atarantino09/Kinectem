import { createContext, useContext, useState, type ReactNode } from "react";
import { ACHIEVEMENT_CATALOG } from "./_catalog";

export type AchievementSubject = "user" | "team" | "organization";
export type AchievementAward = { key: string; tier: 1 | 2 | 3; threshold: number; earnedAt: string; celebrated?: boolean };
export type AchievementCatalogItem = { key: string; name: string; subject: AchievementSubject; thresholds: readonly number[]; criteria: string };
type Demo = {
  subject: AchievementSubject; id: string; canManage: boolean; visibility: "private" | "public";
  featured: string[]; catalog: AchievementCatalogItem[]; awards: AchievementAward[];
  progress: Record<string, number>; rolloutAt: string; photoRecapId: null;
  streaks: { teamId: string; teamName: string; current: number; best: number; deadline: string; canPause: boolean; status: string }[];
  participation: { teamId: string; name: string; participating: boolean }[];
};
const values: Record<string, number> = {
  "first-story": 18, "team-storyteller": 18, "reliable-reporter": 6, "beyond-scoreboard": 8, "retro-recapper": 0,
  "first-whistle": 28, "team-storytellers": 28, "on-a-roll": 6, "game-day-memories": 12,
  "our-story-begins": 126, "club-chroniclers": 126, "connected-club": 50,
};
const initial = Object.fromEntries((["team", "organization", "user"] as const).map((subject) => {
  const catalog = ACHIEVEMENT_CATALOG.filter((c) => c.subject === subject);
  const awards = catalog.flatMap((c) => {
    const tier = c.thresholds.filter((n) => values[c.key] >= n).length as 0 | 1 | 2 | 3;
    return tier ? [{ key: c.key, tier, threshold: c.thresholds[tier - 1], earnedAt: "2026-10-12", celebrated: true }] : [];
  });
  return [subject, {
    subject, id: subject, canManage: true, visibility: "public", catalog, awards,
    featured: awards.map((a) => a.key), progress: values, rolloutAt: "2026-10-12", photoRecapId: null,
    streaks: subject === "organization" ? [] : [{ teamId: "team", teamName: "Summit U12 Girls", current: 6, best: 6,
      deadline: "2026-10-20T23:59:59Z", canPause: true, status: "active" }],
    participation: subject === "organization" ? [
      { teamId: "team", name: "Summit U12 Girls", participating: true },
      { teamId: "team2", name: "Summit U11 Boys", participating: true },
      { teamId: "team3", name: "Summit U10 Girls", participating: false },
      { teamId: "team4", name: "Summit U13 Boys", participating: false },
    ] : [],
  }];
})) as Record<AchievementSubject, Demo>;
const Context = createContext({ data: initial, update: (_s: AchievementSubject, _patch: Partial<Demo>) => {} });
export function DemoProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState(initial);
  return <Context.Provider value={{ data, update: (subject, patch) => setData((old) => ({ ...old, [subject]: { ...old[subject], ...patch } })) }}>{children}</Context.Provider>;
}
export function useAchievements(subject: AchievementSubject) {
  return { data: useContext(Context).data[subject], isLoading: false, isError: false, error: null, refetch: () => {} };
}
export function useUpdateAchievementSettings(subject: AchievementSubject) {
  const context = useContext(Context);
  return { isPending: false, mutate: (patch: Partial<Demo>, options?: { onSuccess?: () => void }) => {
    context.update(subject, patch); options?.onSuccess?.();
  }};
}
export const useAcknowledgeAchievements = (_s: AchievementSubject, _id: string) => ({ mutate: () => {} });
export const usePauseTeamStreak = (_id: string) => ({ isPending: false, mutate: (_value?: unknown, options?: { onSuccess?: () => void }) => options?.onSuccess?.() });
export const useToast = () => ({ toast: () => {} });
export function useOrgContributors(_id: string) {
  const data = useContext(Context).data.user;
  return { isLoading: false, isError: false, refetch: () => {}, data: [
    { id: "coach1", name: "Jordan Rivera", role: "Coach", teams: [{ id: "team1", name: "Summit U12 Girls" }, { id: "team2", name: "Summit U11 Boys" }], awards: data.awards, featured: data.featured },
    { id: "coach2", name: "Morgan Ellis", role: "Coach", teams: [{ id: "team3", name: "Summit U10 Girls Development Academy" }], awards: data.awards.slice(0, 2), featured: data.featured.slice(0, 2) },
  ] };
}
export function Link({ href, children, ...props }: { href: string; children: ReactNode; className?: string }) {
  return <a href={href} {...props} onClick={(event) => event.preventDefault()}>{children}</a>;
}
