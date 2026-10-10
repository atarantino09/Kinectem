import { useEffect, useState } from "react";
import { competitionRecapOpensAt, competitionRecapsOpen, nextLocalRecapBoundary } from "@/lib/competitionRecapAvailability";
import type { ClaimedCompetition } from "./useNewPostForm";

export function localRecapDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function activeRecapCompetitions(competitions: ClaimedCompetition[], date: string, now = Date.now()) {
  const day = date.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return [];
  return competitions.filter((competition) => {
    const start = competition.startDate?.slice(0, 10);
    const end = competition.endDate?.slice(0, 10) || start;
    const opensAt = competitionRecapOpensAt(start);
    if (opensAt === null || !end || !competitionRecapsOpen(start, now)) return false;
    const openingDate = new Date(opensAt);
    const firstDay = `${openingDate.getFullYear()}-${String(openingDate.getMonth() + 1).padStart(2, "0")}-${String(openingDate.getDate()).padStart(2, "0")}`;
    return firstDay <= day && day <= end;
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
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      const current = Date.now();
      setNow(current);
      timer = setTimeout(refresh, nextLocalRecapBoundary(current) - current);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  const context = `${teamId}:${date}`;
  const activeCompetitions = activeRecapCompetitions(competitions, date, now);
  return {
    competitions: activeCompetitions,
    open: eligible && !!teamId && !loading && !competitionId &&
      activeCompetitions.length > 0 && !acknowledged.has(context),
    acknowledge: () => setAcknowledged((previous) => new Set([...previous, context])),
  };
}
