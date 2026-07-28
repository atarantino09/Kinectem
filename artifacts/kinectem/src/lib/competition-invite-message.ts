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
  const typeLabel = c.type === "league" ? "league" : "tournament";
  const dates = formatDateRange(c.startDate, c.endDate);
  const where = c.location ? ` at ${c.location}` : "";

  const lines: string[] = [
    `Hi coaches and team managers,`,
    ``,
    `${c.name} (${dates}${where}) is on Kinectem this year — and your team already has a page waiting for you. Claiming it is free and takes about two minutes.`,
    ``,
    `Kinectem is a storytelling platform for youth sports organizations, where coaches publish game recaps that live on team pages and tag to each player's profile — going beyond the box score, capturing the hustle plays and turning points the stat sheet misses.`,
    ``,
    `Why claim your team's page:`,
    `- It's completely free to claim (teams new to Kinectem get a standalone team page free for 2 weeks after our event starts — after that, just create or join an organization on Kinectem; a new organization's first 90 days are free, so your team keeps going without interruption)`,
    `- Your ${typeLabel} schedule shows up on your team page automatically`,
    `- Share game recaps and highlights after every game`,
    `- Parents and players can follow your team page for updates`,
    `- Built for youth sports — COPPA-safe for players under 13`,
    ``,
    `How to claim your team:`,
    `1. Open the ${typeLabel} page: ${c.url}`,
    `2. Find your team's name in the Teams list`,
    `3. Tap "Claim" next to your team`,
    `4. Sign up for a free Kinectem account (or log in if you already have one)`,
    `5. Pick your existing Kinectem team — or create a new one just for this ${typeLabel}`,
    `6. That's it! Your games are added to your team page automatically.`,
  ];

  const promoCode = c.promoCode?.trim();
  if (promoCode) {
    lines.push(
      ``,
      `One more thing: if your club isn't on Kinectem yet, use our promo code ${promoCode} when you pick your organization's plan — it takes 25% off your first year on Kinectem.`,
    );
  }

  if (!c.autoApproveClaims) {
    lines.push(
      ``,
      `One note: we review each claim, so your team may show as "pending" for a little while before it's approved.`,
    );
  }

  lines.push(``, `See you on Kinectem!`);

  return lines.join("\n");
}
