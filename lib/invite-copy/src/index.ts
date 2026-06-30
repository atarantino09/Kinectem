// Task #634 — single source of truth for the coach's "join Kinectem" invite
// message. The exact wording is finalized and must be used verbatim; only the
// coach's display name (`[Name]`) and the set-up/accept link (`[link]`) are
// substituted per surface.
//
// This lib is consumed by two surfaces that must stay in lockstep:
//   1. The in-app copy-to-clipboard block on the team invite screen
//      (frontend, plain text).
//   2. The invite email Kinectem sends to an unknown invitee address
//      (api-server, plain text + HTML).
//
// Keep the wording here and nowhere else. Surfaces render from these pieces.

export const COACH_INVITE_SUBJECT = "Our game recaps are now on Kinectem!";

export interface CoachInviteVars {
  /** Coach's display name; fills the `[Name]` slot in the sign-off. */
  coachName: string;
  /** Set-up / accept link; fills the `[link]` slot. */
  link: string;
}

const GREETING = "Hi there,";

const INTRO_PARAGRAPHS: readonly string[] = [
  "We're posting game recaps on Kinectem this season, and we want you reading every one.",
  "A game recap isn't a box score — it's the story of the game: the effort, the turning points, the plays that never show up on a stat sheet. And every player on the roster gets tagged in every game recap, so your player is part of the story every game, not just whoever scored.",
  "Your player gets their own account, and you set it up and manage it. Their page collects every game recap all season. Instead of disappearing into a group chat or a camera roll, it builds into a permanent record of their whole journey with our team — something they'll still have long after the season ends.",
];

const CONTROL_INTRO = "You stay in control:";

const BULLETS: readonly string[] = [
  "You create and manage your player's profile",
  "It's private and safe by default — you decide what's visible and who sees it",
  "You review and approve photos and posts before anything goes public",
];

const AFTER_BULLETS = "There's no cost to families. Setup takes about two minutes.";

const CTA_LABEL = "Set up your player's account →";

const QUESTIONS = "Questions? Just reply to this email.";

// Re-exported so a surface can render a structured preview if needed without
// re-typing the wording.
export const COACH_INVITE_CONTENT = {
  subject: COACH_INVITE_SUBJECT,
  greeting: GREETING,
  introParagraphs: INTRO_PARAGRAPHS,
  controlIntro: CONTROL_INTRO,
  bullets: BULLETS,
  afterBullets: AFTER_BULLETS,
  ctaLabel: CTA_LABEL,
  questions: QUESTIONS,
} as const;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Plain-text body of the invite message. Used verbatim for the in-app
 * copy-to-clipboard block and for the email's text part.
 */
export function buildCoachInviteText({ coachName, link }: CoachInviteVars): string {
  const bulletLines = BULLETS.map((b) => `• ${b}`).join("\n");
  return [
    GREETING,
    INTRO_PARAGRAPHS[0],
    INTRO_PARAGRAPHS[1],
    INTRO_PARAGRAPHS[2],
    CONTROL_INTRO,
    bulletLines,
    AFTER_BULLETS,
    `${CTA_LABEL} ${link}`,
    QUESTIONS,
    `— Coach ${coachName}`,
  ].join("\n\n");
}

/**
 * HTML body of the invite message for the email's html part. Preserves the
 * paragraph breaks and bullet list, and renders the CTA as a clickable link.
 * The coach name is escaped (user-controlled); the link is system-generated.
 */
export function buildCoachInviteHtml({ coachName, link }: CoachInviteVars): string {
  const linkAttr = escapeHtml(link);
  const bulletItems = BULLETS.map((b) => `<li>${escapeHtml(b)}</li>`).join("\n");
  return [
    `<p>${escapeHtml(GREETING)}</p>`,
    `<p>${escapeHtml(INTRO_PARAGRAPHS[0])}</p>`,
    `<p>${escapeHtml(INTRO_PARAGRAPHS[1])}</p>`,
    `<p>${escapeHtml(INTRO_PARAGRAPHS[2])}</p>`,
    `<p>${escapeHtml(CONTROL_INTRO)}</p>`,
    `<ul>\n${bulletItems}\n</ul>`,
    `<p>${escapeHtml(AFTER_BULLETS)}</p>`,
    `<p><a href="${linkAttr}">${escapeHtml(CTA_LABEL)}</a></p>`,
    `<p>${escapeHtml(QUESTIONS)}</p>`,
    `<p>— Coach ${escapeHtml(coachName)}</p>`,
  ].join("\n");
}
