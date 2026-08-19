// Task #727 — ready-made invite message competition organizers copy/paste to
// their teams (email, group chat, league bulletin). Plain text only so it
// pastes cleanly anywhere. Steps mirror the real claim flow on the public
// competition page (`/c/<slug>`) + TournamentSignupPage — keep in sync if
// that flow changes.

export interface CompetitionInviteInput {
  name: string;
  type: "tournament" | "league";
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  location: string | null;
  autoApproveClaims: boolean;
  /** Absolute public competition URL (with the /app prefix). */
  url: string;
  /**
   * Task #818 — effective promo code (competition's own, else the hub's).
   * When present the message mentions the 25% first-year discount; when
   * null/absent the message reads normally without any promo mention.
   */
  promoCode?: string | null;
}

/**
 * Task #818 — resolve the code that should auto-fill outreach messages:
 * the competition's own code wins, otherwise the hub's code, else null.
 */
export function resolveEffectivePromoCode(
  competitionCode: string | null | undefined,
  hubCode: string | null | undefined,
): string | null {
  const comp = competitionCode?.trim();
  if (comp) return comp;
  const hub = hubCode?.trim();
  return hub || null;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// Parse "YYYY-MM-DD" without going through Date (avoids timezone drift).
function formatDate(iso: string, withYear: boolean): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const month = MONTHS[Number(m[2]) - 1] ?? m[2];
  const day = Number(m[3]);
  return withYear ? `${month} ${day}, ${m[1]}` : `${month} ${day}`;
}

export function formatDateRange(startDate: string, endDate: string): string {
  if (startDate === endDate) return formatDate(startDate, true);
  const sameYear = startDate.slice(0, 4) === endDate.slice(0, 4);
  return `${formatDate(startDate, !sameYear)} – ${formatDate(endDate, true)}`;
}

export function buildCompetitionInviteMessage(
  c: CompetitionInviteInput,
): string {
  const dates = formatDateRange(c.startDate, c.endDate);
  const promoCode = c.promoCode?.trim() || "[PROMO CODE]";

  const lines: string[] = [
    `Subject: Your team page for ${c.name} is ready to claim`,
    ``,
    `Hi coaches and team managers,`,
    ``,
    `${c.name} (${dates}) is on Kinectem this year — and your team already has a page waiting for you. Claiming it is free and takes about two minutes.`,
    ``,
    `Kinectem is the youth-sports platform where the story of your season comes to life. Coaches publish game recaps that live on the team page and tag all rostered players — so every game recap lands on each of your players' pages, not just the team's. It goes beyond the box score: the hustle plays, the turning points, the kids the stat sheet never mentions.`,
    ``,
    `And it's less work than it sounds. AI Assist is built right into the game recap composer, so a few quick notes after the game turn into a polished game story in a couple of minutes.`,
    ``,
    `Once you claim your page, your schedule shows up automatically, parents and players can follow along all season, and everything runs on safe, COPPA-compliant profiles built for youth sports.`,
    ``,
    `How to claim your team:`,
    `1. Open the event page: ${c.url}`,
    `2. Find your team's name in the Teams list`,
    `3. Tap "Claim" next to your team`,
    `4. Sign up for a free Kinectem account (or log in if you already have one)`,
    `5. Pick your existing Kinectem team — or create a new one`,
    `6. That's it. Your games are added to your team page automatically.`,
    ``,
    `What it costs: nothing to claim. If your team is new to Kinectem, your standalone team page is free through our event and for two weeks after it starts. To keep going after that, just create or join an organization on Kinectem — and a new organization's first 90 days are free, so there's no interruption and no charge along the way.`,
    ``,
    `One more thing: if your club isn't on Kinectem yet, use promo code ${promoCode} when you pick your organization's plan — it takes 25% off your first year.`,
    ``,
    `Questions about claiming your team? competitions@kinectem.com will get you sorted.`,
    ``,
    `See you on Kinectem!`,
  ];

  return lines.join("\n");
}
