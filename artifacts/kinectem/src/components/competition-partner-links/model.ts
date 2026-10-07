import type { CompetitionParticipant } from "@/pages/CompetitionPage";

export const MAX_PARTNER_ASSIGNMENTS = 100;

export type PartnerPage = {
  id: string;
  slug: string;
  officialName: string;
  linked?: boolean;
  published?: boolean;
};
export type ClubRow = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  teamCount: number;
};
export type TeamOption = {
  id: string;
  name: string;
  organizationId: string;
  organizationName: string;
  city?: string | null;
  state?: string | null;
  gender?: string | null;
  level?: string | null;
  ageGroup?: string | null;
  archived?: boolean;
  slotStatus: null | "linked" | "pending";
};
export type TeamOptionsPage = {
  data: TeamOption[];
  hasMore: boolean;
  nextCursor: string | null;
};
export type LinkResult = {
  participantId: string;
  teamId: string;
  ok: boolean;
  code?: string;
  message?: string;
};
export type LinkResponse = {
  ok: boolean;
  succeeded: number;
  failed: number;
  results: LinkResult[];
};
export type Assignment = { team: TeamOption; ack: boolean };
export type StoredResult = LinkResult & { label: string; slot: string };

export function formatGender(g?: string | null): string {
  const s = (g ?? "").trim();
  if (!s) return "";
  const k = s.toLowerCase();
  if (["m", "b", "male", "boy", "boys"].includes(k)) return "Boys";
  if (["f", "female", "g", "girl", "girls"].includes(k)) return "Girls";
  if (["mixed", "coed", "co-ed", "co ed", "x"].includes(k)) return "Coed";
  return s;
}
export function sourceMeta(p: CompetitionParticipant) {
  return [p.age, formatGender(p.gender), [p.division, p.bracket].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(" · ");
}
export function teamMeta(t: TeamOption) {
  return [[formatGender(t.gender), t.level ?? t.ageGroup].filter(Boolean).join(" "), [t.city, t.state].filter(Boolean).join(", ")]
    .filter(Boolean)
    .join(" · ");
}
export function teamLabel(t: TeamOption) {
  return `${t.organizationName} / ${t.name}`;
}
export function optionUnavailable(t: TeamOption): string | null {
  if (t.archived) return "Archived team";
  if (t.slotStatus === "linked") return "Already linked to a competition team";
  if (t.slotStatus === "pending") return "Has a pending claim";
  return null;
}
export function slotUnavailable(p: CompetitionParticipant): string | null {
  if (p.hidden) return "Hidden";
  if (p.pending) return "Claim pending approval";
  if (p.claimed || p.teamId) return "Already assigned";
  return null;
}
