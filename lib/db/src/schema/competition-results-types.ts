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
export interface TournamentStoryContent {
  title: string;
  body: string;
  importId: string;
  groupKey: string;
  sourceUrl: string | null;
  resultsAsOf: string;
  partial: boolean;
}
