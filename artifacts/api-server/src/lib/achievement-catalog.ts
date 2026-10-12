export type AchievementSubject = "user" | "team" | "organization";
export const ACHIEVEMENT_CATALOG = [
  { key: "first-story", name: "First Story", subject: "user", thresholds: [1], metric: "current", criteria: "Publish your first current-game recap." },
  { key: "team-storyteller", name: "Team Storyteller", subject: "user", thresholds: [10, 25, 50], metric: "current", criteria: "Publish 10 / 25 / 50 current-game recaps across your teams." },
  { key: "reliable-reporter", name: "Reliable Reporter", subject: "user", thresholds: [4, 8, 12], metric: "streak", criteria: "Contribute on 4 / 8 / 12 distinct UTC days, per team, no more than 10 days apart. Confirmed no-game pauses protect active runs." },
  { key: "beyond-scoreboard", name: "Beyond the Scoreboard", subject: "user", thresholds: [5, 15, 30], metric: "updates", criteria: "Publish 5 / 15 / 30 non-game team updates or private practice plans. No private plan evidence is shared." },
  { key: "retro-recapper", name: "Retro Recapper", subject: "user", thresholds: [5, 20, 50], metric: "retro", criteria: "Publish 5 / 20 / 50 original, dated, explicitly attested previous-season game recaps. Newspaper clippings do not count." },
  { key: "first-whistle", name: "First Whistle", subject: "team", thresholds: [1], metric: "current", criteria: "Publish the team's first current-game recap." },
  { key: "team-storytellers", name: "Team Storytellers", subject: "team", thresholds: [10, 25, 50], metric: "current", criteria: "Collectively publish 10 / 25 / 50 current-game recaps." },
  { key: "on-a-roll", name: "On a Roll", subject: "team", thresholds: [4, 8, 12], metric: "streak", criteria: "Publish on 4 / 8 / 12 distinct UTC days, no more than 10 days apart. No schedule is required; confirmed no-game pauses protect active runs." },
  { key: "game-day-memories", name: "Game Day Memories", subject: "team", thresholds: [3, 10, 25], metric: "photos", criteria: 'Attach photos when publishing a recap, or open a published recap and choose "Photo & Video Album". Each recap counts once, not each photo. Original retro game recaps qualify; clippings, plans, highlights and video-only contributions do not.' },
  { key: "our-story-begins", name: "Our Story Begins", subject: "organization", thresholds: [1], metric: "story", criteria: "Publish a public organization update or an affiliated team's current-game recap. Affiliation is captured when published." },
  { key: "club-chroniclers", name: "Club Chroniclers", subject: "organization", thresholds: [25, 100, 250], metric: "current", criteria: "Affiliated teams contribute 25 / 100 / 250 current-game recaps. Moving teams does not move past credit." },
  { key: "connected-club", name: "Connected Club", subject: "organization", thresholds: [50], metric: "participation", criteria: "At least 50% of eligible teams contribute a current-game recap or public team update within 30 days, with at least two participating teams. Eligible teams are current, non-archived teams with a qualifying public contribution within 90 days." },
] as const;

export function earnedTier(thresholds: readonly number[], count: number): number {
  return thresholds.filter((threshold) => count >= threshold).length;
}
