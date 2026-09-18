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

import {
  emailButton,
  emailChecklist,
  emailSection,
  emailSummary,
} from "@workspace/email-template";

export const COACH_INVITE_SUBJECT = "Our game recaps are now on Kinectem!";

/**
 * Short, audience-neutral explanation for invite emails that do not already
 * include the richer parent or staff product story.
 */
export const KINECTEM_INVITE_CONTEXT =
  "Kinectem is a youth-sports platform where teams share game recaps, recognize every athlete, and build a lasting story of each season, with privacy and safety at the center.";

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

const LEARN_MORE =
  "Check out www.kinectem.com to learn even more prior to signing up.";

const LEARN_MORE_URL = "https://www.kinectem.com";

const CTA_LABEL = "Set up your player's account →";

// Re-exported so a surface can render a structured preview if needed without
// re-typing the wording.
export const COACH_INVITE_CONTENT = {
  subject: COACH_INVITE_SUBJECT,
  greeting: GREETING,
  introParagraphs: INTRO_PARAGRAPHS,
  controlIntro: CONTROL_INTRO,
  bullets: BULLETS,
  afterBullets: AFTER_BULLETS,
  learnMore: LEARN_MORE,
  ctaLabel: CTA_LABEL,
} as const;

// Task #837 — staff variant of the invite. Sent (and shown in the in-app
// copy block) when the invitee is being brought on as team staff — coach,
// assistant coach, or manager — instead of a parent/player. One shared
// wording for all three staff roles; the team name and role label are
// substituted per invite. Parent/player invites keep the copy above
// verbatim.

/** Spec-level positions that get the staff invite wording. */
export const STAFF_INVITE_POSITIONS = [
  "coach",
  "assistant_coach",
  "manager",
] as const;

export type StaffInvitePosition = (typeof STAFF_INVITE_POSITIONS)[number];

export function isStaffInvitePosition(
  position: string | null | undefined,
): position is StaffInvitePosition {
  return (
    position === "coach" ||
    position === "assistant_coach" ||
    position === "manager"
  );
}

/** Human-readable role label used in the staff invite ("as an Assistant Coach"). */
export function staffInviteRoleLabel(position: string | null | undefined): string {
  switch (position) {
    case "assistant_coach":
      return "Assistant Coach";
    case "manager":
      return "Team Manager";
    default:
      return "Coach";
  }
}

/** "a Coach" / "an Assistant Coach" — indefinite article for the role label. */
function withArticle(roleLabel: string): string {
  return /^[aeiou]/i.test(roleLabel) ? `an ${roleLabel}` : `a ${roleLabel}`;
}

export function staffInviteSubject(teamName: string): string {
  return `You're invited to join ${teamName} on Kinectem`;
}

export interface StaffInviteVars {
  /** Inviter's display name; fills the sign-off. */
  inviterName: string;
  /** Team the invitee is joining. */
  teamName: string;
  /** Human-readable role label, e.g. "Assistant Coach". */
  roleLabel: string;
  /** Set-up / accept link. */
  link: string;
}

const STAFF_GREETING = "Hi there,";

function staffInviteLine({ inviterName, teamName, roleLabel }: StaffInviteVars): string {
  return `${inviterName} has invited you to join ${teamName} on Kinectem as ${withArticle(roleLabel)}.`;
}

const STAFF_ABOUT =
  "Kinectem is where teams share game recaps — not box scores, but the story of the season: the effort, the turning points, and the plays that never show up on a stat sheet. Every player on the roster gets tagged in every recap, so the whole team is part of the story.";

// Task #843 — pitch the recap-authoring role + AI Assist. The role label is
// substituted per invite ("As a Coach, …").
function staffAiAssistParagraph({ roleLabel }: Pick<StaffInviteVars, "roleLabel">): string {
  return `As ${withArticle(roleLabel)}, you'll be the one bringing those stories to life. And it couldn't be easier — jot down a few sentences about the game, hit the AI Assist button, and watch it become a beautifully written recap. You review it, make it yours, and post it. Minutes, not hours.`;
}

const STAFF_ARCHIVE =
  "Every game recap adds another chapter to the story of the season. Over time, those chapters become a permanent, searchable archive of the team's journey — something players, families, and coaches can return to long after the final whistle.";

const STAFF_SETUP =
  "Accept the invite below to set up your account and take your spot on the team.";

const STAFF_LEARN_MORE =
  "Check out www.kinectem.com to learn even more prior to signing up.";

const STAFF_CTA_LABEL = "Accept your invite →";

export const STAFF_INVITE_CONTENT = {
  greeting: STAFF_GREETING,
  about: STAFF_ABOUT,
    archive: STAFF_ARCHIVE,
  setup: STAFF_SETUP,
  learnMore: STAFF_LEARN_MORE,
  ctaLabel: STAFF_CTA_LABEL,
} as const;

export interface MultiTeamStaffInviteVars {
  inviterName: string;
  organizationName: string;
  teamNames: readonly string[];
  roleLabel: string;
  link: string;
}
/**
 * Plain-text body of the staff invite message. Used verbatim for the in-app
 * copy-to-clipboard block and for the email's text part.
 */
export function buildStaffInviteText(vars: StaffInviteVars): string {
  return [
    STAFF_GREETING,
    staffInviteLine(vars),
    STAFF_ABOUT,
    staffAiAssistParagraph(vars),
    STAFF_ARCHIVE,
    STAFF_SETUP,
    STAFF_LEARN_MORE,
    `${STAFF_CTA_LABEL} ${vars.link}`,
    `— ${vars.inviterName}`,
  ].join("\n\n");
}

/**
 * HTML body of the staff invite message for the email's html part. Inviter
 * name, team name, and role label are escaped (user-controlled); the link is
 * system-generated.
 */
export function buildStaffInviteHtml(vars: StaffInviteVars): string {
  const ctaLabel = STAFF_CTA_LABEL.replace(/ →$/, "");
  return [
    `<p>${escapeHtml(STAFF_GREETING)}</p>`,
    emailSummary(staffInviteLine(vars)),
    emailSection(
      "About Kinectem",
      `<p>${escapeHtml(STAFF_ABOUT)}</p><p>${escapeHtml(staffAiAssistParagraph(vars))}</p><p>${escapeHtml(STAFF_ARCHIVE)}</p>`,
    ),
    emailSection("Your invitation", `<p>${escapeHtml(STAFF_SETUP)}</p>`),
    `<p>Check out <a href="${LEARN_MORE_URL}">www.kinectem.com</a> to learn even more prior to signing up.</p>`,
    emailButton({ href: vars.link, label: ctaLabel }),
    `<p>— ${escapeHtml(vars.inviterName)}</p>`,
  ].join("\n");
}

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
    LEARN_MORE,
    `${CTA_LABEL} ${link}`,
    `— Coach ${coachName}`,
  ].join("\n\n");
}

/**
 * HTML body of the invite message for the email's html part. Preserves the
 * paragraph breaks and bullet list, and renders the CTA as a clickable link.
 * The coach name is escaped (user-controlled); the link is system-generated.
 */
export function buildCoachInviteHtml({ coachName, link }: CoachInviteVars): string {
  const ctaLabel = CTA_LABEL.replace(/ →$/, "");
  return [
    `<p>${escapeHtml(GREETING)}</p>`,
    emailSummary(INTRO_PARAGRAPHS[0]),
    `<p>${escapeHtml(INTRO_PARAGRAPHS[1])}</p>`,
    emailSection("Your player's account", `<p>${escapeHtml(INTRO_PARAGRAPHS[2])}</p>`),
    emailSection(CONTROL_INTRO, emailChecklist(BULLETS)),
    `<p>${escapeHtml(AFTER_BULLETS)}</p>`,
    `<p>Check out <a href="${LEARN_MORE_URL}">www.kinectem.com</a> to learn even more prior to signing up.</p>`,
    emailButton({ href: link, label: ctaLabel }),
    `<p>— Coach ${escapeHtml(coachName)}</p>`,
  ].join("\n");
}

export function buildMultiTeamStaffInviteHtml(
  vars: MultiTeamStaffInviteVars,
): string {
  const list = vars.teamNames.map((name) => escapeHtml(name));
  const ctaLabel = STAFF_CTA_LABEL.replace(/ →$/, "");
  return [
    `<p>${escapeHtml(STAFF_GREETING)}</p>`,
    emailSummary(
      `${vars.inviterName} has invited you to join ${vars.organizationName} on Kinectem as ${withArticle(vars.roleLabel)}.`,
    ),
    emailSection(
      "You'll be joining these teams:",
      `<ul>\n${list.map((name) => `<li>${name}</li>`).join("\n")}\n</ul>`,
    ),
    emailSection(
      "About Kinectem",
      `<p>${escapeHtml(STAFF_ABOUT)}</p><p>${escapeHtml(staffAiAssistParagraph({ roleLabel: vars.roleLabel }))}</p><p>${escapeHtml(STAFF_ARCHIVE)}</p>`,
    ),
    emailSection("Your invitation", `<p>${escapeHtml(STAFF_SETUP)}</p>`),
    `<p>Check out <a href="${LEARN_MORE_URL}">www.kinectem.com</a> to learn even more prior to signing up.</p>`,
    emailButton({ href: vars.link, label: ctaLabel }),
    `<p>— ${escapeHtml(vars.inviterName)}</p>`,
  ].join("\n");
}

export function multiTeamStaffInviteSubject(organizationName: string): string {
  return `You're invited to join ${organizationName} on Kinectem`;
}

export function buildMultiTeamStaffInviteText(
  vars: MultiTeamStaffInviteVars,
): string {
  const teams = vars.teamNames.map((name) => `• ${name}`).join("\n");
  return [
    STAFF_GREETING,
    `${vars.inviterName} has invited you to join ${vars.organizationName} on Kinectem as ${withArticle(vars.roleLabel)}.`,
    "You'll be joining these teams:",
    teams,
    STAFF_ABOUT,
    staffAiAssistParagraph({ roleLabel: vars.roleLabel }),
    STAFF_ARCHIVE,
    STAFF_SETUP,
    STAFF_LEARN_MORE,
    `${STAFF_CTA_LABEL} ${vars.link}`,
    `— ${vars.inviterName}`,
  ].join("\n\n");
}
