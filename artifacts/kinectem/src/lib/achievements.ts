import type { AchievementAward, AchievementCatalogItem } from "@/hooks/use-achievements";

export const TIER_LABEL = { 1: "Bronze", 2: "Silver", 3: "Gold" } as const;

export function bestAwards(awards: AchievementAward[]): Map<string, AchievementAward> {
  const m = new Map<string, AchievementAward>();
  for (const a of awards) {
    const cur = m.get(a.key);
    if (!cur || a.tier > cur.tier) m.set(a.key, a);
  }
  return m;
}

export function nextThreshold(item: AchievementCatalogItem, award?: AchievementAward): number | null {
  const t = [...item.thresholds].sort((a, b) => a - b);
  if (t.length <= 1 && award) return null;
  return t.find((n) => !award || n > award.threshold) ?? null;
}

/** Row shows each selected earned badge once, at its highest tier. */
export function orderForRow(catalog: AchievementCatalogItem[], awards: AchievementAward[], featured: string[]) {
  const best = bestAwards(awards);
  const items = [...new Set(featured)]
    .map((k) => catalog.find((c) => c.key === k && best.has(k)))
    .filter((c): c is AchievementCatalogItem => !!c);
  return { best, items };
}

/** Streak deadline = end of the UTC day (the API supplies it); shown as a UTC date. */
export function formatDeadlineUtc(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `end of ${d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" })} UTC`;
}

export function formatUtc(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", { timeZone: "UTC", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " UTC";
}

export function hoursUntil(iso: string | null, now = Date.now()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : (t - now) / 3_600_000;
}
