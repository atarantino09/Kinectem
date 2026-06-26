import { logger } from "./logger.js";

// S5 — escape user-controlled values before interpolating them into HTML email
// bodies. Plain-text parts don't need escaping.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  // S12 — a non-PII event key (e.g. "guardian_confirm") used for log
  // triage. The subject itself can embed minor names / post titles, so it
  // must never be logged; this is logged instead.
  kind?: string;
};

const SENDGRID_URL = "https://api.sendgrid.com/v3/mail/send";

// Resolve SendGrid credentials, preferring the Replit "sendgrid" connector
// and falling back to plain env vars (local dev, CI, tests). Per the
// connector docs the proxy-issued token can rotate, so we DO NOT cache —
// every send fetches fresh credentials.
async function resolveCredentials(): Promise<
  { apiKey: string; from: string } | null
> {
  const envKey = process.env.SENDGRID_API_KEY;
  const envFrom = process.env.EMAIL_FROM;
  if (envKey && envFrom) return { apiKey: envKey, from: envFrom };

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? `repl ${process.env.REPL_IDENTITY}`
    : process.env.WEB_REPL_RENEWAL
      ? `depl ${process.env.WEB_REPL_RENEWAL}`
      : null;
  if (!hostname || !xReplitToken) return null;

  try {
    const res = await fetch(
      `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=sendgrid`,
      { headers: { Accept: "application/json", "X-Replit-Token": xReplitToken } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      items?: Array<{ settings?: { api_key?: string; from_email?: string } }>;
    };
    const settings = data.items?.[0]?.settings;
    const apiKey = settings?.api_key ?? envKey;
    const from = settings?.from_email ?? envFrom;
    if (!apiKey || !from) return null;
    return { apiKey, from };
  } catch (err) {
    logger.warn({ err }, "Failed to fetch SendGrid credentials from Replit connector proxy");
    if (envKey && envFrom) return { apiKey: envKey, from: envFrom };
    return null;
  }
}

// Sync best-effort check for callers that need to gate UI/branching
// (e.g. article-tagging.ts) without doing async work. True if either the
// env-var path is fully populated OR the Replit connector proxy is
// reachable in this environment.
export function isEmailConfigured(): boolean {
  if (process.env.SENDGRID_API_KEY && process.env.EMAIL_FROM) return true;
  const hasConnector =
    Boolean(process.env.REPLIT_CONNECTORS_HOSTNAME) &&
    Boolean(process.env.REPL_IDENTITY ?? process.env.WEB_REPL_RENEWAL);
  return hasConnector;
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  const creds = await resolveCredentials();
  if (!creds) {
    logger.warn(
      // S12 — log only a non-PII event kind; the recipient address and the
      // subject (which can embed minor names / post titles) are never logged.
      { kind: message.kind ?? "unknown" },
      "Email not sent: SENDGRID_API_KEY and/or EMAIL_FROM are not configured.",
    );
    return;
  }

  const body = {
    personalizations: [{ to: [{ email: message.to }] }],
    from: { email: creds.from },
    subject: message.subject,
    content: [
      { type: "text/plain", value: message.text },
      ...(message.html
        ? [{ type: "text/html", value: message.html }]
        : []),
    ],
  };

  const res = await fetch(SENDGRID_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    // S12 — never log the SendGrid response body; it can echo recipient PII
    // and partial credentials. The status code is enough to diagnose.
    logger.error(
      // S12 — status + non-PII event kind only; never the recipient address,
      // the subject (can embed minor names / post titles), or the response body.
      { status: res.status, kind: message.kind ?? "unknown" },
      "SendGrid email delivery failed",
    );
    throw new Error(`Email delivery failed (${res.status})`);
  }
}

export function appBaseUrl(): string {
  return (
    process.env.APP_BASE_URL ??
    (process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : "http://localhost:5173")
  ).replace(/\/+$/, "");
}

export function buildPasswordResetUrl(token: string): string {
  return `${appBaseUrl()}/reset-password/${token}`;
}

export function buildGuardianConfirmUrl(token: string): string {
  return `${appBaseUrl()}/guardian-confirm/${token}`;
}

export function buildFamilyUrl(): string {
  return `${appBaseUrl()}/family`;
}

// Task #541 — accept-landing URL for the organization invite token.
export function buildOrganizationInviteUrl(token: string): string {
  return `${appBaseUrl()}/org-invites/${token}`;
}

// Task #541 — Sent when an org owner/admin invites someone (by email) to
// join their organization. The link lands on the in-app accept page;
// recipients sign in or sign up first if needed.
export async function sendOrganizationInviteEmail(
  to: string,
  args: {
    organizationName: string;
    inviterDisplayName: string;
    role: "admin" | "member";
    token: string;
    note?: string | null;
  },
): Promise<void> {
  const { organizationName, inviterDisplayName, role, token, note } = args;
  const url = buildOrganizationInviteUrl(token);
  const roleLabel = role === "admin" ? "an admin" : "a member";
  // S5 — escape user-controlled values for the HTML body.
  const orgHtml = escapeHtml(organizationName);
  const inviterHtml = escapeHtml(inviterDisplayName);
  const notePlain = note && note.trim() ? `\n\nNote from ${inviterDisplayName}:\n${note.trim()}\n` : "";
  const noteHtml = note && note.trim()
    ? `<p><em>Note from ${inviterHtml}:</em></p><blockquote>${escapeHtml(note.trim()).replace(/\n/g, "<br/>")}</blockquote>`
    : "";
  await sendEmail({
    to,
    kind: "organization_invite",
    subject: `${inviterDisplayName} invited you to join ${organizationName} on Kinectem`,
    text: `${inviterDisplayName} invited you to join ${organizationName} on Kinectem as ${roleLabel}.
${notePlain}
Open this link to accept:
${url}

If you don't have a Kinectem account yet, you can sign up from the same link.`,
    html: `<p><strong>${inviterHtml}</strong> invited you to join <strong>${orgHtml}</strong> on Kinectem as ${roleLabel}.</p>
${noteHtml}
<p>Open this link to accept:</p>
<p><a href="${url}">${url}</a></p>
<p>If you don't have a Kinectem account yet, you can sign up from the same link.</p>`,
  });
}

export function buildPostUrl(link: string): string {
  // Callers store post links as relative paths (e.g. "/posts/article-…").
  // Stitch them onto the configured app base url so the email lands users
  // on the same page the bell row would.
  const path = link.startsWith("/") ? link : `/${link}`;
  return `${appBaseUrl()}${path}`;
}

// Sent when a player is newly tagged on a recap or highlight (task #324).
// Pending tags get a "review and approve" prompt because the consenting
// user (or their guardian) still has to act before the tag goes live.
// Approved tags get the "you were tagged" line that mirrors the bell.
export async function sendTagNotificationEmail(
  to: string,
  args: { postTitle: string; postUrl: string; pending: boolean },
): Promise<void> {
  const { postTitle, postUrl, pending } = args;
  const titleHtml = escapeHtml(postTitle);
  if (pending) {
    await sendEmail({
      to,
      kind: "tag_notification_pending",
      subject: `Please review a tag on you in "${postTitle}"`,
      text: `Someone tagged you in "${postTitle}" on Kinectem. Because you (or your guardian) ask to approve tags first, the tag is waiting for your review.

Open the post to approve or remove the tag:
${postUrl}

If you'd rather not see these emails, change tag-consent settings on your Kinectem profile.`,
      html: `<p>Someone tagged you in <strong>${titleHtml}</strong> on Kinectem. Because you (or your guardian) ask to approve tags first, the tag is waiting for your review.</p>
<p>Open the post to approve or remove the tag:</p>
<p><a href="${postUrl}">${postUrl}</a></p>
<p>If you'd rather not see these emails, change tag-consent settings on your Kinectem profile.</p>`,
    });
    return;
  }
  await sendEmail({
    to,
    kind: "tag_notification",
    subject: `You were tagged in "${postTitle}"`,
    text: `You were tagged in "${postTitle}" on Kinectem.

Open the post to see it:
${postUrl}

If you'd rather not be tagged, you can remove the tag from the post page.`,
    html: `<p>You were tagged in <strong>${titleHtml}</strong> on Kinectem.</p>
<p>Open the post to see it:</p>
<p><a href="${postUrl}">${postUrl}</a></p>
<p>If you'd rather not be tagged, you can remove the tag from the post page.</p>`,
  });
}

export async function sendPasswordResetEmail(
  to: string,
  token: string,
): Promise<void> {
  const url = buildPasswordResetUrl(token);
  await sendEmail({
    to,
    kind: "password_reset",
    subject: "Reset your Kinectem password",
    text: `Someone asked to reset the password for your Kinectem account.

Open this link within the next hour to choose a new password:
${url}

If you didn't request this, you can ignore this email and your password will stay the same.`,
    html: `<p>Someone asked to reset the password for your Kinectem account.</p>
<p>Open this link within the next hour to choose a new password:</p>
<p><a href="${url}">${url}</a></p>
<p>If you didn't request this, you can ignore this email and your password will stay the same.</p>`,
  });
}

export async function sendGuardianConfirmationEmail(
  to: string,
  athleteName: string,
  token: string,
): Promise<void> {
  const url = buildGuardianConfirmUrl(token);
  await sendEmail({
    to,
    kind: "guardian_confirm",
    subject: `Confirm ${athleteName}'s Kinectem account`,
    text: `${athleteName} just signed up for Kinectem and listed you as their parent or guardian.

Because they are under 13, the account cannot be used until you confirm it. Open this link to confirm:
${url}

If you don't recognize this signup, you can ignore this email and the account will stay locked.`,
    html: `<p><strong>${escapeHtml(athleteName)}</strong> just signed up for Kinectem and listed you as their parent or guardian.</p>
<p>Because they are under 13, the account cannot be used until you confirm it. Open this link to confirm:</p>
<p><a href="${url}">${url}</a></p>
<p>If you don't recognize this signup, you can ignore this email and the account will stay locked.</p>`,
  });
}

// Task #359 — first email of the COPPA "email plus" verifiable parental
// consent flow. The link points at the consent landing page that shows
// the full COPPA notice and a checkbox the guardian must tick.
export async function sendParentalConsentNoticeEmail(
  to: string,
  athleteName: string,
  token: string,
): Promise<void> {
  const url = `${appBaseUrl()}/guardian-consent/${token}`;
  await sendEmail({
    to,
    kind: "parental_consent_notice",
    subject: `Action required: confirm consent for ${athleteName}'s Kinectem account`,
    text: `${athleteName} listed you as their parent or guardian when signing up for Kinectem.

Because they are under 13, federal law (COPPA) requires us to get your verifiable consent before we collect personal information from them.

Please open this link to read the full notice and grant consent:
${url}

After you submit consent, we'll email you ONE more time at this address with a "confirm" link. The account stays disabled until you click that second link — that two-step "email plus" pattern is how we verify the consent really came from you.

If you don't recognize this signup, ignore this email and the account will stay locked.`,
    html: `<p><strong>${escapeHtml(athleteName)}</strong> listed you as their parent or guardian when signing up for Kinectem.</p>
<p>Because they are under 13, federal law (COPPA) requires us to get your verifiable consent before we collect personal information from them.</p>
<p>Please open this link to read the full notice and grant consent:</p>
<p><a href="${url}">${url}</a></p>
<p>After you submit consent, we'll email you ONE more time at this address with a &quot;confirm&quot; link. The account stays disabled until you click that second link — that two-step &quot;email plus&quot; pattern is how we verify the consent really came from you.</p>
<p>If you don't recognize this signup, ignore this email and the account will stay locked.</p>`,
  });
}

// Task #359 — second email of the email-plus flow. Sent shortly after
// the guardian completes the notice + checkbox step.
export async function sendParentalConsentFollowupEmail(
  to: string,
  athleteName: string,
  token: string,
): Promise<void> {
  const url = `${appBaseUrl()}/guardian-consent/${token}/finalize`;
  await sendEmail({
    to,
    kind: "parental_consent_followup",
    subject: `Final step: finish enabling ${athleteName}'s Kinectem account`,
    text: `Thanks — we received your consent for ${athleteName}'s Kinectem account.

To finish (and to verify it really came from you), open this link:
${url}

The account will stay disabled until you click. The link is good for 7 days.

If you didn't grant consent, do nothing — without this second click the account will not be activated.`,
    html: `<p>Thanks — we received your consent for <strong>${escapeHtml(athleteName)}</strong>'s Kinectem account.</p>
<p>To finish (and to verify it really came from you), open this link:</p>
<p><a href="${url}">${url}</a></p>
<p>The account will stay disabled until you click. The link is good for 7 days.</p>
<p>If you didn't grant consent, do nothing — without this second click the account will not be activated.</p>`,
  });
}

// Task #359 — sent at finalization so the guardian always has a one-
// click revoke link they can keep in their inbox.
export async function sendParentalConsentFinalizedEmail(
  to: string,
  athleteName: string,
  revokeToken: string,
): Promise<void> {
  const revokeUrl = `${appBaseUrl()}/guardian-revoke/${revokeToken}`;
  await sendEmail({
    to,
    kind: "parental_consent_finalized",
    subject: `${athleteName}'s Kinectem account is now active`,
    text: `${athleteName}'s Kinectem account has been activated.

You can revoke consent at any time, which will immediately disable the account and stop any further data collection. Keep this link handy for that:
${revokeUrl}

You can also manage the account from your Family page after signing in to Kinectem.`,
    html: `<p><strong>${escapeHtml(athleteName)}</strong>'s Kinectem account has been activated.</p>
<p>You can revoke consent at any time, which will immediately disable the account and stop any further data collection. Keep this link handy for that:</p>
<p><a href="${revokeUrl}">${revokeUrl}</a></p>
<p>You can also manage the account from your Family page after signing in to Kinectem.</p>`,
  });
}

export function buildScheduleUrl(teamId: string): string {
  return `${appBaseUrl()}/teams/${teamId}`;
}

// Shared, already-formatted descriptor for the two schedule emails below.
// `whatLabel` and `whenText` are built by the caller (schedule-notifications)
// so the email layer stays free of DB / timezone logic.
export interface ScheduleEmailEvent {
  teamId: string;
  teamName: string | null;
  whatLabel: string;
  whenText: string;
  locationName: string | null;
}

// Phase 2 — the ~24h-before reminder. Reuses the same transactional sender.
// Body intentionally carries the location NAME only (never the full address).
export async function sendScheduleReminderEmail(
  to: string,
  ev: ScheduleEmailEvent,
): Promise<void> {
  const url = buildScheduleUrl(ev.teamId);
  const team = ev.teamName?.trim() ? ev.teamName.trim() : "your team";
  const teamHtml = escapeHtml(team);
  const whatHtml = escapeHtml(ev.whatLabel);
  const whenHtml = escapeHtml(ev.whenText);
  const locLine = ev.locationName?.trim()
    ? `\nWhere: ${ev.locationName.trim()}`
    : "";
  const locHtml = ev.locationName?.trim()
    ? `<p>Where: ${escapeHtml(ev.locationName.trim())}</p>`
    : "";
  await sendEmail({
    to,
    kind: "schedule_reminder",
    subject: `Reminder: ${ev.whatLabel} — ${ev.whenText}`,
    text: `A quick reminder about an upcoming ${team} event.

What: ${ev.whatLabel}
When: ${ev.whenText}${locLine}

See the full schedule:
${url}`,
    html: `<p>A quick reminder about an upcoming <strong>${teamHtml}</strong> event.</p>
<p>What: ${whatHtml}</p>
<p>When: ${whenHtml}</p>
${locHtml}
<p>See the full schedule:</p>
<p><a href="${url}">${url}</a></p>`,
  });
}

// Phase 2 — immediate change notice when a coach/admin cancels or postpones.
export async function sendScheduleChangeNoticeEmail(
  to: string,
  ev: ScheduleEmailEvent & {
    status: "canceled" | "postponed";
    reason: string | null;
  },
): Promise<void> {
  const url = buildScheduleUrl(ev.teamId);
  const team = ev.teamName?.trim() ? ev.teamName.trim() : "your team";
  const teamHtml = escapeHtml(team);
  const whatHtml = escapeHtml(ev.whatLabel);
  const whenHtml = escapeHtml(ev.whenText);
  const verb = ev.status === "canceled" ? "canceled" : "postponed";
  const locLine = ev.locationName?.trim()
    ? `\nWhere: ${ev.locationName.trim()}`
    : "";
  const locHtml = ev.locationName?.trim()
    ? `<p>Where: ${escapeHtml(ev.locationName.trim())}</p>`
    : "";
  const reasonLine = ev.reason?.trim() ? `\n\nReason: ${ev.reason.trim()}` : "";
  const reasonHtml = ev.reason?.trim()
    ? `<p><em>Reason: ${escapeHtml(ev.reason.trim())}</em></p>`
    : "";
  await sendEmail({
    to,
    kind: "schedule_change_notice",
    subject: `${ev.status === "canceled" ? "Canceled" : "Postponed"}: ${ev.whatLabel} — ${ev.whenText}`,
    text: `An upcoming ${team} event has been ${verb}.

What: ${ev.whatLabel}
When: ${ev.whenText}${locLine}${reasonLine}

See the full schedule:
${url}`,
    html: `<p>An upcoming <strong>${teamHtml}</strong> event has been <strong>${verb}</strong>.</p>
<p>What: ${whatHtml}</p>
<p>When: ${whenHtml}</p>
${locHtml}
${reasonHtml}
<p>See the full schedule:</p>
<p><a href="${url}">${url}</a></p>`,
  });
}

export async function sendGuardianExpiredEmail(
  to: string,
  athleteName: string,
): Promise<void> {
  const url = buildFamilyUrl();
  await sendEmail({
    to,
    kind: "guardian_expired",
    subject: `${athleteName}'s Kinectem confirmation link has expired`,
    text: `The guardian-confirmation link for ${athleteName}'s Kinectem account has expired before it was confirmed.

Open your Family page to send ${athleteName} a new link so they don't lose access:
${url}

If you no longer want to confirm this account, you can ignore this email and it will stay locked.`,
    html: `<p>The guardian-confirmation link for <strong>${escapeHtml(athleteName)}</strong>'s Kinectem account has expired before it was confirmed.</p>
<p>Open your Family page to send ${escapeHtml(athleteName)} a new link so they don't lose access:</p>
<p><a href="${url}">${url}</a></p>
<p>If you no longer want to confirm this account, you can ignore this email and it will stay locked.</p>`,
  });
}
