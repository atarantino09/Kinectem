import { z } from "zod";

export const PreviousSeason = z.object({
  season: z.string().trim().max(80),
  gamePlayedDate: z.string().max(10),
  attested: z.boolean(),
}).strict();

export function previousSeasonError(value: unknown, published: boolean, now = new Date()): string | null {
  if (value === null || value === undefined) return null;
  const parsed = PreviousSeason.safeParse(value);
  if (!parsed.success) return "Invalid previous-season game metadata.";
  const { season, gamePlayedDate, attested } = parsed.data;
  if (!published && !gamePlayedDate) return null;
  const date = new Date(`${gamePlayedDate}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(gamePlayedDate) || Number.isNaN(date.getTime())
    || date.toISOString().slice(0, 10) !== gamePlayedDate || date >= now
    || gamePlayedDate >= now.toISOString().slice(0, 10)) {
    return "Game played date must be the actual game date, a valid past date, not the posting date.";
  }
  if (published && (!season || !attested)) return "Enter the season/year and confirm this game was played in a previous season.";
  return null;
}
