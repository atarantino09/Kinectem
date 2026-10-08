import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";

// Results & tournament recaps — handwritten /api/v1 endpoints (outside the
// locked openapi.yaml), same customFetch pattern as the rest of the app.

export type SnapshotStatus = "ready" | "partial" | "blocked" | "unsupported";

export interface ResultGame {
  id: string;
  home: string;
  away: string;
  homeScore: number | null;
  awayScore: number | null;
  date: string;
  group: string;
  homeParticipantId: string | null;
  awayParticipantId: string | null;
}
export interface ResultStanding {
  team: string;
  position: number | null;
  points: number | null;
  participantId: string | null;
}
export interface ResultGroup {
  key: string;
  label: string;
  gender: string;
  age: string;
  bracketId: string | null;
  complete: boolean;
  games: ResultGame[];
  standings: ResultStanding[];
}
export interface Snapshot {
  id: string;
  competitionId: string;
  kind: "url" | "csv" | "paste";
  sourceUrl: string | null;
  importedAt: string;
  status: SnapshotStatus;
  message: string | null;
  groups: ResultGroup[];
  confirmed: boolean;
  resultsAsOf: string | null;
}
export interface Bracket {
  id: string;
  label: string;
  sortOrder: number;
}
export interface Participant {
  id: string;
  name: string;
  gender: string | null;
  age: string | null;
  division: string | null;
  bracket: string | null;
  bracketId: string | null;
  teamId: string | null;
}
export interface StoryContent {
  title: string;
  body: string;
  [k: string]: unknown;
}
export interface ManagedRecap {
  id: string;
  competitionId: string;
  bracketId: string;
  revision: number;
  draft: {
    title: string;
    body: string;
    importId: string;
    groupKey: string;
    sourceUrl: string | null;
    resultsAsOf: string | null;
    partial: boolean;
  };
  published: StoryContent | null;
  publishedAt: string | null;
  updatedAt: string;
}
export interface Workspace {
  imports: Snapshot[];
  recaps: ManagedRecap[];
  brackets: Bracket[];
  participants: Participant[];
}
export interface Coverage {
  id: string;
  title: string;
  teamId: string;
  teamName: string;
  bracketId: string | null;
  bracketLabel?: string | null;
  bracketOrder?: number | null;
  summary: string | null;
  gameDate: string | null;
}
export interface PublicStory {
  id: string;
  competitionId: string;
  bracketId: string;
  bracketLabel: string;
  bracketOrder: number;
  title: string;
  body: string;
  sourceUrl: string | null;
  resultsAsOf: string | null;
  partial: boolean;
  publishedAt: string;
  updatedAt: string;
  competition: {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
    brandColor: string | null;
    secondaryColor: string | null;
  };
  coverage: Coverage[];
}
export interface PublicRecaps {
  data: PublicStory[];
  coverage: Coverage[];
  unattributedCoverage: Coverage[];
}
export interface PlacementOption {
  teamId: string;
  teamName: string;
  placed: boolean;
}

const base = "/api/v1";
const json = (method: string, body: unknown) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const resultsKeys = {
  // User-dependent data is scoped by auth id so it never lingers across
  // sign-out / account switches.
  workspace: (cid: string, uid?: string | null) =>
    ["competition-results", cid, "workspace", uid ?? "anon"] as const,
  recaps: (cid: string) => ["competition-results", cid, "recaps"] as const,
  story: (id: string) => ["competition-story", id] as const,
  placements: (id: string, uid?: string | null) =>
    uid === undefined
      ? (["competition-story", id, "placements"] as const)
      : (["competition-story", id, "placements", uid ?? "anon"] as const),
  team: (teamId: string) => ["team-tournament-recaps", teamId] as const,
};

export const uuid = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 3) | 8).toString(16);
      });

export const api = {
  workspace: (cid: string) =>
    customFetch<Workspace>(`${base}/competitions/${cid}/results-workspace`),
  importResults: (
    cid: string,
    b: { kind: "url" | "csv" | "paste"; url?: string; text?: string; clientId: string },
  ) => customFetch<Snapshot>(`${base}/competitions/${cid}/results-import`, json("POST", b)),
  confirmImport: (
    cid: string,
    importId: string,
    b: { groups: ResultGroup[]; resultsAsOf: string; confirmed: true },
  ) =>
    customFetch<Snapshot>(
      `${base}/competitions/${cid}/results-import/${importId}`,
      json("PATCH", b),
    ),
  generate: (
    cid: string,
    b: {
      importId: string;
      groupKeys: string[];
      includeCoverage: boolean;
      requestId: string;
      expectedRevisions: Record<string, number>;
    },
  ) =>
    customFetch<{
      data: ManagedRecap[];
      errors: { groupKey: string; error: string; code: string }[];
    }>(`${base}/competitions/${cid}/tournament-recaps/generate`, json("POST", b)),
  createManual: (
    cid: string,
    b: { importId: string; groupKey: string; title: string; body: string },
  ) =>
    customFetch<ManagedRecap>(`${base}/competitions/${cid}/tournament-recaps`, json("POST", b)),
  saveRecap: (
    cid: string,
    id: string,
    b: { title: string; body: string; expectedRevision: number },
  ) =>
    customFetch<ManagedRecap>(
      `${base}/competitions/${cid}/tournament-recaps/${id}`,
      json("PATCH", b),
    ),
  publish: (cid: string, id: string, expectedRevision: number) =>
    customFetch<ManagedRecap>(
      `${base}/competitions/${cid}/tournament-recaps/${id}/publish`,
      json("POST", { expectedRevision }),
    ),
  unpublish: (cid: string, id: string, expectedRevision: number) =>
    customFetch<ManagedRecap>(
      `${base}/competitions/${cid}/tournament-recaps/${id}/unpublish`,
      json("POST", { expectedRevision }),
    ),
  remove: (cid: string, id: string, expectedRevision: number) =>
    customFetch<unknown>(
      `${base}/competitions/${cid}/tournament-recaps/${id}`,
      json("DELETE", { expectedRevision }),
    ),
  createBracket: (cid: string, label: string) =>
    customFetch<unknown>(`${base}/competitions/${cid}/brackets`, json("POST", { label })),
  publicRecaps: (cid: string) =>
    customFetch<PublicRecaps>(`${base}/competitions/${cid}/tournament-recaps`),
  story: (id: string) => customFetch<PublicStory>(`${base}/competition-stories/${id}`),
  placementOptions: (id: string) =>
    customFetch<{ data: PlacementOption[] }>(
      `${base}/competition-stories/${id}/placement-options`,
    ),
  place: (id: string, teamId: string) =>
    customFetch<unknown>(
      `${base}/competition-stories/${id}/placements/${teamId}`,
      json("PUT", {}),
    ),
  unplace: (id: string, teamId: string) =>
    customFetch<unknown>(
      `${base}/competition-stories/${id}/placements/${teamId}`,
      { method: "DELETE" },
    ),
  teamRecaps: (teamId: string) =>
    customFetch<{ data: PublicStory[] }>(`${base}/teams/${teamId}/tournament-recaps`),
};

// ---- pure helpers (unit tested) ----

/** Every mapping the operator must have decided explicitly. */
export function mappingKeys(groups: ResultGroup[]): string[] {
  const keys: string[] = [];
  for (const g of groups) {
    keys.push(`g:${g.key}`);
    g.games.forEach((x) => keys.push(`m:${g.key}:${x.id}:home`, `m:${g.key}:${x.id}:away`));
    g.standings.forEach((_s, i) => keys.push(`s:${g.key}:${i}`));
  }
  return keys;
}
export function unresolvedMappings(groups: ResultGroup[], decided: Set<string>): string[] {
  return mappingKeys(groups).filter((k) => !decided.has(k));
}

/** Published stories grouped under their bracket in organizer order. */
export function sortStories(stories: PublicStory[]): PublicStory[] {
  return [...stories].sort(
    (a, b) =>
      a.bracketOrder - b.bracketOrder ||
      a.bracketLabel.localeCompare(b.bracketLabel, undefined, { numeric: true }),
  );
}

/** Merge placement cards with posts by date without touching post pagination. */
export function expectedRevisionsFor(
  groups: ResultGroup[],
  keys: string[],
  recaps: ManagedRecap[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const g of groups) {
    if (!keys.includes(g.key) || !g.bracketId) continue;
    out[g.bracketId] = recaps.find((r) => r.bracketId === g.bracketId)?.revision ?? 0;
  }
  return out;
}

export function storyHref(id: string): string {
  return `/competitions/stories/${encodeURIComponent(id)}`;
}

// ---- hooks ----

export function useWorkspace(cid: string, uid?: string | null) {
  return useQuery({
    queryKey: resultsKeys.workspace(cid, uid),
    queryFn: () => api.workspace(cid),
    enabled: !!cid && !!uid,
    gcTime: 0,
    retry: false,
    staleTime: 15_000,
  });
}
export function usePublicRecaps(cid: string | undefined) {
  return useQuery({
    queryKey: resultsKeys.recaps(cid ?? ""),
    queryFn: () => api.publicRecaps(cid!),
    enabled: !!cid,
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}
export function useStory(id: string) {
  return useQuery({
    queryKey: resultsKeys.story(id),
    queryFn: () => api.story(id),
    enabled: !!id,
    retry: false,
    staleTime: 30_000,
  });
}
export function useTeamRecaps(teamId: string) {
  return useQuery({
    queryKey: resultsKeys.team(teamId),
    queryFn: () => api.teamRecaps(teamId),
    enabled: !!teamId,
    retry: false,
    staleTime: 30_000,
  });
}
export function useInvalidateResults(cid: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["competition-results", cid] });
    qc.invalidateQueries({ queryKey: ["competition-story"] });
    qc.invalidateQueries({ queryKey: ["team-tournament-recaps"] });
    qc.invalidateQueries({ queryKey: ["competition"] });
  };
}
export { useMutation };

// ---- date / csv / matching helpers ----

const pad = (n: number) => String(n).padStart(2, "0");
/** ISO instant -> value for <input type="datetime-local"> in the viewer's zone. */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** datetime-local value (local time) -> ISO string with timezone (UTC Z). */
export function localInputToIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export const CSV_MAX_BYTES = 500 * 1024;
export const CSV_EXAMPLE =
  "Bracket,Home Team,Away Team,Home Score,Away Score\nBoys U12 Gold,Thunder FC,Lightning SC,3,1";
export function csvFileProblem(f: { name: string; size: number }): string | null {
  if (!/\.csv$/i.test(f.name)) return "Choose a .csv file.";
  if (f.size > CSV_MAX_BYTES) return "That file is over the 500 KB limit.";
  return null;
}

export const normName = (s: string | null | undefined) =>
  (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
/** All participants sharing a normalized name. Never picks one for the operator. */
export function nameCandidates(name: string, participants: Participant[]): Participant[] {
  const n = normName(name);
  return n ? participants.filter((p) => normName(p.name) === n) : [];
}
export const allScoresPresent = (g: ResultGroup) =>
  g.games.length > 0 && g.games.every((x) => x.homeScore !== null && x.awayScore !== null);
export function coverageIdsOf(stories: PublicStory[]): Set<string> {
  return new Set(stories.flatMap((s) => s.coverage.map((c) => c.id)));
}
