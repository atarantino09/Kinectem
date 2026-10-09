import { useRoute, Link } from "wouter";
import { featuredRecapBrackets } from "@/lib/featuredRecapBrackets";
import { CompetitionAlbumSection } from "@/components/competition-album/CompetitionAlbumSection";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  useGetLoggedInUser,
  type PostResponse,
} from "@workspace/api-client-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { AvatarLightbox } from "@/components/AvatarLightbox";
import { CompetitionPartnerLinks } from "@/components/competition-partner-links/CompetitionPartnerLinks";
import { CompetitionBrandStrip } from "@/components/CompetitionBrandStrip";
import { CompetitionHowItWorks } from "@/components/CompetitionHowItWorks";
import {
  CompetitionPartnerDirectory,
  type CompetitionPartnerPage,
} from "@/components/CompetitionPartnerDirectory";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuTrigger,
  DropdownMenuRadioGroup, DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  CalendarPlus,
  ChevronDown,
  EyeOff,
  ExternalLink,
  MapPin,
  Pencil,
  Search,
  Share2,
  Star,
  X,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  CompetitionClaimBanner,
  useClaimTokenParams,
  useCompetitionClaimResolve,
} from "@/components/ClaimTokenBanner";
import {
  competitionWeekForDate,
  formatCompetitionDate,
  formatCompetitionDateRange,
  formatCompetitionWeek,
  inclusiveDateSpan,
  type CompetitionWeek,
} from "@/lib/competition-weeks";
import { featuredRecapPreviewText } from "@/lib/featuredRecapPreview";
import { FeaturedRecapOrganization, featuredOrgPalette, type FeaturedRecapOrg } from "@/components/FeaturedRecapOrganization";
import { FitText } from "@/components/FitText";

// Competitions §9a — PUBLIC branded competition page (`/c/<slug>`). Distinct
// from org/team pages on purpose: the hero is themed with the operator's
// brand_color and shows their logo/banner, with Kinectem as a small credit.
// Legacy `/t/<slug>` links redirect here. Hand-written customFetch — these
// endpoints have no openapi.yaml entry (file is locked).

export type CompetitionParticipant = {
  id: string;
  name: string;
  division: string;
  bracket: string;
  age: string | null;
  gender: string | null;
  claimed: boolean;
  pending: boolean;
  teamId: string | null;
  // Task #865 — sorting bracket this team belongs to (null = "Other").
  bracketId?: string | null;
  // Operators only — public viewers never receive hidden slots.
  hidden?: boolean;
};

export type Match = {
  id: string;
  matchNumber: string;
  matchDate: string | null;
  startTime: string | null;
  age: string | null;
  gender: string | null;
  division: string;
  bracket: string;
  venue: string | null;
  venueState: string | null;
  field: string | null;
  homeName: string | null;
  awayName: string | null;
  homeParticipantId: string | null;
  awayParticipantId: string | null;
  homeTeamId?: string | null;
  awayTeamId?: string | null;
  // Task #765 — postponed/canceled games render with a status badge (+
  // optional reason) instead of silently disappearing.
  status?: "scheduled" | "postponed" | "canceled";
  statusReason?: string | null;
  week?: CompetitionWeek | null;
};

export type CompetitionMeta = {
  id: string;
  slug: string;
  name: string;
  type: "tournament" | "league";
  startDate: string;
  endDate: string;
  location: string | null;
  description: string | null;
  isActive: boolean;
  isEnded: boolean;
  autoApproveClaims: boolean;
  logoUrl: string | null;
  brandColor: string | null;
  secondaryColor: string | null;
  tertiaryColor: string | null;
  bannerUrl: string | null;
  websiteUrl: string | null;
  claimedCount: number;
  participantCount: number;
  canManage?: boolean;
  // Viewer follow state (quick-access follows; false when logged out).
  isFollowing?: boolean;
  // Parent-company hub (Task #723) — null when standalone.
  organizer?: {
    id: string;
    slug: string;
    name: string;
    logoUrl: string | null;
  } | null;
  partnerPages?: CompetitionPartnerPage[];
};

type FeaturedRecap = {
  id: string;
  title: string;
  body: string | null;
  summary: string | null;
  coverImageUrl: string | null;
  gameDate: string | null;
  opponentName: string | null;
  teamScore: number | null;
  opponentScore: number | null;
  teamId: string;
  teamName: string;
  organization?: FeaturedRecapOrg | null;
  publishedAt: string | null;
  // Task #852 — organizer-assigned sorting bracket (null = unbracketed).
  bracketId?: string | null;
  effectiveGameDate?: string | null;
  groupDivision?: string | null;
  groupBracket?: string | null;
  groupingSource?: "competition-game" | "recap";
  week?: CompetitionWeek | null;
};

// Task #852 — bracket labels in the organizer's saved order, driving the
// recap rail's filter chips.
type CompetitionBracketInfo = {
  id: string;
  label: string;
  gender: string | null;
  ageGroup: string | null;
};

type CompetitionResponse = {
  competition: CompetitionMeta;
  participants: CompetitionParticipant[];
  matches: Match[];
  featuredRecaps?: FeaturedRecap[];
  brackets?: CompetitionBracketInfo[];
};

function groupLabel(division: string, bracket: string): string {
  const parts = [division, bracket].filter((p) => p && p.trim() !== "");
  return parts.length ? parts.join(" · ") : "General";
}

function participantDisplayGroup(
  participant: CompetitionParticipant,
  brackets: CompetitionBracketInfo[],
): string {
  return (
    brackets.find((bracket) => bracket.id === participant.bracketId)?.label ??
    groupLabel(participant.division, participant.bracket)
  );
}

export type CompetitionTeamSection = {
  key: string;
  title: string;
  teams: CompetitionParticipant[];
};

export const teamNameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

function comparableText(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

export function ageGroupInfo(raw: string | null): {
  key: string;
  label: string;
  rank: number;
  number: number | null;
} {
  const value = comparableText(raw);
  if (!value) {
    return { key: "__missing__", label: "Age not listed", rank: 2, number: null };
  }
  const match = value.match(/\d+/);
  if (!match) {
    return { key: value.toLowerCase(), label: value, rank: 1, number: null };
  }
  return {
    key: value.toLowerCase(),
    label: value,
    rank: 0,
    number: Number.parseInt(match[0], 10),
  };
}

export function genderInfo(raw: string | null): {
  key: string;
  label: string;
  rank: number;
} {
  const value = comparableText(raw);
  const normalized = value.toLowerCase();
  if (["boys", "boy", "b", "m", "male", "men", "mens"].includes(normalized)) {
    return { key: "boys", label: "Boys", rank: 0 };
  }
  if (["girls", "girl", "g", "f", "female", "women", "womens"].includes(normalized)) {
    return { key: "girls", label: "Girls", rank: 1 };
  }
  if (["coed", "co-ed", "mixed", "x"].includes(normalized)) {
    return { key: "coed", label: "Coed", rank: 2 };
  }
  if (!value) {
    return { key: "__missing__", label: "Gender not listed", rank: 4 };
  }
  return { key: normalized, label: value, rank: 3 };
}

/**
 * Shared sort comparator for bracket-like objects.
 * Sort order: gender rank → age rank → age number (asc, nulls last) →
 * age label → groupKey tiebreaker.
 * Pass objects whose `gender` and `age` fields are already the results of
 * `genderInfo()` and `ageGroupInfo()` respectively.
 */
export function compareBracketsByGenderAge(
  a: {
    gender: ReturnType<typeof genderInfo>;
    age: ReturnType<typeof ageGroupInfo>;
    groupKey?: string;
  },
  b: {
    gender: ReturnType<typeof genderInfo>;
    age: ReturnType<typeof ageGroupInfo>;
    groupKey?: string;
  },
): number {
  if (a.gender.rank !== b.gender.rank) return a.gender.rank - b.gender.rank;
  if (a.age.rank !== b.age.rank) return a.age.rank - b.age.rank;
  if (a.age.number !== b.age.number) {
    if (a.age.number === null) return 1;
    if (b.age.number === null) return -1;
    return a.age.number - b.age.number;
  }
  const ageText = teamNameCollator.compare(a.age.label, b.age.label);
  if (ageText !== 0) return ageText;
  return teamNameCollator.compare(a.groupKey ?? "", b.groupKey ?? "");
}
/**
 * Group participants into labelled sections for the Teams list.
 *
 * All sections (bracket-linked and unlinked) are sorted by the unified
 * gender → age → group hierarchy: Boys first (youngest to oldest), then
 * Girls (youngest to oldest), then Coed, then unknown gender. Missing fields
 * sort last. Teams within a section are alphabetized.
 *
 * When a participant has a `bracketId` that resolves in the supplied brackets
 * list, that bracket's label is used as the section title. This means a rename
 * in the Brackets panel is immediately reflected on the public Teams list
 * without a re-upload.
 *
 * Participants without a matching bracketId fall back to the gender × age ×
 * division/bracket string grouping.
 */
export function competitionTeamSections(
  participants: CompetitionParticipant[],
  brackets: CompetitionBracketInfo[] = [],
): CompetitionTeamSection[] {
  const bracketById = new Map(brackets.map((b) => [b.id, b]));
  type Section = CompetitionTeamSection & {
    age: ReturnType<typeof ageGroupInfo>;
    gender: ReturnType<typeof genderInfo>;
    groupKey: string;
  };

  const byKey = new Map<string, Section>();
  for (const participant of participants) {
    const age = ageGroupInfo(participant.age);
    const gender = genderInfo(participant.gender);
    const group = comparableText(groupLabel(participant.division, participant.bracket));
    const groupKey = group.toLowerCase();
    // Preserve the schedule's raw age × gender × division/bracket identity
    // even when a bracket is linked. A single imported label can legitimately
    // span multiple ages or genders; grouping only by bracketId would merge
    // those separate sections.
    const rawGroupKey = JSON.stringify([
      participant.age,
      participant.gender,
      participant.division,
      participant.bracket,
    ]);

    // Bracket-linked: use the bracket label for presentation without changing
    // the underlying schedule-group identity or its gender/age sort metadata.
    if (participant.bracketId) {
      const b = bracketById.get(participant.bracketId);
      if (b) {
        const key = `__b__${participant.bracketId}\u0000${rawGroupKey}`;
        const cur = byKey.get(key);
        if (cur) {
          cur.teams.push(participant);
          continue;
        }
        const linkedAge = comparableText(participant.age)
          ? age
          : ageGroupInfo(b.ageGroup ?? null);
        const linkedGender = comparableText(participant.gender)
          ? gender
          : genderInfo(b.gender ?? null);
        byKey.set(key, {
          key,
          title: b.label,
          teams: [participant],
          age: linkedAge,
          gender: linkedGender,
          groupKey: b.label.toLowerCase(),
        });
        continue;
      }
    }
    // No bracketId or bracket missing from response: existing string logic.
    const key = `${age.key}\u0000${gender.key}\u0000${groupKey}`;
    const cur = byKey.get(key);
    if (cur) {
      cur.teams.push(participant);
      continue;
    }
    byKey.set(key, {
      key,
      // "General" is the no-bracket fallback — omit it so "Boys · U9" reads
      // more naturally than "Boys · U9 · General".
      title: group === "General"
        ? `${gender.label} · ${age.label}`
        : `${gender.label} · ${age.label} · ${group}`,
      teams: [participant],
      age,
      gender,
      groupKey,
    });
  }

  return Array.from(byKey.values())
    .sort((a, b) =>
      compareBracketsByGenderAge(a, b) ||
      teamNameCollator.compare(a.groupKey, b.groupKey),
    )
    .map(({ age: _age, gender: _gender, groupKey: _gk, ...section }) => ({
      ...section,
      teams: [...section.teams].sort(
        (a, b) => teamNameCollator.compare(a.name, b.name) || a.id.localeCompare(b.id),
      ),
    }));
}

function weekForItem(
  date: string | null | undefined,
  week: CompetitionWeek | null | undefined,
): CompetitionWeek | null {
  // A stale or malformed date must never inherit a week and disappear from
  // the visible Undated section.
  if (!date || !competitionWeekForDate(date)) return null;
  return week ?? competitionWeekForDate(date);
}

export function weekGroups<T extends {
  week?: CompetitionWeek | null;
  matchDate?: string | null;
}>(
  items: T[],
): { key: string; week: CompetitionWeek | null; items: T[] }[] {
  const grouped = new Map<string, { key: string; week: CompetitionWeek | null; items: T[] }>();
  for (const item of items) {
    const week = weekForItem(item.matchDate, item.week);
    const key = week?.key ?? "__undated__";
    const current = grouped.get(key) ?? { key, week, items: [] };
    current.items.push(item);
    grouped.set(key, current);
  }
  return Array.from(grouped.values()).sort((a, b) => {
    if (!a.week) return 1;
    if (!b.week) return -1;
    return a.week.key.localeCompare(b.week.key);
  });
}

function startTimeSortKey(value: string | null): string {
  if (!value) return "3:";
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/([AP])\.?M\.?$/, "$1M");
  const twelveHour =
    /^(\d{1,2})(?:[:.]([0-5]\d))?(?::([0-5]\d))?\s*([AP]M)$/.exec(
      normalized,
    );
  if (twelveHour) {
    const rawHour = Number(twelveHour[1]);
    if (rawHour < 1 || rawHour > 12) return `2:${normalized}`;
    let hour = rawHour % 12;
    if (twelveHour[4] === "PM") hour += 12;
    return `0:${String(hour).padStart(2, "0")}:${twelveHour[2] ?? "00"}:${
      twelveHour[3] ?? "00"
    }`;
  }
  const twentyFourHour =
    /^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(normalized);
  return twentyFourHour
    ? `0:${twentyFourHour[1].padStart(2, "0")}:${twentyFourHour[2]}:${
        twentyFourHour[3] ?? "00"
      }`
    : `2:${normalized}`;
}

function matchSort(a: Match, b: Match): number {
  const dateCompare = (a.matchDate ?? "").localeCompare(b.matchDate ?? "");
  if (dateCompare !== 0) return dateCompare;
  const timeCompare = startTimeSortKey(a.startTime).localeCompare(
    startTimeSortKey(b.startTime),
  );
  if (timeCompare !== 0) return timeCompare;
  return a.matchNumber.localeCompare(b.matchNumber, undefined, { numeric: true });
}

function scheduleOrder(a: Match, b: Match): number {
  const aHasDate = !!competitionWeekForDate(a.matchDate);
  const bHasDate = !!competitionWeekForDate(b.matchDate);
  if (aHasDate !== bHasDate) return aHasDate ? -1 : 1;
  if (aHasDate && bHasDate) return matchSort(a, b);

  const aHasInvalidDate = !!a.matchDate;
  const bHasInvalidDate = !!b.matchDate;
  if (aHasInvalidDate !== bHasInvalidDate) return aHasInvalidDate ? -1 : 1;
  return matchSort(a, b);
}

export function scheduleDateKeyForViewer(now: Date): string {
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

function parseStartTimeMinutes(value: string | null | undefined): number | null {
  const normalized = (value ?? "")
    .trim()
    .toUpperCase()
    .replace(/([AP])\.?M\.?$/, "$1M");
  const twelveHour =
    /^(\d{1,2})(?:[:.]([0-5]\d))?(?::([0-5]\d))?\s*([AP]M)$/.exec(
      normalized,
    );
  if (twelveHour) {
    const rawHour = Number(twelveHour[1]);
    if (rawHour < 1 || rawHour > 12) return null;
    let hour = rawHour % 12;
    if (twelveHour[4] === "PM") hour += 12;
    return hour * 60 + Number(twelveHour[2] ?? 0);
  }
  const twentyFourHour = /^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(
    normalized,
  );
  return twentyFourHour
    ? Number(twentyFourHour[1]) * 60 + Number(twentyFourHour[2])
    : null;
}

export function mapUrlForLocation(
  value: string | null | undefined,
): string | null {
  const location = (value ?? "").trim();
  if (
    !location ||
    location.length > 240 ||
    /[\u0000-\u001f\u007f]/.test(location)
  ) {
    return null;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    location,
  )}`;
}

function calendarDate(value: string): string {
  return value.replace(/-/g, "");
}

function calendarEscape(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function addCalendarDays(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("");
}

export function matchCalendarText(
  match: Pick<
    Match,
    "matchDate" | "startTime" | "homeName" | "awayName" | "venue" | "venueState" | "field"
  >,
  competitionName: string,
): string | null {
  if (!match.matchDate || !competitionWeekForDate(match.matchDate)) return null;
  const summary = `${match.homeName ?? "TBD"} vs ${match.awayName ?? "TBD"}`;
  const location = [match.venue, match.venueState, match.field]
    .filter(Boolean)
    .join(", ");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Kinectem//Competition Schedule//EN",
    "BEGIN:VEVENT",
    `UID:${calendarEscape(`${match.matchDate}-${summary}-${competitionName}`)}@kinectem`,
    `SUMMARY:${calendarEscape(`${summary} · ${competitionName}`)}`,
  ];
  const startMinutes = parseStartTimeMinutes(match.startTime);
  if (startMinutes === null) {
    lines.push(`DTSTART;VALUE=DATE:${calendarDate(match.matchDate)}`);
  } else {
    const hours = Math.floor(startMinutes / 60);
    const minutes = startMinutes % 60;
    const endMinutes = startMinutes + 120;
    const endHours = Math.floor(endMinutes / 60) % 24;
    const endMins = endMinutes % 60;
    const endDate =
      endMinutes >= 24 * 60
        ? addCalendarDays(match.matchDate, 1)
        : calendarDate(match.matchDate);
    const stamp = (h: number, m: number) =>
      `${String(h).padStart(2, "0")}${String(m).padStart(2, "0")}00`;
    lines.push(
      `DTSTART:${calendarDate(match.matchDate)}T${stamp(hours, minutes)}`,
      `DTEND:${endDate}T${stamp(endHours, endMins)}`,
    );
  }
  if (location) lines.push(`LOCATION:${calendarEscape(location)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}

export function scheduleWeekStateKey(groupLabelText: string, weekKey: string): string {
  return `${groupLabelText}\u0000${weekKey}`;
}

export function allScheduleWeekKeys(matchGroups: [string, Match[]][]): string[] {
  return matchGroups.flatMap(([label, matches]) =>
    weekGroups(matches).map((group) => scheduleWeekStateKey(label, group.key)),
  );
}

export function defaultOpenScheduleWeekKeys(
  matchGroups: [string, Match[]][],
  currentDate: Date | string = new Date(),
): string[] {
  const today =
    typeof currentDate === "string"
      ? currentDate
      : scheduleDateKeyForViewer(currentDate);
  const weeks = matchGroups.flatMap(([label, matches]) =>
    weekGroups(matches).map((group) => ({
      key: scheduleWeekStateKey(label, group.key),
      start: group.week?.start ?? null,
      end: group.week?.end ?? null,
    })),
  );
  const dated = weeks.filter((week) => week.start && week.end);
  const current = dated.filter(
    (week) => today >= week.start! && today <= week.end!,
  );
  if (current.length) return current.map((week) => week.key);

  const nextStart = dated
    .map((week) => week.start!)
    .filter((start) => start > today)
    .sort()[0];
  if (nextStart) {
    return dated
      .filter((week) => week.start === nextStart)
      .map((week) => week.key);
  }

  const undated = weeks.find((week) => week.start === null);
  return dated.length === 0 && undated ? [undated.key] : [];
}

const SHORT_TOURNAMENT_GROUP_KEY = "__competition_dates__";

export function isShortTournament(
  competition: Pick<CompetitionMeta, "type" | "startDate" | "endDate">,
): boolean {
  const span = inclusiveDateSpan(competition.startDate, competition.endDate);
  return competition.type === "tournament" && span !== null && span <= 3;
}

export function recapGroups<T extends {
  week?: CompetitionWeek | null;
  matchDate?: string | null;
}>(
  items: T[],
  competition: Pick<CompetitionMeta, "type" | "startDate" | "endDate">,
): { key: string; week: CompetitionWeek | null; items: T[] }[] {
  if (!isShortTournament(competition)) return weekGroups(items);

  const dated: T[] = [];
  const undated: T[] = [];
  for (const item of items) {
    if (weekForItem(item.matchDate, item.week)) dated.push(item);
    else undated.push(item);
  }

  return [
    ...(dated.length
      ? [{ key: SHORT_TOURNAMENT_GROUP_KEY, week: null, items: dated }]
      : []),
    ...(undated.length
      ? [{ key: "__undated__", week: null, items: undated }]
      : []),
  ];
}

// Pick a readable text color for the brand band (simple luminance check).
function contrastText(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 160 ? "#111111" : "#ffffff";
}

const DEFAULT_BRAND = "#1e293b";

export function isPublicFeaturedCompetitionRecap(
  post: PostResponse,
  competitionId: string,
): boolean {
  const postWithExtras = post as PostResponse & {
    articleStatus?: string | null;
    hidden?: boolean;
    competitionFeatured?: boolean;
    competition?: { id?: string } | null;
  };
  return (
    postWithExtras.articleStatus === "published" &&
    !postWithExtras.hidden &&
    postWithExtras.competitionFeatured === true &&
    postWithExtras.competition?.id === competitionId
  );
}

export default function CompetitionPage() {
  // Matched both as the standalone public page (`/c/<slug>`) and as the
  // in-app view inside the AppShell (`/competitions/c/<slug>`), so
  // logged-in users can browse a competition without leaving the app.
  const [, publicParams] = useRoute("/c/:slug");
  const [, appParams] = useRoute("/competitions/c/:slug");
  const slug = publicParams?.slug ?? appParams?.slug ?? "";
  const { data: me } = useGetLoggedInUser();
  const [teamsOpen, setTeamsOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleToday, setScheduleToday] = useState(() =>
    scheduleDateKeyForViewer(new Date()),
  );
  const [openScheduleWeeks, setOpenScheduleWeeks] = useState<Set<string>>(
    new Set(),
  );
  const scheduleWeeksInitializedFor = useRef<string | null>(null);
  const scheduleWeeksInitializedDay = useRef<string | null>(null);
  const scheduleWeeksInitializedFilters = useRef<string | null>(null);
  const scheduleWeeksTouched = useRef(false);
  // Task #852 — active bracket filter for the featured-recaps rail
  // "" = All; "__other__" = no known overall group.
  const [bracketFilter, setBracketFilter] = useState("");
  const [teamSearch, setTeamSearch] = useState("");
  const [teamGenderFilter, setTeamGenderFilter] = useState("all");
  const [teamAgeFilter, setTeamAgeFilter] = useState("all");
  const [teamGroupFilter, setTeamGroupFilter] = useState("all");
  const [scheduleSearch, setScheduleSearch] = useState("");
  const [scheduleGenderFilter, setScheduleGenderFilter] = useState("all");
  const [scheduleAgeFilter, setScheduleAgeFilter] = useState("all");
  const [scheduleGroupFilter, setScheduleGroupFilter] = useState("all");
  const [recapSearch, setRecapSearch] = useState("");
  const [recapTeamFilter, setRecapTeamFilter] = useState("all");
  const [recapDateFilter, setRecapDateFilter] = useState("all");
  // Task #854 — optional grouped layout: recaps under bracket headings in
  // the organizer's saved order, unbracketed last under "Other". Grouping
  // supersedes the chip filter, so chips hide while grouped.

  // Task #851 — a valid, unclaimed claim token means the viewer is the
  // prospective operator: show the "How your competition works" walkthrough
  // even though they can't manage yet, and start it expanded.
  const { token: claimToken } = useClaimTokenParams();
  const claimResolve = useCompetitionClaimResolve(claimToken);
  const isClaimVisitor =
    !!claimResolve.data &&
    claimResolve.data.competition.slug === slug &&
    !claimResolve.data.alreadyClaimed;

  const q = useQuery<CompetitionResponse>({
    queryKey: ["competition", slug],
    queryFn: () =>
      customFetch<CompetitionResponse>(
        `/api/v1/competitions/${encodeURIComponent(slug)}`,
        { method: "GET" },
      ),
    enabled: !!slug,
    retry: false,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  // Follow / unfollow — quick-access only (does NOT change the home feed).
  const qcTop = useQueryClient();
  const { toast } = useToast();
  // Hide / unhide a team slot from the public Teams list (operators only).
  const [pendingHide, setPendingHide] = useState<CompetitionParticipant | null>(null);
  // Task #866 — bulk hide: operators tick checkboxes next to visible teams,
  // then "Hide All (N)" hides the whole selection in one request.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkHideOpen, setBulkHideOpen] = useState(false);
  const toggleSelected = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const bulkHideMutation = useMutation({
    mutationFn: ({
      participantIds,
      competitionId,
    }: {
      participantIds: string[];
      competitionId: string;
    }) =>
      customFetch<{ ok: true; hiddenCount: number }>(
        `/api/v1/competitions/${competitionId}/participants/bulk-hide`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ participantIds }),
        },
      ),
    onSuccess: (r) => {
      setSelectedIds(new Set());
      qcTop.invalidateQueries({ queryKey: ["competition", slug] });
      toast({
        title: r.hiddenCount === 1 ? "1 team hidden" : `${r.hiddenCount} teams hidden`,
        description:
          "They no longer appear in the public Teams list. Only competition admins can see them.",
      });
    },
    onError: (err) =>
      toast({
        title: "Couldn't hide those teams",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      }),
  });
  const hideMutation = useMutation({
    mutationFn: ({
      participantId,
      hide,
      competitionId,
    }: {
      participantId: string;
      hide: boolean;
      competitionId: string;
    }) =>
      customFetch<{ ok: true; hidden: boolean }>(
        `/api/v1/competitions/${competitionId}/participants/${participantId}/hide`,
        { method: hide ? "POST" : "DELETE" },
      ),
    onSuccess: (r) => {
      qcTop.invalidateQueries({ queryKey: ["competition", slug] });
      toast({
        title: r.hidden ? "Team hidden" : "Team visible again",
        description: r.hidden
          ? "It no longer appears in the public Teams list. Only competition admins can see it."
          : "It's back in the public Teams list.",
      });
    },
    onError: (err) =>
      toast({
        title: "Couldn't update that team",
        description:
          err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      }),
  });
  const followMutation = useMutation({
    mutationFn: (follow: boolean) =>
      customFetch<{ ok: true; isFollowing: boolean }>(
        `/api/v1/competitions/${encodeURIComponent(slug)}/follow`,
        { method: follow ? "POST" : "DELETE" },
      ),
    onSuccess: (_result, follow) => {
      qcTop.invalidateQueries({ queryKey: ["competition", slug] });
      qcTop.invalidateQueries({ queryKey: ["my-followed-competitions"] });
      toast({
        title: follow ? "Competition followed" : "Competition unfollowed",
        description: follow
          ? "You’ll find this competition in your followed list."
          : "You can follow it again anytime.",
      });
    },
    onError: (err) =>
      toast({
        title: "Couldn't update your follow",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      }),
  });

  const scheduleFilterData = useMemo(() => {
    const matches = q.data?.matches ?? [];
    const genderOptions = new Map<string, string>();
    const ageOptions = new Map<string, string>();
    const groupOptions = new Map<string, string>();

    for (const match of matches) {
      const gender = genderInfo(match.gender);
      const age = ageGroupInfo(match.age);
      const group = groupLabel(match.division, match.bracket);
      genderOptions.set(gender.key, gender.label);
      ageOptions.set(age.key, age.label);
      groupOptions.set(group.toLowerCase(), group);
    }

    const search = scheduleSearch.trim().toLowerCase();
    const filtered = matches.filter((match) => {
      const gender = genderInfo(match.gender);
      const age = ageGroupInfo(match.age);
      const group = groupLabel(match.division, match.bracket);
      const searchableDetails = [
        match.matchNumber,
        match.homeName,
        match.awayName,
        match.matchDate,
        match.startTime,
        match.age,
        match.gender,
        match.division,
        match.bracket,
        group,
        match.venue,
        match.venueState,
        match.field,
        match.status,
        match.statusReason,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return (
        (!search || searchableDetails.includes(search)) &&
        (scheduleGenderFilter === "all" ||
          gender.key === scheduleGenderFilter) &&
        (scheduleAgeFilter === "all" || age.key === scheduleAgeFilter) &&
        (scheduleGroupFilter === "all" ||
          group.toLowerCase() === scheduleGroupFilter)
      );
    });

    return {
      filtered,
      genderOptions: Array.from(genderOptions, ([value, label]) => ({
        value,
        label,
      })).sort(
        (a, b) =>
          genderInfo(a.label).rank - genderInfo(b.label).rank ||
          teamNameCollator.compare(a.label, b.label),
      ),
      ageOptions: Array.from(ageOptions, ([value, label]) => ({
        value,
        label,
      })).sort((a, b) => {
        const left = ageGroupInfo(a.label);
        const right = ageGroupInfo(b.label);
        return (
          left.rank - right.rank ||
          (left.number ?? Number.MAX_SAFE_INTEGER) -
            (right.number ?? Number.MAX_SAFE_INTEGER) ||
          teamNameCollator.compare(left.label, right.label)
        );
      }),
      groupOptions: Array.from(groupOptions, ([value, label]) => ({
        value,
        label,
      })).sort((a, b) => teamNameCollator.compare(a.label, b.label)),
    };
  }, [
    q.data?.matches,
    scheduleAgeFilter,
    scheduleGenderFilter,
    scheduleGroupFilter,
    scheduleSearch,
  ]);

  const matchGroups = useMemo(() => {
    const map = new Map<string, Match[]>();
    for (const m of scheduleFilterData.filtered) {
      const key = groupLabel(m.division, m.bracket);
      const arr = map.get(key) ?? [];
      arr.push(m);
      map.set(key, arr);
    }
    return Array.from(map.entries())
      .map(([label, matches]) => [label, [...matches].sort(scheduleOrder)] as [string, Match[]])
      .sort((a, b) => {
        const firstCompare = scheduleOrder(a[1][0]!, b[1][0]!);
        return firstCompare || a[0].localeCompare(b[0]);
      });
  }, [scheduleFilterData.filtered]);

  useEffect(() => {
    let timer = 0;
    const scheduleNextDay = () => {
      const now = new Date();
      const nextDay = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
      );
      timer = window.setTimeout(() => {
        setScheduleToday(scheduleDateKeyForViewer(new Date()));
        scheduleNextDay();
      }, Math.max(1_000, nextDay.getTime() - now.getTime() + 100));
    };
    scheduleNextDay();
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (
      !q.data ||
      !matchGroups.length ||
      (scheduleWeeksInitializedFor.current === slug &&
        (scheduleWeeksInitializedDay.current === scheduleToday ||
          scheduleWeeksTouched.current))
    ) {
      return;
    }
    const initialKeys = defaultOpenScheduleWeekKeys(matchGroups, scheduleToday);
    setOpenScheduleWeeks(new Set(initialKeys));
    if (scheduleWeeksInitializedFor.current !== slug) {
      scheduleWeeksTouched.current = false;
    }
    scheduleWeeksInitializedFor.current = slug;
    scheduleWeeksInitializedDay.current = scheduleToday;
  }, [matchGroups, q.data, scheduleToday, slug]);

  const toggleScheduleWeek = (key: string, open: boolean) => {
    scheduleWeeksTouched.current = true;
    setOpenScheduleWeeks((current) => {
      const next = new Set(current);
      if (open) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const teamFilterData = useMemo(() => {
    const participants = q.data?.participants ?? [];
    const brackets = q.data?.brackets ?? [];
    const genderOptions = new Map<string, string>();
    const ageOptions = new Map<string, string>();
    const groupOptions = new Map<string, string>();

    for (const participant of participants) {
      const gender = genderInfo(participant.gender);
      const age = ageGroupInfo(participant.age);
      const group = participantDisplayGroup(participant, brackets);
      genderOptions.set(gender.key, gender.label);
      ageOptions.set(age.key, age.label);
      groupOptions.set(group.toLowerCase(), group);
    }

    const search = teamSearch.trim().toLowerCase();
    const filtered = participants.filter((participant) => {
      const gender = genderInfo(participant.gender);
      const age = ageGroupInfo(participant.age);
      const group = participantDisplayGroup(participant, brackets);
      const matchesSearch =
        !search ||
        [participant.name, gender.label, age.label, group]
          .join(" ")
          .toLowerCase()
          .includes(search);
      return (
        matchesSearch &&
        (teamGenderFilter === "all" || gender.key === teamGenderFilter) &&
        (teamAgeFilter === "all" || age.key === teamAgeFilter) &&
        (teamGroupFilter === "all" ||
          group.toLowerCase() === teamGroupFilter)
      );
    });

    return {
      filtered,
      genderOptions: Array.from(genderOptions, ([value, label]) => ({
        value,
        label,
      })).sort((a, b) =>
        genderInfo(a.label).rank - genderInfo(b.label).rank ||
        teamNameCollator.compare(a.label, b.label),
      ),
      ageOptions: Array.from(ageOptions, ([value, label]) => ({
        value,
        label,
      })).sort((a, b) => {
        const left = ageGroupInfo(a.label);
        const right = ageGroupInfo(b.label);
        return (
          left.rank - right.rank ||
          (left.number ?? Number.MAX_SAFE_INTEGER) -
            (right.number ?? Number.MAX_SAFE_INTEGER) ||
          teamNameCollator.compare(left.label, right.label)
        );
      }),
      groupOptions: Array.from(groupOptions, ([value, label]) => ({
        value,
        label,
      })).sort((a, b) => teamNameCollator.compare(a.label, b.label)),
    };
  }, [
    q.data?.brackets,
    q.data?.participants,
    teamAgeFilter,
    teamGenderFilter,
    teamGroupFilter,
    teamSearch,
  ]);

  const teamFiltersActive =
    teamSearch.trim() !== "" ||
    teamGenderFilter !== "all" ||
    teamAgeFilter !== "all" ||
    teamGroupFilter !== "all";

  const clearTeamFilters = () => {
    setTeamSearch("");
    setTeamGenderFilter("all");
    setTeamAgeFilter("all");
    setTeamGroupFilter("all");
  };

  const scheduleFiltersActive =
    scheduleSearch.trim() !== "" ||
    scheduleGenderFilter !== "all" ||
    scheduleAgeFilter !== "all" ||
    scheduleGroupFilter !== "all";

  const clearScheduleFilters = () => {
    setScheduleSearch("");
    setScheduleGenderFilter("all");
    setScheduleAgeFilter("all");
    setScheduleGroupFilter("all");
  };

  useEffect(() => {
    if (!q.data) return;
    const filterKey = JSON.stringify([
      scheduleSearch,
      scheduleGenderFilter,
      scheduleAgeFilter,
      scheduleGroupFilter,
    ]);
    if (scheduleFiltersActive) {
      scheduleWeeksInitializedFilters.current = filterKey;
      scheduleWeeksTouched.current = false;
      setOpenScheduleWeeks(new Set(allScheduleWeekKeys(matchGroups)));
      return;
    }
    if (scheduleWeeksInitializedFilters.current === filterKey) return;
    scheduleWeeksInitializedFilters.current = filterKey;
    scheduleWeeksTouched.current = false;
    setOpenScheduleWeeks(
      new Set(defaultOpenScheduleWeekKeys(matchGroups, scheduleToday)),
    );
  }, [
    matchGroups,
    q.data,
    scheduleAgeFilter,
    scheduleFiltersActive,
    scheduleGenderFilter,
    scheduleGroupFilter,
    scheduleSearch,
  ]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [teamAgeFilter, teamGenderFilter, teamGroupFilter, teamSearch]);

  if (q.isLoading) {
    return (
      <div className="min-h-screen max-w-4xl mx-auto p-6 space-y-4">
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  if (q.isError || !q.data) {
    const message =
      (q.error as Error | null)?.message ??
      "This competition link is invalid or no longer available.";
    return (
      <div className="min-h-screen max-w-xl mx-auto p-6">
        <Card className="rounded-xl border-border">
          <CardContent className="p-6 text-center space-y-2">
            <h1 className="text-xl font-black tracking-tight">
              Competition unavailable
            </h1>
            <p className="text-sm text-muted-foreground">{message}</p>
            <Link href="/">
              <Button variant="outline" className="font-bold mt-2">
                Go home
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { competition: c, participants } = q.data;
  const teamSections = competitionTeamSections(
    teamFilterData.filtered,
    q.data.brackets ?? [],
  );
  const brand = c.brandColor ?? DEFAULT_BRAND;
  const heroText = contrastText(brand);
  // Secondary tints the hero as a subtle gradient; tertiary accents the
  // status badge. Both degrade to primary-only when unset.
  const heroBackground = c.secondaryColor
    ? `linear-gradient(135deg, ${brand} 0%, ${brand} 55%, ${c.secondaryColor} 100%)`
    : brand;
  const accent = c.tertiaryColor ?? null;
  const dateRange = formatCompetitionDateRange(c.startDate, c.endDate);
  const typeLabel = c.type === "league" ? "League" : "Tournament";
  const statusLabel =
    c.type === "league"
      ? c.isEnded
        ? "Season ended"
        : "Season"
      : c.isActive
        ? "Live"
        : c.isEnded
          ? "Ended"
          : "Upcoming";

  const shareMatch = async (match: Match) => {
    const title = `${match.homeName ?? "TBD"} vs ${match.awayName ?? "TBD"}`;
    const details = [
      formatCompetitionDate(match.matchDate),
      match.startTime,
      [match.venue, match.venueState, match.field].filter(Boolean).join(", "),
    ]
      .filter(Boolean)
      .join(" · ");
    try {
      if (navigator.share) {
        await navigator.share({
          title: `${title} · ${c.name}`,
          text: `${title}${details ? ` — ${details}` : ""}`,
          url: window.location.href,
        });
        toast({ title: "Game details shared" });
        return;
      }
      if (!navigator.clipboard?.writeText) {
        throw new Error("Sharing is not available on this device.");
      }
      await navigator.clipboard.writeText(
        `${title}${details ? ` — ${details}` : ""}\n${window.location.href}`,
      );
      toast({
        title: "Game details copied",
        description: "Paste them into a message to share this matchup.",
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast({
        title: "Couldn't share this game",
        description:
          error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const downloadMatchCalendar = (match: Match) => {
    const calendar = matchCalendarText(match, c.name);
    if (!calendar) {
      toast({
        title: "Calendar file unavailable",
        description: "This game needs a valid date before it can be added.",
        variant: "destructive",
      });
      return;
    }
    try {
      const blob = new Blob([calendar], { type: "text/calendar;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${c.slug}-game-${match.matchNumber || "schedule"}.ics`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      toast({
        title: "Calendar file downloaded",
        description: "Open it to add this game to your calendar.",
      });
    } catch (error) {
      toast({
        title: "Couldn't create the calendar file",
        description:
          error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const signupHref = me
    ? `/c/${encodeURIComponent(slug)}/signup`
    : `/login?signup=1&returnTo=${encodeURIComponent(`/c/${slug}/signup`)}`;
  const kinectemHref = me
    ? `/competitions/c/${encodeURIComponent(slug)}`
    : `/login?signup=1&returnTo=${encodeURIComponent(
        `/competitions/c/${slug}`,
      )}`;
  const followHref = `/login?returnTo=${encodeURIComponent(`/c/${slug}`)}`;

  return (
    <div
      className="competition-page min-h-screen"
      style={
        {
          "--competition-primary": brand,
          "--competition-secondary": c.secondaryColor ?? brand,
        } as React.CSSProperties
      }
    >
      {/* Task #850 — red claim CTA when a valid ?claimToken= is present. */}
      <div className="max-w-4xl mx-auto px-6 pt-4 empty:hidden">
        <CompetitionClaimBanner slug={slug} />
      </div>
      {/* Branded hero (§9a/§10) — brand_color band, logo-forward */}
      <div
        className="relative overflow-hidden"
        style={{ background: heroBackground, color: heroText }}
        data-testid="hero-competition"
      >
        {/* Blurred banner photo — shows through the brand gradient */}
        {c.bannerUrl ? (
          <div
            aria-hidden="true"
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage: `url(${c.bannerUrl})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              filter: "blur(12px) brightness(0.55) saturate(1.4)",
              transform: "scale(1.05)",
            }}
          />
        ) : null}
        {/* Semi-transparent brand gradient overlay keeps brand color dominant over the photo */}
        {c.bannerUrl ? (
          <div
            aria-hidden="true"
            className="absolute inset-0 pointer-events-none"
            style={{ background: heroBackground, opacity: 0.72 }}
          />
        ) : null}
        {/* Dot-grid texture overlay — subtle depth without obscuring text */}
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none opacity-[0.08]"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3Ccircle cx='10' cy='10' r='1' fill='white'/%3E%3C/svg%3E")`,
            backgroundRepeat: "repeat",
          }}
        />
        {/* Radial corner glow — top-left (behind logo) */}
        <div
          aria-hidden="true"
          className="absolute -top-20 -left-20 w-72 h-72 rounded-full pointer-events-none blur-3xl opacity-30"
          style={{ background: c.secondaryColor ?? brand }}
        />
        {/* Radial corner glow — bottom-right (opposite anchor) */}
        <div
          aria-hidden="true"
          className="absolute -bottom-20 -right-20 w-60 h-60 rounded-full pointer-events-none blur-3xl opacity-25"
          style={{ background: c.secondaryColor ?? brand }}
        />
        <div className="max-w-4xl mx-auto px-6 py-5 space-y-2.5 relative">
          <div className="flex items-start gap-4">
            {c.logoUrl ? (
              <AvatarLightbox
                avatarUrl={c.logoUrl}
                displayName={c.name}
                ariaLabel={`View ${c.name} logo`}
                triggerClassName="rounded-xl shrink-0 cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                triggerTestId="btn-competition-logo"
                dialogTestId="dialog-competition-logo"
                imageTestId="img-competition-logo-expanded"
              >
                <img
                  src={c.logoUrl}
                  alt={`${c.name} logo`}
                  className="h-24 w-24 sm:h-36 sm:w-36 rounded-xl object-contain bg-white/90 p-2"
                  style={{
                    boxShadow: `0 0 0 3px white, 0 0 20px 8px ${(c.secondaryColor ?? brand)}66`,
                  }}
                  data-testid="img-competition-logo"
                />
              </AvatarLightbox>
            ) : null}
            <div className="min-w-0 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className="rounded-full border px-2 py-0.5 text-[11px] font-black uppercase tracking-widest"
                  style={{ borderColor: heroText, opacity: 0.9 }}
                  data-testid="badge-competition-type"
                >
                  {typeLabel}
                </span>
                <span
                  className="rounded-full px-2 py-0.5 text-[11px] font-black uppercase tracking-widest"
                  style={
                    accent
                      ? {
                          backgroundColor: accent,
                          color: contrastText(accent),
                        }
                      : undefined
                  }
                  data-testid="badge-competition-status"
                >
                  {statusLabel}
                </span>
                <span className="text-xs opacity-80">{dateRange}</span>
              </div>
              {c.organizer ? (
                <Link
                  href={
                    appParams
                      ? `/competitions/o/${c.organizer.slug}`
                      : `/organizers/${c.organizer.slug}`
                  }
                >
                  <span
                    className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs sm:text-sm font-black uppercase tracking-widest cursor-pointer shadow-sm transition-transform hover:scale-[1.03] competition-pill-shimmer"
                    style={{ backgroundColor: heroText, color: brand }}
                    data-testid="chip-presented-by"
                  >
                    {c.organizer.logoUrl ? (
                      <img
                        src={c.organizer.logoUrl}
                        alt=""
                        className="h-5 w-5 sm:h-6 sm:w-6 rounded-full object-contain bg-white"
                      />
                    ) : null}
                    Presented by {c.organizer.name}
                  </span>
                </Link>
              ) : null}
              <h1
                className="text-2xl sm:text-3xl font-black tracking-tight"
                style={{ textShadow: "0 2px 12px rgba(0,0,0,0.35)" }}
                data-testid="text-competition-name"
              >
                {c.name}
              </h1>
              {c.location ? (
                <p className="text-sm opacity-85">{c.location}</p>
              ) : null}
            </div>
          </div>
          {c.description ? (
            <p className="text-sm max-w-2xl opacity-90">{c.description}</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Link href={signupHref}>
              <Button
                className="font-bold bg-white text-black hover:bg-white/90"
                data-testid="btn-signup-team"
              >
                Sign up your team
              </Button>
            </Link>
            {!appParams ? (
              <Link href={kinectemHref}>
                <Button
                  variant="outline"
                  className="font-bold border-white/70 bg-transparent hover:bg-white/10"
                  style={{ color: heroText }}
                  data-testid="btn-open-in-kinectem"
                >
                  Open in Kinectem
                </Button>
              </Link>
            ) : null}
            {me ? (
              <Button
                variant="outline"
                className="font-bold border-white/70 bg-transparent hover:bg-white/10"
                style={{ color: heroText }}
                disabled={followMutation.isPending}
                onClick={() => followMutation.mutate(!c.isFollowing)}
                data-testid="btn-follow-competition"
              >
                <Star
                  className={`w-4 h-4 mr-1.5 ${c.isFollowing ? "fill-current" : ""}`}
                />
                {c.isFollowing ? "Following" : "Follow"}
              </Button>
            ) : (
              <Link href={followHref}>
                <Button
                  variant="outline"
                  className="font-bold border-white/70 bg-transparent hover:bg-white/10"
                  style={{ color: heroText }}
                  data-testid="btn-follow-competition-login"
                >
                  <Star className="w-4 h-4 mr-1.5" />
                  Follow competition
                </Button>
              </Link>
            )}
            {c.canManage || isClaimVisitor ? (
              <Link
                href={`/competitions/${c.id}${
                  isClaimVisitor && claimToken
                    ? `?claimToken=${encodeURIComponent(claimToken)}`
                    : ""
                }`}
              >
                <Button
                  variant="outline"
                  className="font-bold border-white/70 bg-transparent hover:bg-white/10"
                  style={{ color: heroText }}
                  data-testid="btn-edit-competition"
                >
                  <Pencil className="w-4 h-4 mr-1.5" />
                  Edit competition
                </Button>
              </Link>
            ) : null}
            {c.canManage ? (
              <Link href={`/competitions/${c.id}/results`}>
                <Button
                  variant="outline"
                  className="font-bold border-white/70 bg-transparent hover:bg-white/10"
                  style={{ color: heroText }}
                  data-testid="btn-manage-results"
                >
                  Results &amp; recaps
                </Button>
              </Link>
            ) : null}
            <span className="text-xs font-bold opacity-90">
              {c.claimedCount} / {c.participantCount} teams telling their story
            </span>
            {c.websiteUrl ? (
              <a
                href={c.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs underline opacity-85"
                data-testid="link-competition-website"
              >
                Official website
              </a>
            ) : null}
          </div>
          <p className="text-[11px] opacity-70 pt-2">Powered by Kinectem</p>
        </div>
        {/* Bottom vignette — cinematic fade into the page body */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-16 pointer-events-none"
          style={{ background: "linear-gradient(to bottom, transparent, rgba(0,0,0,0.18))" }}
        />
      </div>

      <div className="w-full min-w-0 max-w-4xl mx-auto p-6 pb-12 space-y-10">
        {(c.partnerPages?.length ?? 0) > 0 ? (
          <CompetitionPartnerDirectory
            partners={c.partnerPages!}
            signedIn={Boolean(me)}
          />
        ) : null}
        {/* Organizer-only lifecycle explainer — starts collapsed (like the
            Teams and Schedule sections below); the organizer expands it via
            the chevron when they want the walkthrough. */}
        {c.canManage || isClaimVisitor ? (
          <CompetitionHowItWorks
            brandColor={c.brandColor}
            secondaryColor={c.secondaryColor}
            defaultOpen={isClaimVisitor}
          />
        ) : null}

        {/* Featured game recaps rail (§7) — the visual centerpiece; hidden
            entirely until the operator features at least one recap. Each
            card carries the authoring team's identity inside the
            competition-branded page. */}
        {((q.data.featuredRecaps?.length ?? 0) > 0 || (q.data.brackets?.length ?? 0) > 0 || q.data.matches.some((match) => match.division?.trim())) && (() => {
          const allRecaps = q.data.featuredRecaps ?? [];
          const brackets = q.data.brackets ?? [];
          const { options: usedBrackets, byRecap: recapBrackets } = featuredRecapBrackets(
            allRecaps, brackets, q.data.matches.flatMap((match) => match.division ? [match.division] : []),
          );
          const otherRecapCount = allRecaps.filter((recap) => recapBrackets.get(recap.id)?.key === "__other__").length;
          const selectedBracketEmpty = bracketFilter === "__other__"
            ? otherRecapCount === 0
            : usedBrackets.find((bracket) => bracket.id === bracketFilter)?.count === 0;
          const recapDateKey = (recap: FeaturedRecap) =>
            recap.effectiveGameDate ??
            recap.gameDate ??
            recap.publishedAt?.slice(0, 10) ??
            "";
          const recapSearchText = recapSearch.trim().toLowerCase();
          const shownRecaps = allRecaps.filter((recap) => {
            const matchesBracket =
              !bracketFilter ||
              recapBrackets.get(recap.id)?.key === bracketFilter;
            const matchesTeam =
              recapTeamFilter === "all" || recap.teamId === recapTeamFilter;
            const matchesDate =
              recapDateFilter === "all" ||
              recapDateKey(recap) === recapDateFilter;
            const matchesSearch =
              !recapSearchText ||
              [
                recap.title,
                recap.teamName,
                recap.opponentName,
                recap.summary,
                recap.groupDivision,
                recap.groupBracket,
                recapBrackets.get(recap.id)?.label,
              ]
                .filter(Boolean)
                .join(" ")
                .toLowerCase()
                .includes(recapSearchText);
            return matchesBracket && matchesTeam && matchesDate && matchesSearch;
          });
          const recapTeamOptions = Array.from(
            new Map(
              allRecaps.map((recap) => [
                recap.teamId,
                { value: recap.teamId, label: recap.teamName },
              ]),
            ).values(),
          ).sort((a, b) => teamNameCollator.compare(a.label, b.label));
          const recapDateOptions = Array.from(
            new Set(allRecaps.map(recapDateKey).filter(Boolean)),
          ).sort();
          const recapFiltersActive =
            bracketFilter !== "" ||
            recapSearch.trim() !== "" ||
            recapTeamFilter !== "all" ||
            recapDateFilter !== "all";
          const activeRecapLabel = [
            bracketFilter === "__other__" ? "Other" : usedBrackets.find((bracket) => bracket.id === bracketFilter)?.label,
            recapTeamFilter !== "all" ? recapTeamOptions.find((team) => team.value === recapTeamFilter)?.label : null,
            recapDateFilter !== "all" ? formatCompetitionDate(recapDateFilter) : null,
            recapSearch.trim() ? `Search: ${recapSearch.trim()}` : null,
          ].filter(Boolean).join(" · ") || "All";
          const clearRecapFilters = () => {
            setBracketFilter("");
            setRecapSearch("");
            setRecapTeamFilter("all");
            setRecapDateFilter("all");
          };
          // Brackets stay in the organizer's saved order, then unbracketed
          // recaps trail under "Other"; each section is always split by week.
          const groupedSections: { key: string; label: string; recaps: FeaturedRecap[] }[] =
            usedBrackets
              .filter((b) => shownRecaps.some((r) => recapBrackets.get(r.id)?.key === b.id))
              .map((b) => ({
              key: b.id,
              label: b.label,
              recaps: shownRecaps.filter((r) => recapBrackets.get(r.id)?.key === b.id),
            }));
          const otherRecaps = shownRecaps.filter(
            (r) => recapBrackets.get(r.id)?.key === "__other__",
          );
          if (otherRecaps.length > 0) {
            groupedSections.push({
              key: "__other__",
              label: "Other",
              recaps: otherRecaps,
            });
          }
          const renderRecapCard = (r: FeaturedRecap) => {
            const previewText = featuredRecapPreviewText(r);
            const recapBracket = recapBrackets.get(r.id);
            const bracketLabel = recapBracket?.label ?? "No bracket assigned";
            const bracketDetail = recapBracket?.subgroup && recapBracket.subgroup !== recapBracket.label
              ? `${bracketLabel} · ${recapBracket.subgroup}` : bracketLabel;
            const orgPalette = featuredOrgPalette(r.organization);
            return (
              <Link key={r.id} href={`/posts/${r.id}`} className="block min-w-0">
                <Card
                  className="min-w-0 rounded-xl border-2 border-border overflow-hidden cursor-pointer transition-all hover:-translate-y-1 hover:shadow-lg h-full flex flex-col group"
                  data-testid={`card-featured-recap-${r.id}`}
                  style={{ borderColor: `color-mix(in srgb, ${orgPalette.primary} 65%, transparent)` }}
                >
                <CompetitionBrandStrip
                  name={c.name}
                  logoUrl={c.logoUrl}
                  brandColor={c.brandColor}
                  secondaryColor={c.secondaryColor}
                />
                <FeaturedRecapOrganization org={r.organization} teamName={r.teamName} />
                <CardContent className="min-w-0 px-4 py-2" style={{ backgroundColor: `color-mix(in srgb, ${orgPalette.primary} 8%, hsl(var(--card)))` }}>
                  <FitText as="p" max={18} min={14} lineHeight={1.15} className="font-black tracking-tight" data-testid={`title-featured-recap-${r.id}`}>
                    {r.title}
                  </FitText>
                  <p
                    className="mt-1 truncate text-[10px] font-semibold text-muted-foreground"
                    title={`Bracket: ${bracketDetail}`}
                    data-testid={`bracket-featured-recap-${r.id}`}
                  >
                    {bracketLabel}
                  </p>
                </CardContent>
                {r.coverImageUrl ? (
                  <div className="h-28 w-full overflow-hidden relative">
                    <img
                      src={r.coverImageUrl}
                      alt=""
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
                  </div>
                ) : previewText ? (
                  <div
                    className="flex h-40 w-full flex-col overflow-hidden"
                    data-testid={`preview-featured-recap-${r.id}`}
                  >
                    <div
                      className="relative min-h-0 flex-1 overflow-hidden px-4 py-2.5"
                      data-testid={`gradient-featured-recap-${r.id}`}
                      style={{ background: `linear-gradient(145deg, color-mix(in srgb, ${orgPalette.primary} 16%, hsl(var(--card))), color-mix(in srgb, ${orgPalette.secondary} 12%, hsl(var(--card))))` }}
                    >
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute -right-12 -top-10 h-28 w-28 opacity-[0.24]"
                      style={{
                        background: `radial-gradient(circle at center, ${orgPalette.primary} 0%, transparent 72%)`,
                      }}
                    />
                    <div className="relative min-w-0 space-y-1">
                      <p
                        className="text-[10px] font-black uppercase tracking-[0.18em]"
                        style={{ color: `color-mix(in srgb, ${orgPalette.primary} 65%, currentColor)` }}
                      >
                        From the recap
                      </p>
                      <p className="line-clamp-5 text-sm font-semibold leading-snug text-black dark:text-white">
                        {previewText}
                      </p>
                    </div>
                    </div>
                    <div
                      className="flex h-6 shrink-0 items-center justify-end border-t px-4 text-[10px] font-black uppercase tracking-widest text-black dark:text-white"
                      data-testid={`footer-featured-recap-${r.id}`}
                      style={{
                        backgroundColor: `color-mix(in srgb, ${orgPalette.primary} 8%, hsl(var(--card)))`,
                        borderColor: `color-mix(in srgb, ${orgPalette.primary} 20%, hsl(var(--card)))`,
                      }}
                    >
                      Read full recap
                    </div>
                  </div>
                ) : (
                  <div className="h-28 w-full bg-muted/40 flex items-center justify-center relative overflow-hidden">
                    <Star className="w-12 h-12 text-muted-foreground/20 transition-transform duration-500 group-hover:scale-110 group-hover:rotate-12" />
                  </div>
                )}
                </Card>
              </Link>
            );
          };
          return (
          <section className="competition-section-surface space-y-2.5 rounded-xl border p-3 text-black shadow-sm dark:text-white sm:p-4" data-testid="rail-featured-recaps">
            <div className="competition-section-trigger -mx-3 -mt-3 flex items-center justify-between gap-2 rounded-t-xl border-b border-border/60 px-3 py-2.5 sm:-mx-4 sm:-mt-4 sm:px-4">
              <h2 className="text-xl font-black tracking-tight flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-5 w-1 rounded-full"
                  style={{ backgroundColor: brand }}
                />
                Featured Game Recaps
              </h2>
              <div className="flex items-center gap-3">
                <span
                  className="text-[11px] font-black uppercase tracking-widest opacity-80 hidden sm:inline"
                  style={{ color: brand }}
                >
                  Curated by {c.name}
                </span>
                {c.canManage ? (
                  <Link href={`/competitions/${c.id}#recaps`}>
                    <Button
                      size="sm"
                      variant="outline"
                      className="font-bold shadow-sm"
                      data-testid="btn-manage-featured-recaps"
                    >
                      <Star className="w-3.5 h-3.5 mr-1.5" />
                      Manage
                    </Button>
                  </Link>
                ) : null}
              </div>
            </div>
            <div
              className="competition-filter-panel rounded-xl border p-2.5 shadow-sm space-y-2"
              data-testid="recap-filters"
            >
              <div className="flex flex-col gap-2 sm:flex-row">
                <label className="relative min-w-0 flex-1">
                  <span className="sr-only">Search featured recaps</span>
                  <Search
                    aria-hidden="true"
                    className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  />
                  <input
                    type="search"
                    value={recapSearch}
                    onChange={(event) => setRecapSearch(event.target.value)}
                    placeholder="Search teams, opponents, or recap titles"
                    className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-10 text-sm font-medium text-black outline-none transition-shadow placeholder:text-black focus-visible:ring-2 focus-visible:ring-ring dark:text-white dark:placeholder:text-white"
                    data-testid="input-search-recaps"
                  />
                  {recapSearch ? (
                    <button
                      type="button"
                      onClick={() => setRecapSearch("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label="Clear recap search"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  ) : null}
                </label>
                {recapFiltersActive ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-10 shrink-0 font-bold"
                    onClick={clearRecapFilters}
                    data-testid="btn-clear-recap-filters"
                  >
                    Clear filters
                  </Button>
                ) : null}
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <label className="space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-black dark:text-white">
                    Team
                  </span>
                  <select
                    value={recapTeamFilter}
                    onChange={(event) => setRecapTeamFilter(event.target.value)}
                    className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    data-testid="select-recap-team"
                  >
                    <option value="all">All teams</option>
                    {recapTeamOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="min-w-0 space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-black dark:text-white">
                    Bracket
                  </span>
                  <select
                    value={bracketFilter}
                    onChange={(event) => setBracketFilter(event.target.value)}
                    className="h-9 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    data-testid="select-recap-bracket"
                  >
                    <option value="">All brackets ({allRecaps.length})</option>
                    {usedBrackets.map((bracket) => (
                      <option key={bracket.id} value={bracket.id}>
                        {bracket.label} ({bracket.count})
                      </option>
                    ))}
                    <option value="__other__">Other / no bracket ({otherRecapCount})</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-black dark:text-white">
                    Game date
                  </span>
                  <select
                    value={recapDateFilter}
                    onChange={(event) => setRecapDateFilter(event.target.value)}
                    className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    data-testid="select-recap-date"
                  >
                    <option value="all">All dates</option>
                    {recapDateOptions.map((date) => (
                      <option key={date} value={date}>
                        {formatCompetitionDate(date)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            {/* One pill identifies the current view; its menu switches brackets. */}
              <div
                className="flex items-center gap-1.5 flex-wrap"
                data-testid="filter-bracket-chips"
              >
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="sm"
                      className="h-7 min-w-0 max-w-full rounded-full font-bold text-xs"
                      data-testid="chip-recap-active"
                      title={`${activeRecapLabel} (${shownRecaps.length})`}
                    >
                      <span className="min-w-0 truncate">{activeRecapLabel} ({shownRecaps.length})</span>
                      <ChevronDown className="ml-1 h-3 w-3 shrink-0" aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="max-w-[min(28rem,calc(100vw-2rem))]">
                    <DropdownMenuRadioGroup
                      value={!recapFiltersActive ? "__all__" : bracketFilter || "__custom__"}
                      onValueChange={(value) => value === "__all__" ? clearRecapFilters() : setBracketFilter(value)}
                    >
                      <DropdownMenuRadioItem value="__all__">All ({allRecaps.length})</DropdownMenuRadioItem>
                      {usedBrackets.map((bracket) => (
                        <DropdownMenuRadioItem key={bracket.id} value={bracket.id} className="break-words">
                          {bracket.label} ({bracket.count})
                        </DropdownMenuRadioItem>
                      ))}
                      {otherRecapCount > 0 || bracketFilter === "__other__" ? (
                        <DropdownMenuRadioItem value="__other__">Other ({otherRecapCount})</DropdownMenuRadioItem>
                      ) : null}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            {shownRecaps.length === 0 ? (
              <div
                className="competition-empty-state rounded-xl border border-dashed p-8 text-center"
                data-testid="empty-recap-filters"
              >
                <Search className="mx-auto h-8 w-8 text-muted-foreground/60" />
                <h3 className="mt-3 font-black">
                  {allRecaps.length === 0 ? "No featured game recaps yet" : selectedBracketEmpty ? "No featured recaps in this bracket yet" : "No recaps match those filters"}
                </h3>
                <p className="mt-1 text-sm text-black dark:text-white">
                  {allRecaps.length === 0 || selectedBracketEmpty
                    ? "Only recaps featured by competition admins appear here."
                    : "Try another bracket, team, date, or search term."}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-4 font-bold"
                  onClick={clearRecapFilters}
                  data-testid="btn-empty-clear-recap-filters"
                >
                  Show all recaps
                </Button>
              </div>
            ) : (
            <div className="grid gap-x-3 gap-y-4 md:grid-cols-2 lg:grid-cols-3" data-testid="rail-grouped-sections">
              {groupedSections.map((s) => (
                <div
                  key={s.key}
                  className={`min-w-0 space-y-1.5 ${s.recaps.length > 1 ? "md:col-span-2 lg:col-span-3" : ""}`}
                  data-testid={`section-bracket-${s.key}`}
                >
                  <div className="space-y-3">
                    {recapGroups(
                      s.recaps.map((r) => ({
                        ...r,
                        matchDate: r.effectiveGameDate ?? null,
                      })),
                      c,
                    ).map((weekGroup) => (
                      <div
                        key={weekGroup.key}
                        className="space-y-1"
                        data-testid={`section-recap-week-${s.key}-${weekGroup.key}`}
                      >
                        <div className={`grid min-w-0 gap-2.5 ${s.recaps.length > 1 ? "sm:grid-cols-2 lg:grid-cols-3" : ""}`}>
                          {weekGroup.items.map(renderRecapCard)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            )}
          </section>
          );
        })()}

        {(q.data.featuredRecaps?.length ?? 0) === 0 && (q.data.brackets?.length ?? 0) === 0 && !q.data.matches.some((match) => match.division?.trim()) ? (
          <Card
            className="competition-section-surface rounded-xl border-l-4 border-dashed border-border bg-muted/20 shadow-sm"
            style={{ borderLeftColor: brand }}
            data-testid="card-featured-recaps-empty"
          >
            <CardContent className="p-6 flex items-center justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <h2 className="text-lg font-black tracking-tight flex items-center gap-2">
                  Featured game recaps
                </h2>
                <p className="text-sm text-muted-foreground mt-1 leading-relaxed max-w-xl">
                  {c.canManage
                    ? "Nothing featured yet — review recaps from claimed teams and feature the best ones here on your public page. Only you can see this."
                    : "No game recaps have been featured yet. Check back after the action for event-day stories and highlights."}
                </p>
              </div>
              {c.canManage ? (
                <Link href={`/competitions/${c.id}#recaps`}>
                  <Button
                    variant="outline"
                    className="font-bold shrink-0 bg-background shadow-sm"
                    data-testid="btn-feature-recaps"
                  >
                    <Star className="w-4 h-4 mr-1.5 text-muted-foreground" />
                    View &amp; feature recaps
                  </Button>
                </Link>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        <CompetitionAlbumSection competition={c} />

        {/* Teams / claim list and Schedule as full-width reading sections */}
        <div className="flex w-full min-w-0 flex-col gap-6">
          <CompetitionPartnerLinks
            competitionId={c.id}
            slug={slug}
            participants={participants}
          />
          {/* Teams */}
          <Card
           className="competition-section-surface w-full min-w-0 rounded-xl border-t-[3px] border-border bg-card shadow-sm flex flex-col"
            style={{ borderTopColor: brand }}
            data-testid="card-participants"
          >
            <CardContent className="p-0">
              <Collapsible
                open={teamsOpen}
                onOpenChange={setTeamsOpen}
                className="flex flex-col"
              >
                <CollapsibleTrigger
                  className="competition-section-trigger flex w-full items-center justify-between gap-2 p-5 text-left hover:bg-muted/40 transition-colors"
                  data-testid="btn-toggle-participants"
                >
                  <h2 className="text-lg font-black tracking-tight flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="h-5 w-1 rounded-full"
                      style={{ backgroundColor: brand }}
                    />
                    Teams
                    <Badge
                      variant="secondary"
                      className="rounded-full px-2 py-0.5 text-xs"
                      data-testid="badge-team-count"
                    >
                      {teamFiltersActive
                        ? `${teamFilterData.filtered.length} of ${participants.length}`
                        : participants.length}
                    </Badge>
                  </h2>
                  <ChevronDown
                    className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200 ${
                      teamsOpen ? "rotate-180" : ""
                    }`}
                  />
                </CollapsibleTrigger>
                <CollapsibleContent className="px-5 pb-5 space-y-4 border-t border-border/50 pt-5">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Spot your team below? Claim it yourself — no invite needed.
                    Sign up, claim your name, and start telling your team&apos;s
                    story with game recaps.
                  </p>
                  <div
                      className="competition-filter-panel rounded-lg border p-4 text-xs text-muted-foreground space-y-2 shadow-sm"
                    data-testid="text-claim-explainer"
                  >
                    <p>
                      <span className="font-bold text-foreground">
                        Claiming a team claims its schedule.
                      </span>{" "}
                      Your {typeLabel.toLowerCase()} games are added to your
                      Kinectem team page, where you can edit all of your team&apos;s
                      info.
                    </p>
                    <p>
                      Already have a team on Kinectem? Claiming won&apos;t change
                      your existing team page — these games are simply added to
                      your schedule under this competition, and your game recaps
                      may be shared and featured on this competition page.
                    </p>
                    <p data-testid="text-claim-approval-mode">
                      {c.autoApproveClaims ? (
                        <>
                          <span className="font-bold text-foreground">
                            Claims are instant
                          </span>{" "}
                          — click Claim and your spot is locked in right away.
                        </>
                      ) : (
                        <>
                          <span className="font-bold text-foreground">
                            Claims are reviewed
                          </span>{" "}
                          — the organizer approves each claim before your spot is
                          locked in.
                        </>
                      )}
                    </p>
                  </div>
                  {participants.length > 0 ? (
                    <div
                      className="competition-filter-panel rounded-xl border p-3 shadow-sm space-y-3"
                      data-testid="team-filters"
                    >
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <label className="relative min-w-0 flex-1">
                          <span className="sr-only">Search teams</span>
                          <Search
                            aria-hidden="true"
                            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                          />
                          <input
                            type="search"
                            value={teamSearch}
                            onChange={(event) => setTeamSearch(event.target.value)}
                            placeholder="Search teams, ages, or groups"
                            className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-10 text-sm font-medium outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring"
                            data-testid="input-search-teams"
                          />
                          {teamSearch ? (
                            <button
                              type="button"
                              onClick={() => setTeamSearch("")}
                              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              aria-label="Clear team search"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          ) : null}
                        </label>
                        {teamFiltersActive ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-10 shrink-0 font-bold"
                            onClick={clearTeamFilters}
                            data-testid="btn-clear-team-filters"
                          >
                            Clear filters
                          </Button>
                        ) : null}
                      </div>
                      <div className="grid gap-2 sm:grid-cols-3">
                        <label className="space-y-1">
                          <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                            Gender
                          </span>
                          <select
                            value={teamGenderFilter}
                            onChange={(event) =>
                              setTeamGenderFilter(event.target.value)
                            }
                            className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            data-testid="select-team-gender"
                          >
                            <option value="all">All genders</option>
                            {teamFilterData.genderOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="space-y-1">
                          <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                            Age
                          </span>
                          <select
                            value={teamAgeFilter}
                            onChange={(event) =>
                              setTeamAgeFilter(event.target.value)
                            }
                            className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            data-testid="select-team-age"
                          >
                            <option value="all">All ages</option>
                            {teamFilterData.ageOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="space-y-1">
                          <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                            Group
                          </span>
                          <select
                            value={teamGroupFilter}
                            onChange={(event) =>
                              setTeamGroupFilter(event.target.value)
                            }
                            className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            data-testid="select-team-group"
                          >
                            <option value="all">All groups</option>
                            {teamFilterData.groupOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </div>
                  ) : null}
                  {c.canManage && selectedIds.size > 0 ? (
                    <div
                      className="sticky top-0 z-10 flex items-center justify-between gap-2 rounded-lg border border-border bg-background/95 px-3 py-2 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/80"
                      data-testid="bar-bulk-hide"
                    >
                      <p className="text-sm font-bold">
                        {selectedIds.size} team{selectedIds.size === 1 ? "" : "s"}{" "}
                        selected
                      </p>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="font-bold text-muted-foreground"
                          onClick={() => setSelectedIds(new Set())}
                          data-testid="btn-clear-selection"
                        >
                          Clear
                        </Button>
                        <Button
                          size="sm"
                          className="font-bold shadow-sm"
                          disabled={bulkHideMutation.isPending}
                          onClick={() => setBulkHideOpen(true)}
                          data-testid="btn-bulk-hide"
                        >
                          <EyeOff className="h-3.5 w-3.5 mr-1" />
                          Hide All ({selectedIds.size})
                        </Button>
                      </div>
                    </div>
                  ) : null}
                  <div className="flex flex-col gap-4">
                  {teamSections.map((section) => (
                    <div key={section.key} className="space-y-2">
                      {section.title ? (
                        <p
                          className="text-[13px] font-black uppercase tracking-widest pb-1 border-b border-border/40"
                          style={{ color: brand }}
                          data-testid={`heading-team-group-${section.key}`}
                        >
                          {section.title}{" "}
                          <span className="font-bold normal-case tracking-normal opacity-70">
                            ({section.teams.length})
                          </span>
                        </p>
                      ) : null}
                  {section.teams.map((p) => (
                    <div
                      key={p.id}
                      className={`competition-item-row flex items-center justify-between gap-2 rounded-lg border bg-card px-4 py-3 shadow-sm transition-shadow hover:shadow-md ${
                        p.hidden ? "opacity-60 bg-muted/30 shadow-none hover:shadow-none" : ""
                      }`}
                      data-testid={`row-participant-${p.id}`}
                    >
                      <div className="min-w-0">
                        {p.teamId ? (
                          <Link
                            href={`/teams/${p.teamId}`}
                            className="inline-flex min-w-0 items-center gap-1 text-sm font-bold tracking-tight hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                            data-testid={`link-participant-team-${p.id}`}
                          >
                            <span className="break-words">{p.name}</span>
                            <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                          </Link>
                        ) : (
                          <p className="text-sm font-bold tracking-tight break-words">
                            {p.name}
                          </p>
                        )}
                        <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground break-words mt-0.5">
                          {groupLabel(p.division, p.bracket)}
                        </p>
                        {p.hidden ? (
                          <p
                            className="mt-1 flex items-center gap-1 text-[11px] font-medium text-muted-foreground"
                            data-testid={`text-hidden-participant-${p.id}`}
                          >
                            <EyeOff className="h-3 w-3 shrink-0" />
                            Hidden — only competition admins can see this team
                          </p>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {c.canManage && !p.hidden ? (
                          <Checkbox
                            checked={selectedIds.has(p.id)}
                            onCheckedChange={() => toggleSelected(p.id)}
                            aria-label={`Select ${p.name} to hide`}
                            data-testid={`checkbox-select-participant-${p.id}`}
                          />
                        ) : null}
                        {c.canManage ? (
                          p.hidden ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="font-bold shadow-sm bg-background"
                              disabled={hideMutation.isPending}
                              onClick={() =>
                                hideMutation.mutate({
                                  participantId: p.id,
                                  hide: false,
                                  competitionId: c.id,
                                })
                              }
                              data-testid={`btn-unhide-participant-${p.id}`}
                            >
                              Unhide
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="font-bold text-muted-foreground hover:bg-muted/80"
                              disabled={hideMutation.isPending}
                              aria-label={`Hide ${p.name}`}
                              onClick={() => setPendingHide(p)}
                              data-testid={`btn-hide-participant-${p.id}`}
                            >
                              <EyeOff className="h-3.5 w-3.5 sm:mr-1" />
                              <span className="hidden sm:inline">Hide</span>
                            </Button>
                          )
                        ) : null}
                        {p.claimed ? (
                          <Badge
                            variant="secondary"
                            className="shrink-0 font-bold px-2.5"
                            data-testid={`badge-claimed-${p.id}`}
                          >
                            Claimed
                          </Badge>
                        ) : p.pending ? (
                          <Badge variant="outline" className="shrink-0 font-bold px-2.5">
                            Approval pending
                          </Badge>
                        ) : p.hidden ? null : (
                          <Link
                            href={
                              me
                                ? `/c/${encodeURIComponent(slug)}/signup?participant=${p.id}`
                                : `/login?signup=1&returnTo=${encodeURIComponent(`/c/${slug}/signup?participant=${p.id}`)}`
                            }
                          >
                            <Button
                              size="sm"
                              variant="default"
                              className="font-bold shrink-0 shadow-sm"
                              data-testid={`btn-claim-${p.id}`}
                            >
                              Claim
                            </Button>
                          </Link>
                        )}
                      </div>
                    </div>
                  ))}
                    </div>
                  ))}
                  {participants.length === 0 ? (
                    <div className="competition-empty-state rounded-xl border border-dashed p-6 text-center">
                      <p className="font-bold">No teams have been added yet</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Teams will appear here when the {typeLabel.toLowerCase()}{" "}
                        schedule is available.
                      </p>
                    </div>
                  ) : teamSections.length === 0 ? (
                    <div
                      className="competition-empty-state rounded-xl border border-dashed p-6 text-center"
                      data-testid="empty-team-filters"
                    >
                      <Search className="mx-auto h-7 w-7 text-muted-foreground/60" />
                      <p className="mt-2 font-bold">No teams match those filters</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Try another search or clear the filters to see every team.
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-3 font-bold"
                        onClick={clearTeamFilters}
                      >
                        Clear filters
                      </Button>
                    </div>
                  ) : null}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </CardContent>
        </Card>

        {/* Schedule */}
        <Card
          className="competition-section-surface w-full min-w-0 rounded-xl border-t-[3px] border-border bg-card shadow-sm flex flex-col"
          style={{ borderTopColor: brand }}
          data-testid="card-schedule"
        >
          <CardContent className="p-0">
            <Collapsible
              open={scheduleOpen}
              onOpenChange={setScheduleOpen}
              className="flex flex-col"
            >
              <CollapsibleTrigger
                className="competition-section-trigger flex w-full items-center justify-between gap-2 p-5 text-left hover:bg-muted/40 transition-colors"
                data-testid="btn-toggle-schedule"
              >
                <h2 className="text-lg font-black tracking-tight flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="h-5 w-1 rounded-full"
                    style={{ backgroundColor: brand }}
                  />
                  Schedule
                  <Badge numeric={!scheduleFiltersActive} variant="secondary" className="rounded-full px-2 py-0.5 text-xs" data-testid="badge-schedule-count">
                    {scheduleFiltersActive
                      ? `${scheduleFilterData.filtered.length} of ${q.data.matches.length}`
                      : q.data.matches.length}
                  </Badge>
                </h2>
                <ChevronDown
                  className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200 ${
                    scheduleOpen ? "rotate-180" : ""
                  }`}
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-6 border-t border-border/50 px-5 pb-5 pt-5">
                <div
                  className="competition-filter-panel rounded-xl border p-3 shadow-sm space-y-3"
                  data-testid="schedule-filters"
                >
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <label className="relative min-w-0 flex-1">
                      <span className="sr-only">Search schedule</span>
                      <Search
                        aria-hidden="true"
                        className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                      />
                      <input
                        type="search"
                        value={scheduleSearch}
                        onChange={(event) => setScheduleSearch(event.target.value)}
                        placeholder="Search teams, games, venues, or details"
                        className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-10 text-sm font-medium outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring"
                        data-testid="input-search-schedule"
                      />
                      {scheduleSearch ? (
                        <button
                          type="button"
                          onClick={() => setScheduleSearch("")}
                          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label="Clear schedule search"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      ) : null}
                    </label>
                    {scheduleFiltersActive ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-10 shrink-0 font-bold"
                        onClick={clearScheduleFilters}
                        data-testid="btn-clear-schedule-filters"
                      >
                        Clear filters
                      </Button>
                    ) : null}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <label className="space-y-1">
                      <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                        Gender
                      </span>
                      <select
                        value={scheduleGenderFilter}
                        onChange={(event) => setScheduleGenderFilter(event.target.value)}
                        className="h-9 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        data-testid="select-schedule-gender"
                      >
                        <option value="all">All genders</option>
                        {scheduleFilterData.genderOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                        Age
                      </span>
                      <select
                        value={scheduleAgeFilter}
                        onChange={(event) => setScheduleAgeFilter(event.target.value)}
                        className="h-9 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        data-testid="select-schedule-age"
                      >
                        <option value="all">All ages</option>
                        {scheduleFilterData.ageOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                        Group
                      </span>
                      <select
                        value={scheduleGroupFilter}
                        onChange={(event) => setScheduleGroupFilter(event.target.value)}
                        className="h-9 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        data-testid="select-schedule-group"
                      >
                        <option value="all">All groups</option>
                        {scheduleFilterData.groupOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>
                <p className="text-xs font-semibold text-muted-foreground" aria-live="polite" data-testid="schedule-result-count">
                  {scheduleFilterData.filtered.length === 0
                    ? scheduleFiltersActive
                      ? "No games match these filters."
                      : "No games scheduled yet."
                    : `${scheduleFilterData.filtered.length} ${
                        scheduleFilterData.filtered.length === 1 ? "game" : "games"
                      } shown`}
                </p>
                {matchGroups.length === 0 ? (
                  <div
                    className="competition-empty-state rounded-xl border border-dashed p-8 text-center"
                    data-testid={scheduleFiltersActive ? "empty-schedule-filters" : "empty-schedule"}
                  >
                    <CalendarPlus className="mx-auto h-8 w-8 text-muted-foreground/60" />
                    <h3 className="mt-3 font-black">
                      {scheduleFiltersActive
                        ? "No games match those filters"
                        : "No games scheduled yet"}
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {scheduleFiltersActive
                        ? "Try another search or clear the filters to see every game."
                        : "Games will appear here when the competition schedule is available."}
                    </p>
                    {scheduleFiltersActive ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-4 font-bold"
                        onClick={clearScheduleFilters}
                        data-testid="btn-empty-clear-schedule-filters"
                      >
                        Show all games
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  matchGroups.map(([label, matches]) => (
                    <div key={label} className="competition-schedule-group space-y-3 rounded-xl p-3 sm:p-4">
                      <h3 className="border-b border-border/40 pb-2 text-sm font-black uppercase tracking-[0.14em]" style={{ color: brand }}>
                        {label}
                      </h3>
                      <div className="space-y-3">
                        {weekGroups(matches).map((weekGroup) => {
                          const stateKey = scheduleWeekStateKey(label, weekGroup.key);
                          const weekId = `schedule-week-${encodeURIComponent(stateKey)}`;
                          const isWeekOpen = openScheduleWeeks.has(stateKey);
                          return (
                            <Collapsible
                              key={stateKey}
                              open={isWeekOpen}
                              onOpenChange={(open) => toggleScheduleWeek(stateKey, open)}
                              className="rounded-lg border border-border/60 bg-background/70"
                            >
                              <div id={weekId} data-testid={`section-match-week-${weekGroup.key}`}>
                                <CollapsibleTrigger
                                  className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-3 text-left hover:bg-muted/40"
                                  data-testid={`btn-toggle-match-week-${encodeURIComponent(stateKey)}`}
                                >
                                  <span className="text-[11px] font-black uppercase tracking-widest text-muted-foreground/90">
                                    {weekGroup.week
                                      ? formatCompetitionWeek(weekGroup.week)
                                      : "Undated · Date not listed"}
                                  </span>
                                  <span className="flex shrink-0 items-center gap-2 text-xs font-bold text-muted-foreground">
                                    {weekGroup.items.length}{" "}
                                    {weekGroup.items.length === 1 ? "game" : "games"}
                                    <ChevronDown
                                      className={`h-4 w-4 transition-transform ${
                                        isWeekOpen ? "rotate-180" : ""
                                      }`}
                                      aria-hidden="true"
                                    />
                                  </span>
                                </CollapsibleTrigger>
                                <CollapsibleContent className="px-3 pb-3">
                                  <div className="flex flex-col gap-2">
                                    {weekGroup.items.map((m) => {
                                      const validDate = !!competitionWeekForDate(m.matchDate);
                                      const venue = [m.venue, m.venueState]
                                        .filter(Boolean)
                                        .join(", ");
                                       const directionsHref = mapUrlForLocation(venue);
                                      return (
                                        <div
                                          key={m.id}
                                          className={`competition-item-row flex flex-col items-stretch justify-between gap-3 rounded-lg border bg-card px-4 py-3 text-sm shadow-sm transition-shadow hover:shadow-md sm:flex-row sm:items-center ${
                                            m.status === "postponed" || m.status === "canceled"
                                              ? "bg-muted/30 opacity-75 shadow-none hover:shadow-none"
                                              : ""
                                          }`}
                                          data-testid={`row-match-${m.id}`}
                                        >
                                          <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-1">
                                              <span>#{m.matchNumber}</span>
                                              <span className="opacity-70">·</span>
                                              <span>
                                                {validDate
                                                  ? formatCompetitionDate(m.matchDate)
                                                  : "Date not listed"}
                                              </span>
                                              {m.startTime ? (
                                                <>
                                                  <span className="opacity-70">·</span>
                                                  <span>{m.startTime}</span>
                                                </>
                                              ) : null}
                                              {m.field ? (
                                                <>
                                                  <span className="opacity-70">·</span>
                                                  <span className="truncate">{m.field}</span>
                                                </>
                                              ) : null}
                                            </div>
                                            <div
                                              className={`font-bold tracking-tight ${
                                                m.status === "canceled"
                                                  ? "line-through text-muted-foreground"
                                                  : ""
                                              }`}
                                            >
                                              {m.homeTeamId ? (
                                                <Link
                                                  href={`/teams/${m.homeTeamId}`}
                                                  className="rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                                  data-testid={`link-match-home-team-${m.id}`}
                                                >
                                                  {m.homeName ?? "TBD"}
                                                </Link>
                                              ) : (
                                                m.homeName ?? "TBD"
                                              )}{" "}
                                              <span className="mx-1 text-xs font-medium text-muted-foreground">
                                                vs
                                              </span>{" "}
                                              {m.awayTeamId ? (
                                                <Link
                                                  href={`/teams/${m.awayTeamId}`}
                                                  className="rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                                  data-testid={`link-match-away-team-${m.id}`}
                                                >
                                                  {m.awayName ?? "TBD"}
                                                </Link>
                                              ) : (
                                                m.awayName ?? "TBD"
                                              )}
                                            </div>
                                            {venue ? (
                                              directionsHref ? (
                                                <a
                                                  href={directionsHref}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  className="mt-1 inline-flex max-w-full items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                                                  data-testid={`link-match-directions-${m.id}`}
                                                >
                                                  <MapPin className="h-3 w-3 shrink-0" />
                                                  <span className="truncate">{venue}</span>
                                                  <ExternalLink className="h-3 w-3 shrink-0" />
                                                </a>
                                              ) : (
                                                <p className="mt-1 truncate text-[11px] text-muted-foreground">
                                                  {venue}
                                                </p>
                                              )
                                            ) : null}
                                            {(m.status === "postponed" || m.status === "canceled") &&
                                            m.statusReason ? (
                                              <p className="mt-1 truncate text-[11px] italic text-muted-foreground">
                                                {m.statusReason}
                                              </p>
                                            ) : null}
                                          </div>
                                          <div className="flex shrink-0 flex-row items-center justify-between gap-2 sm:flex-col sm:items-end">
                                            {m.status === "postponed" || m.status === "canceled" ? (
                                              <span
                                                className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider ${
                                                  m.status === "postponed"
                                                    ? "border-amber-300/50 bg-amber-50/50 text-amber-700 dark:border-amber-700/50 dark:bg-amber-950/50 dark:text-amber-400"
                                                    : "border-red-300/50 bg-red-50/50 text-red-700 dark:border-red-700/50 dark:bg-red-950/50 dark:text-red-400"
                                                }`}
                                                data-testid={`badge-match-status-${m.id}`}
                                              >
                                                {m.status === "postponed" ? "Postponed" : "Canceled"}
                                              </span>
                                            ) : null}
                                            <div className="flex items-center gap-1">
                                              <Button
                                                type="button"
                                                size="icon"
                                                variant="ghost"
                                                className="h-8 w-8"
                                                onClick={() => downloadMatchCalendar(m)}
                                                aria-label={`Add ${m.homeName ?? "TBD"} vs ${m.awayName ?? "TBD"} to calendar`}
                                                data-testid={`btn-match-calendar-${m.id}`}
                                              >
                                                <CalendarPlus className="h-4 w-4" />
                                              </Button>
                                              <Button
                                                type="button"
                                                size="icon"
                                                variant="ghost"
                                                className="h-8 w-8"
                                                onClick={() => void shareMatch(m)}
                                                aria-label={`Share ${m.homeName ?? "TBD"} vs ${m.awayName ?? "TBD"}`}
                                                data-testid={`btn-match-share-${m.id}`}
                                              >
                                                <Share2 className="h-4 w-4" />
                                              </Button>
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </CollapsibleContent>
                              </div>
                            </Collapsible>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )}
              </CollapsibleContent>
            </Collapsible>
          </CardContent>
        </Card>
        </div>

        <p className="text-center text-xs text-muted-foreground pb-4">
          Powered by <span className="font-bold">Kinectem</span>
        </p>
      </div>

      {/* Hide-team confirmation (operators only). */}
      <AlertDialog
        open={pendingHide != null}
        onOpenChange={(open) => {
          if (!open) setPendingHide(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hide this team?</AlertDialogTitle>
            <AlertDialogDescription>
              "{pendingHide?.name}" will no longer appear in the public Teams
              list, and it can't be claimed while hidden. Its scheduled games
              stay on the schedule. You can unhide it anytime.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="btn-cancel-hide-participant">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="btn-confirm-hide-participant"
              onClick={() => {
                if (pendingHide) {
                  hideMutation.mutate({
                    participantId: pendingHide.id,
                    hide: true,
                    competitionId: c.id,
                  });
                }
                setPendingHide(null);
              }}
            >
              Hide team
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Task #866 — bulk hide confirmation (operators only). */}
      <AlertDialog open={bulkHideOpen} onOpenChange={setBulkHideOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Hide {selectedIds.size} team{selectedIds.size === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The selected teams will no longer appear in the public Teams
              list, and they can't be claimed while hidden. Their scheduled
              games stay on the schedule. You can unhide any of them anytime.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="btn-cancel-bulk-hide">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="btn-confirm-bulk-hide"
              onClick={() => {
                // Guard against a stale selection (a refetch may have removed
                // or already hidden a team since it was ticked).
                const ids = Array.from(selectedIds).filter((id) =>
                  participants.some((p) => p.id === id && !p.hidden),
                );
                if (ids.length > 0) {
                  bulkHideMutation.mutate({
                    participantIds: ids,
                    competitionId: c.id,
                  });
                } else {
                  setSelectedIds(new Set());
                }
                setBulkHideOpen(false);
              }}
            >
              Hide teams
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
