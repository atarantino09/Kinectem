import { useState } from "react";
import type { ClaimedCompetition } from "./useNewPostForm";

export function localRecapDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function activeRecapCompetitions(competitions: ClaimedCompetition[], date: string) {
  const day = date.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return [];
  return competitions.filter((competition) => {
    const start = competition.startDate?.slice(0, 10);
    const end = competition.endDate?.slice(0, 10) || start;
    return !!start && !!end && start <= day && day <= end;
  });
}

export function useCompetitionRecapReminder({
  teamId, date, competitions, loading, eligible, competitionId,
}: {
  teamId: string;
  date: string;
  competitions: ClaimedCompetition[];
  loading: boolean;
  eligible: boolean;
  competitionId: string;
}) {
  const [acknowledged, setAcknowledged] = useState<Set<string>>(() => new Set());
  const context = `${teamId}:${date}`;
  const activeCompetitions = activeRecapCompetitions(competitions, date);
  return {
    competitions: activeCompetitions,
    open: eligible && !!teamId && !loading && !competitionId &&
      activeCompetitions.length > 0 && !acknowledged.has(context),
    acknowledge: () => setAcknowledged((previous) => new Set([...previous, context])),
  };
}
