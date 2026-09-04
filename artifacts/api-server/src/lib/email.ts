import {
  COACH_INVITE_SUBJECT,
  KINECTEM_INVITE_CONTEXT,
  buildCoachInviteText,
  buildCoachInviteHtml,
  staffInviteSubject,
  buildStaffInviteText,
  buildStaffInviteHtml,
  multiTeamStaffInviteSubject,
  buildMultiTeamStaffInviteText,
  buildMultiTeamStaffInviteHtml,
} from "@workspace/invite-copy";
import { db, emailProviderKeys } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";
import { decryptSecret } from "./secret-crypto.js";
import type { DispatchBuildContext } from "./notification-email.js";
import {
  plainTextToHtml,
  renderBrandedEmailHtml,
} from "@workspace/email-template";

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
  contextLabel?: string;
  // S12 — a non-PII event key (e.g. "guardian_confirm") used for log
  // triage. The subject itself can embed minor names / post titles, so it
  // must never be logged; this is logged instead.
  kind?: string;
  // Task #666 — SendGrid `custom_args` echoed back on every Event Webhook
  // event for this message. Used to correlate delivery events to the invite
  // row that triggered the send (keys must be non-PII identifiers only).
  customArgs?: Record<string, string>;
};

const SENDGRID_URL = "https://api.sendgrid.com/v3/mail/send";

// Admin-entered SendGrid credentials set from the admin Email settings UI.
// When a complete row exists (encrypted key + verified sender) it is the
// source of truth and takes precedence over the env vars / Replit connector.
// The key is stored encrypted at rest; we decrypt it fresh on every send.
async function resolveAdminCredentials(): Promise<{
  apiKey: string;
  from: string;
} | null> {
  try {
    const [row] = await db
      .select()
      .from(emailProviderKeys)
      .where(eq(emailProviderKeys.provider, "sendgrid"))
      .limit(1);
    if (!row?.keyCiphertext || !row.fromEmail) return null;
    const apiKey = decryptSecret(row.keyCiphertext);
    if (!apiKey) return null;
    return { apiKey, from: row.fromEmail };
  } catch (err) {
    // A decrypt failure (e.g. the encryption secret was rotated) or DB error
    // shouldn't brick email — fall through to the env / connector path.
    logger.warn(
      { err },
      "Failed to resolve admin-configured SendGrid credentials",
    );
    return null;
  }
}

// Resolve SendGrid credentials. Order of precedence:
//   1. Admin-entered credentials from the admin Email settings UI (DB), when
//      a complete row is present.
//   2. Plain env vars (local dev, CI, tests).
//   3. The Replit "sendgrid" connector.
// Per the connector docs the proxy-issued token can rotate, so we DO NOT
// cache — every send resolves fresh credentials.
async function resolveCredentials(): Promise<{
  apiKey: string;
  from: string;
} | null> {
  const admin = await resolveAdminCredentials();
  if (admin) return admin;

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
      {
        headers: { Accept: "application/json", "X-Replit-Token": xReplitToken },
      },
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
    logger.warn(
      { err },
      "Failed to fetch SendGrid credentials from Replit connector proxy",
    );
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

// Async, admin-aware variant. True if email can be sent via ANY source:
// admin-entered DB credentials, env vars, or the Replit connector. Use this in
// async pre-gates (e.g. article tag emails) so admin-only configuration isn't
// mistaken for "email disabled". A bare existence check is enough here — if the
// stored key later fails to decrypt, sendEmail() still falls back to env/connector.
export async function isEmailConfiguredAsync(): Promise<boolean> {
  if (isEmailConfigured()) return true;
  try {
    const [row] = await db
      .select({
        keyCiphertext: emailProviderKeys.keyCiphertext,
        fromEmail: emailProviderKeys.fromEmail,
      })
      .from(emailProviderKeys)
      .where(eq(emailProviderKeys.provider, "sendgrid"))
      .limit(1);
    return !!(row?.keyCiphertext && row.fromEmail);
  } catch {
    return false;
  }
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

  // Branding is enforced at the last mile so legacy and newly-added call
  // sites cannot accidentally send bare paragraphs. The plaintext alternative
  // remains exactly the caller's copy; text-only messages get a safe HTML
  // rendering rather than being omitted from the HTML MIME part.
  const bodyHtml = message.html ?? plainTextToHtml(message.text);
  const html = renderBrandedEmailHtml({
    bodyHtml,
    subject: message.subject,
    baseUrl: appBaseUrl(),
    contextLabel: message.contextLabel,
  });

  const body = {
    personalizations: [
      {
        to: [{ email: message.to }],
        // Task #666 — per-personalization custom_args ride back on each
        // SendGrid Event Webhook event so we can match it to its invite.
        ...(message.customArgs ? { custom_args: message.customArgs } : {}),
      },
    ],
    from: { email: creds.from },
    subject: message.subject,
    content: [
      { type: "text/plain", value: message.text },
      { type: "text/html", value: html },
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

// Task #759 — outside production, prefer the Replit dev domain over
// APP_BASE_URL. The secret is set globally (it applies to dev too), so
// without this override dev-sent emails link to production, where the
// per-environment reset tokens are invalid. Production behavior is
// unchanged: APP_BASE_URL wins there.
let warnedAppBaseUrlIgnored = false;

export function appBaseUrl(): string {
  const devDomain = process.env.REPLIT_DEV_DOMAIN;
  if (process.env.NODE_ENV !== "production" && devDomain) {
    if (process.env.APP_BASE_URL && !warnedAppBaseUrlIgnored) {
      warnedAppBaseUrlIgnored = true;
      logger.warn(
        { devDomain },
        "Ignoring APP_BASE_URL in development; email links will use the Replit dev domain",
      );
    }
    return `https://${devDomain}`.replace(/\/+$/, "");
  }
  return (process.env.APP_BASE_URL ?? "http://localhost:5173").replace(
    /\/+$/,
    "",
  );
}

export function buildOrgClaimApprovedEmail(input: {
  to: string;
  organizationId: string;
  organizationName: string;
}): EmailMessage {
  const setupUrl = `${appBaseUrl()}/app/organizations/${input.organizationId}?ownerSetup=1`;
  return {
    to: input.to,
    subject: `You're now the owner of ${input.organizationName} on Kinectem`,
    contextLabel: input.organizationName,
    kind: "org_claim_approved",
    text: [
      `Your organization claim for ${input.organizationName} has been approved.`,
      "",
      `You are now the owner of the ${input.organizationName} page on Kinectem. You can update the page, add teams, invite coaches, and bring players and parents into the right rosters.`,
      "",
      "Finish setting up your organization:",
      setupUrl,
      "",
      "Kinectem will guide you through the recommended launch order:",
      "1. Review and share the pre-invite message with your club.",
      "2. Bulk add coaches across your teams.",
      "3. Add players and parents through Roster outreach using each team's secure invitation.",
      "",
      "Your organization setup checklist and page tour will remain available on the organization page if you want to return to any step later.",
    ].join("\n"),
  };
}

export function buildOrgOwnerInvitationEmail(input: {
  to: string;
  organizationName: string;
  claimToken: string;
}): EmailMessage {
  const claimUrl = `${appBaseUrl()}/app/org-claim-links/${input.claimToken}`;
  return {
    to: input.to,
    subject: `Become the owner of ${input.organizationName} on Kinectem`,
    contextLabel: input.organizationName,
    kind: "org_owner_invitation",
    text: [
      `You've been invited to become the owner of ${input.organizationName} on Kinectem.`,
      "",
      "Kinectem is the youth-sports platform where the story of your season comes to life. It turns quick coach notes into polished game recaps, builds lasting player histories, and gives every team one recognizable home without replacing the registration, scheduling, or communication tools your club already uses.",
      "",
      "Use this secure link to claim your organization:",
      claimUrl,
      "",
      "How to finish setting up your organization:",
      "1. Open the link and sign in or create your Kinectem profile.",
      `2. Confirm that you want to become the owner of ${input.organizationName}.`,
      "3. Review and share the pre-invite message with your club.",
      "4. Bulk add coaches across your teams.",
      "5. Add players and parents through Roster outreach using each team's secure invitation.",
      "6. Complete any remaining items in the organization setup checklist.",
      "",
      "This link is a private invitation. Please do not forward it. It stops working after the organization has an owner.",
    ].join("\n"),
  };
}

export function buildPasswordResetUrl(token: string): string {
  return `${appBaseUrl()}/app/reset-password/${token}`;
}

export function buildGuardianConfirmUrl(token: string): string {
  return `${appBaseUrl()}/app/guardian-confirm/${token}`;
}

export function buildFamilyUrl(): string {
  return `${appBaseUrl()}/app/family`;
}

// Task #541 — accept-landing URL for the organization invite token.
export function buildOrganizationInviteUrl(token: string): string {
  return `${appBaseUrl()}/app/org-invites/${token}`;
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
    // Task #666 — invite id for SendGrid delivery-event correlation.
    inviteId?: string;
  },
): Promise<void> {
  const { organizationName, inviterDisplayName, role, token, note, inviteId } =
    args;
  const url = buildOrganizationInviteUrl(token);
  const roleLabel = role === "admin" ? "an admin" : "a member";
  // S5 — escape user-controlled values for the HTML body.
  const orgHtml = escapeHtml(organizationName);
  const inviterHtml = escapeHtml(inviterDisplayName);
  const notePlain =
    note && note.trim()
      ? `\n\nNote from ${inviterDisplayName}:\n${note.trim()}\n`
      : "";
  const noteHtml =
    note && note.trim()
      ? `<p><em>Note from ${inviterHtml}:</em></p><blockquote>${escapeHtml(note.trim()).replace(/\n/g, "<br/>")}</blockquote>`
      : "";
  await sendEmail({
    to,
    kind: "organization_invite",
    contextLabel: organizationName,
    ...(inviteId
      ? {
          customArgs: {
            kinectem_invite_id: inviteId,
            kinectem_invite_kind: "org",
          },
        }
      : {}),
    subject: `${inviterDisplayName} invited you to join ${organizationName} on Kinectem`,
    text: `${inviterDisplayName} invited you to join ${organizationName} on Kinectem as ${roleLabel}.

${KINECTEM_INVITE_CONTEXT}
${notePlain}
Open this link to accept:
${url}

If you don't have a Kinectem account yet, you can sign up from the same link.`,
    html: `<p><strong>${inviterHtml}</strong> invited you to join <strong>${orgHtml}</strong> on Kinectem as ${roleLabel}.</p>
<p>${escapeHtml(KINECTEM_INVITE_CONTEXT)}</p>
${noteHtml}
<p>Open this link to accept:</p>
<p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>
<p>If you don't have a Kinectem account yet, you can sign up from the same link.</p>`,
  });
}

// Task #745 — accept-landing URL for a hub/competition admin invite token.
export function buildCompetitionAdminInviteUrl(token: string): string {
  return `${appBaseUrl()}/app/admin-invites/${token}`;
}

// Task #745 — Sent when a hub/competition owner or admin invites someone (by
// email) to become an admin of their hub or competition. The link lands on
// the in-app accept page; recipients sign in or sign up first if needed.
export async function sendCompetitionAdminInviteEmail(
  to: string,
  args: {
    targetName: string;
    targetKind: "hub" | "competition";
    inviterDisplayName: string;
    token: string;
  },
): Promise<void> {
  const { targetName, targetKind, inviterDisplayName, token } = args;
  const url = buildCompetitionAdminInviteUrl(token);
  const kindLabel = targetKind === "hub" ? "competition hub" : "competition";
  // S5 — escape user-controlled values for the HTML body.
  const nameHtml = escapeHtml(targetName);
  const inviterHtml = escapeHtml(inviterDisplayName);
  await sendEmail({
    to,
    kind: "competition_admin_invite",
    contextLabel: targetName,
    subject: `${inviterDisplayName} invited you to help run ${targetName} on Kinectem`,
    text: `${inviterDisplayName} invited you to be an admin of the ${kindLabel} ${targetName} on Kinectem.

${KINECTEM_INVITE_CONTEXT}

Open this link to accept:
${url}

If you don't have a Kinectem account yet, you can sign up from the same link.`,
    html: `<p><strong>${inviterHtml}</strong> invited you to be an admin of the ${kindLabel} <strong>${nameHtml}</strong> on Kinectem.</p>
<p>${escapeHtml(KINECTEM_INVITE_CONTEXT)}</p>
<p>Open this link to accept:</p>
<p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>
<p>If you don't have a Kinectem account yet, you can sign up from the same link.</p>`,
  });
}

// Task #634 — accept-landing URL for a roster invite token. The main web app
// is served under the `/app/` base path (mirrors the in-app share link
// `${origin}${import.meta.env.BASE_URL}invites/<token>`), so the link must
// include that prefix or it would resolve to the marketing root instead.
export function buildInviteAcceptUrl(token: string): string {
  return `${appBaseUrl()}/app/invites/${token}`;
}

// Task #634 — the coach's "join Kinectem" invite email. Sent when a coach
// invites a player by email and no Kinectem account exists for that address
// yet. The wording is the finalized copy from `@workspace/invite-copy` (shared
// verbatim with the in-app copy block); only the coach name and the accept
// link are substituted. The link lands on the `/invites/:token` flow where the
// parent sets up and manages the child's account.
export async function sendCoachInviteEmail(
  to: string,
  args: { coachName: string; token: string; inviteId?: string },
): Promise<void> {
  const link = buildInviteAcceptUrl(args.token);
  await sendEmail({
    to,
    kind: "coach_invite",
    ...(args.inviteId
      ? {
          customArgs: {
            kinectem_invite_id: args.inviteId,
            kinectem_invite_kind: "roster",
          },
        }
      : {}),
    subject: COACH_INVITE_SUBJECT,
    text: buildCoachInviteText({ coachName: args.coachName, link }),
    html: buildCoachInviteHtml({ coachName: args.coachName, link }),
  });
}

// Task #837 — staff variant of the roster invite email. Sent instead of the
// parent-oriented coach invite when the invitee is being brought on as team
// staff (coach, assistant coach, or manager) and no Kinectem account exists
// for the address yet. Wording is the shared staff copy from
// `@workspace/invite-copy` (lockstep with the in-app copy block); the team
// name, role label, inviter name, and accept link are substituted. Delivery
// tracking (customArgs) mirrors sendCoachInviteEmail exactly.
export async function sendStaffInviteEmail(
  to: string,
  args: {
    inviterName: string;
    teamName: string;
    roleLabel: string;
    token: string;
    inviteId?: string;
  },
): Promise<void> {
  const link = buildInviteAcceptUrl(args.token);
  const vars = {
    inviterName: args.inviterName,
    teamName: args.teamName,
    roleLabel: args.roleLabel,
    link,
  };
  await sendEmail({
    to,
    kind: "staff_invite",
    contextLabel: args.teamName,
    ...(args.inviteId
      ? {
          customArgs: {
            kinectem_invite_id: args.inviteId,
            kinectem_invite_kind: "roster",
          },
        }
      : {}),
    subject: staffInviteSubject(args.teamName),
    text: buildStaffInviteText(vars),
    html: buildStaffInviteHtml(vars),
  });
}

export async function sendMultiTeamStaffInviteEmail(
  to: string,
  args: {
    inviterName: string;
    organizationName: string;
    teamNames: readonly string[];
    roleLabel: string;
    token: string;
    groupId?: string;
  },
): Promise<void> {
  const link = buildInviteAcceptUrl(args.token);
  const vars = {
    inviterName: args.inviterName,
    organizationName: args.organizationName,
    teamNames: args.teamNames,
    roleLabel: args.roleLabel,
    link,
  };
  await sendEmail({
    to,
    kind: "staff_invite_group",
    contextLabel: args.organizationName,
    ...(args.groupId
      ? {
          customArgs: {
            kinectem_invite_id: args.groupId,
            kinectem_invite_kind: "roster_group",
          },
        }
      : {}),
    subject: multiTeamStaffInviteSubject(args.organizationName),
    text: buildMultiTeamStaffInviteText(vars),
    html: buildMultiTeamStaffInviteHtml(vars),
  });
}
export function buildPostUrl(link: string): string {
  // Callers store post links as relative paths (e.g. "/posts/article-…").
  // Stitch them onto the configured app base url so the email lands users
  // on the same page the bell row would. The web app is served under the
  // "/app" prefix, so relative routes MUST be prefixed with "/app" or the
  // proxy falls through to the marketing site (a bare "/posts/…" is not an
  // app route). Guard against double-prefixing if a caller already did it.
  const path = link.startsWith("/") ? link : `/${link}`;
  const appPath =
    path === "/app" || path.startsWith("/app/") ? path : `/app${path}`;
  return `${appBaseUrl()}${appPath}`;
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
<p><a href="${escapeHtml(postUrl)}">${escapeHtml(postUrl)}</a></p>
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
<p><a href="${escapeHtml(postUrl)}">${escapeHtml(postUrl)}</a></p>
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
<p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>
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
<p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>
<p>If you don't recognize this signup, you can ignore this email and the account will stay locked.</p>`,
  });
}

// Task #755 — sent when a parent (or the child / an admin) invites a second
// parent or legal guardian to link with a child's account. The link lands on
// the Family dashboard where the pending invite can be accepted or declined
// (sign in — or sign up with this email address — first if needed).
export async function sendGuardianLinkInviteEmail(
  to: string,
  args: {
    childName: string;
    inviterName: string;
    relationshipType: "parent" | "legal_guardian";
  },
): Promise<void> {
  const url = buildFamilyUrl();
  const roleLabel =
    args.relationshipType === "legal_guardian" ? "legal guardian" : "parent";
  await sendEmail({
    to,
    kind: "guardian_link_invite",
    subject: `${args.inviterName} invited you to be ${args.childName}'s ${roleLabel} on Kinectem`,
    text: `${args.inviterName} invited you to join Kinectem as ${args.childName}'s ${roleLabel}.

${KINECTEM_INVITE_CONTEXT}

Once you accept, you'll see ${args.childName} on your Family dashboard, follow their teams automatically, and receive updates about their activity.

To accept or decline, open your Family dashboard:
${url}

If you don't have a Kinectem account yet, sign up using this email address (${to}) and the invitation will be waiting for you.

If you don't recognize this invitation, you can ignore this email or decline it in the app.`,
    html: `<p><strong>${escapeHtml(args.inviterName)}</strong> invited you to join Kinectem as <strong>${escapeHtml(args.childName)}</strong>'s ${roleLabel}.</p>
<p>${escapeHtml(KINECTEM_INVITE_CONTEXT)}</p>
<p>Once you accept, you'll see ${escapeHtml(args.childName)} on your Family dashboard, follow their teams automatically, and receive updates about their activity.</p>
<p>To accept or decline, open your Family dashboard:</p>
<p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>
<p>If you don't have a Kinectem account yet, sign up using this email address (${escapeHtml(to)}) and the invitation will be waiting for you.</p>
<p>If you don't recognize this invitation, you can ignore this email or decline it in the app.</p>`,
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
  const url = `${appBaseUrl()}/app/guardian-consent/${token}`;
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
<p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>
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
  const url = `${appBaseUrl()}/app/guardian-consent/${token}/finalize`;
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
<p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>
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
  const revokeUrl = `${appBaseUrl()}/app/guardian-revoke/${revokeToken}`;
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
<p><a href="${escapeHtml(revokeUrl)}">${escapeHtml(revokeUrl)}</a></p>
<p>You can also manage the account from your Family page after signing in to Kinectem.</p>`,
  });
}

export function buildScheduleUrl(teamId: string): string {
  return `${appBaseUrl()}/app/teams/${teamId}`;
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

// Shared body for schedule reminders. Returns the subject + text/html parts so
// both the transactional sender and the gate-friendly builder stay identical.
// Body intentionally carries the location NAME only (never the full address).
function buildScheduleReminderBody(ev: ScheduleEmailEvent): {
  subject: string;
  text: string;
  html: string;
} {
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
  return {
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
<p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>`,
  };
}

// Shared body for schedule change notices (cancel / postpone).
function buildScheduleChangeBody(
  ev: ScheduleEmailEvent & {
    status: "canceled" | "postponed";
    reason: string | null;
  },
): { subject: string; text: string; html: string } {
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
  return {
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
<p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>`,
  };
}

// Phase 2 — the ~24h-before reminder. Reuses the same transactional sender.
export async function sendScheduleReminderEmail(
  to: string,
  ev: ScheduleEmailEvent,
): Promise<void> {
  const base = buildScheduleReminderBody(ev);
  await sendEmail({
    to,
    kind: "schedule_reminder",
    contextLabel: ev.teamName ?? undefined,
    subject: base.subject,
    text: base.text,
    html: base.html,
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
  const base = buildScheduleChangeBody(ev);
  await sendEmail({
    to,
    kind: "schedule_change_notice",
    contextLabel: ev.teamName ?? undefined,
    subject: base.subject,
    text: base.text,
    html: base.html,
  });
}

// ---------------------------------------------------------------------------
// Task #633 — Gated notification email builders.
//
// These return an `EmailMessage` (rather than sending) so the central
// COPPA-aware dispatch gate (`notification-email.ts`) can resolve the
// recipient (minor -> guardian), check preferences, and then send. Every
// builder appends a one-click unsubscribe + "manage preferences" footer using
// the gate-provided `ctx.unsubscribeUrl`. User-controlled values are escaped.
// ---------------------------------------------------------------------------

function settingsUrl(): string {
  return `${appBaseUrl()}/app/settings`;
}

function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] || "there";
}

// "your" for an adult recipient, "<child>'s" when routed to a guardian.
function subjectPossessive(ctx: DispatchBuildContext): string {
  return ctx.isGuardianCopy ? `${ctx.subjectName}'s` : "your";
}
function subjectPossessiveHtml(ctx: DispatchBuildContext): string {
  return ctx.isGuardianCopy ? `${escapeHtml(ctx.subjectName)}'s` : "your";
}

function manageFooter(ctx: DispatchBuildContext): {
  text: string;
  html: string;
} {
  const settings = settingsUrl();
  return {
    text: `\n\n—\nManage your email preferences: ${settings}\nUnsubscribe from these emails: ${ctx.unsubscribeUrl}`,
    html: `<hr style="margin-top:24px;border:none;border-top:1px solid #eee"/><p style="font-size:12px;color:#888;">Manage your email preferences in <a href="${escapeHtml(settings)}">Settings</a> &middot; <a href="${escapeHtml(ctx.unsubscribeUrl)}">Unsubscribe</a></p>`,
  };
}

// Welcome email on signup (motivational; adults only — minors are covered by
// the guardian consent flow, so the signup hook does not call the gate for a
// minor account).
export function buildWelcomeEmail(ctx: DispatchBuildContext): EmailMessage {
  const url = appBaseUrl();
  const foot = manageFooter(ctx);
  const hi = escapeHtml(firstNameOf(ctx.recipientName));
  return {
    to: ctx.to,
    kind: "welcome",
    subject: "Welcome to Kinectem!",
    text: `Hi ${firstNameOf(ctx.recipientName)},

Welcome to Kinectem — the home for your team's recaps, highlights, schedules, and updates.

A few things to try first:
- Follow your team to see new recaps and highlights in your feed
- Complete your profile so teammates can find you
- Check your team's schedule so you never miss a game

Jump in here:
${url}

We're glad you're here.
— The Kinectem Team${foot.text}`,
    html: `<p>Hi ${hi},</p>
<p>Welcome to <strong>Kinectem</strong> — the home for your team's recaps, highlights, schedules, and updates.</p>
<p>A few things to try first:</p>
<ul>
<li>Follow your team to see new recaps and highlights in your feed</li>
<li>Complete your profile so teammates can find you</li>
<li>Check your team's schedule so you never miss a game</li>
</ul>
<p><a href="${escapeHtml(url)}">Jump in →</a></p>
<p>We're glad you're here.<br/>— The Kinectem Team</p>${foot.html}`,
  };
}

// Milestone — the author's first published recap (motivational).
export function buildFirstRecapMilestoneEmail(
  ctx: DispatchBuildContext,
  args: { recapTitle: string; recapUrl: string },
): EmailMessage {
  const foot = manageFooter(ctx);
  const titleHtml = escapeHtml(args.recapTitle);
  // Sentence-leading possessive ("Your" / "<Child>'s") for the subject line.
  const whoseCap = ctx.isGuardianCopy ? `${ctx.subjectName}'s` : "Your";
  // Mid-sentence possessive ("your" / "<Child>'s").
  const whose = subjectPossessive(ctx);
  const whoseHtml = subjectPossessiveHtml(ctx);
  return {
    to: ctx.to,
    kind: "milestone_first_recap",
    subject: `${whoseCap} first recap is live`,
    text: `Congratulations — ${whose} first recap is published on Kinectem!

"${args.recapTitle}"

See it here:
${args.recapUrl}${ALBUM_INVITE_TEXT}

Keep them coming — every recap helps families relive the season.
— The Kinectem Team${foot.text}`,
    html: `<p>Congratulations — ${whoseHtml} first recap is published on Kinectem!</p>
<p><strong>${titleHtml}</strong></p>
<p><a href="${escapeHtml(args.recapUrl)}">See it →</a></p>${ALBUM_INVITE_HTML}
<p>Keep them coming — every recap helps families relive the season.<br/>— The Kinectem Team</p>${foot.html}`,
  };
}

// Social — someone followed the user (or requested to).
export function buildFollowEmail(
  ctx: DispatchBuildContext,
  args: { actorName: string; profileUrl: string; requested: boolean },
): EmailMessage {
  const foot = manageFooter(ctx);
  const actorHtml = escapeHtml(args.actorName);
  const whose = subjectPossessive(ctx);
  const whoseHtml = subjectPossessiveHtml(ctx);
  const verb = args.requested ? "requested to follow" : "started following";
  return {
    to: ctx.to,
    kind: "social_follow",
    subject: args.requested
      ? `${args.actorName} requested to follow ${whose} profile`
      : `${args.actorName} started following ${whose} profile`,
    text: `${args.actorName} ${verb} ${whose} Kinectem profile.

${args.requested ? "Review the request:" : "See their profile:"}
${args.profileUrl}${foot.text}`,
    html: `<p><strong>${actorHtml}</strong> ${verb} ${whoseHtml} Kinectem profile.</p>
<p><a href="${escapeHtml(args.profileUrl)}">${args.requested ? "Review the request" : "See their profile"} →</a></p>${foot.html}`,
  };
}

// Social — comment or reply on a post.
export function buildCommentEmail(
  ctx: DispatchBuildContext,
  args: { actorName: string; postUrl: string; isReply: boolean },
): EmailMessage {
  const foot = manageFooter(ctx);
  const actorHtml = escapeHtml(args.actorName);
  const what = args.isReply
    ? `replied to ${subjectPossessive(ctx)} comment`
    : `commented on ${subjectPossessive(ctx)} post`;
  const whatHtml = args.isReply
    ? `replied to ${subjectPossessiveHtml(ctx)} comment`
    : `commented on ${subjectPossessiveHtml(ctx)} post`;
  return {
    to: ctx.to,
    kind: "social_comment",
    subject: `${args.actorName} ${args.isReply ? "replied to" : "commented on"} ${subjectPossessive(ctx)} ${args.isReply ? "comment" : "post"}`,
    text: `${args.actorName} ${what} on Kinectem.

See it:
${args.postUrl}${foot.text}`,
    html: `<p><strong>${actorHtml}</strong> ${whatHtml} on Kinectem.</p>
<p><a href="${escapeHtml(args.postUrl)}">See it →</a></p>${foot.html}`,
  };
}

// Social — someone liked a post.
export function buildReactionEmail(
  ctx: DispatchBuildContext,
  args: { actorName: string; postUrl: string },
): EmailMessage {
  const foot = manageFooter(ctx);
  const actorHtml = escapeHtml(args.actorName);
  return {
    to: ctx.to,
    kind: "social_reaction",
    subject: `${args.actorName} liked ${subjectPossessive(ctx)} post`,
    text: `${args.actorName} liked ${subjectPossessive(ctx)} post on Kinectem.

See it:
${args.postUrl}${foot.text}`,
    html: `<p><strong>${actorHtml}</strong> liked ${subjectPossessiveHtml(ctx)} post on Kinectem.</p>
<p><a href="${escapeHtml(args.postUrl)}">See it →</a></p>${foot.html}`,
  };
}

// Task #828 / #943 — one-line invitation to contribute media to a recap's fan
// album. Only attached to RECAP emails: parents of active roster athletes
// (and roster members themselves) have album upload rights on team recap
// posts (`canContributeToAlbum` in routes/album.ts), and the album lives
// on the same post page the email already links to.
const ALBUM_INVITE_TEXT =
  "\n\nHave photos or videos from the game? You can add them to the recap's photo-and-video album on the same page.";
const ALBUM_INVITE_HTML =
  "\n<p>Have photos or videos from the game? You can add them to the recap's photo-and-video album on the same page.</p>";

// Social — the user was tagged in a published recap/highlight.
export function buildTagEmail(
  ctx: DispatchBuildContext,
  args: { postTitle: string; postUrl: string; isRecap?: boolean },
): EmailMessage {
  const foot = manageFooter(ctx);
  const titleHtml = escapeHtml(args.postTitle);
  const who = ctx.isGuardianCopy ? ctx.subjectName : "You";
  const whoHtml = ctx.isGuardianCopy ? escapeHtml(ctx.subjectName) : "You";
  const wasWere = ctx.isGuardianCopy ? "was" : "were";
  const albumText = args.isRecap ? ALBUM_INVITE_TEXT : "";
  const albumHtml = args.isRecap ? ALBUM_INVITE_HTML : "";
  return {
    to: ctx.to,
    kind: "social_tag",
    subject: `${who} ${wasWere} tagged in "${args.postTitle}"`,
    text: `${who} ${wasWere} tagged in "${args.postTitle}" on Kinectem.

Open the post:
${args.postUrl}${albumText}${foot.text}`,
    html: `<p>${whoHtml} ${wasWere} tagged in <strong>${titleHtml}</strong> on Kinectem.</p>
<p><a href="${escapeHtml(args.postUrl)}">Open the post →</a></p>${albumHtml}${foot.html}`,
  };
}

// Team update — new published team content (recap / highlight / org post).
export function buildTeamContentEmail(
  ctx: DispatchBuildContext,
  args: {
    teamName: string | null;
    actorName: string;
    title: string;
    postUrl: string;
    contentLabel: string; // "recap" | "highlight" | "post"
  },
): EmailMessage {
  const foot = manageFooter(ctx);
  const team = args.teamName?.trim() ? args.teamName.trim() : "your team";
  const teamHtml = escapeHtml(team);
  const titleHtml = escapeHtml(args.title);
  const actorHtml = escapeHtml(args.actorName);
  // Task #828 / #943 — recaps carry a fan media album; invite the team
  // community (incl. parents of active roster athletes) to contribute.
  const albumText = args.contentLabel === "recap" ? ALBUM_INVITE_TEXT : "";
  const albumHtml = args.contentLabel === "recap" ? ALBUM_INVITE_HTML : "";
  return {
    to: ctx.to,
    kind: "team_recap",
    contextLabel: team,
    subject: `New ${args.contentLabel} for ${team}: "${args.title}"`,
    text: `${args.actorName} posted a new ${args.contentLabel} for ${team} on Kinectem.

"${args.title}"

See it:
${args.postUrl}${albumText}${foot.text}`,
    html: `<p><strong>${actorHtml}</strong> posted a new ${escapeHtml(args.contentLabel)} for <strong>${teamHtml}</strong> on Kinectem.</p>
<p><strong>${titleHtml}</strong></p>
<p><a href="${escapeHtml(args.postUrl)}">See it →</a></p>${albumHtml}${foot.html}`,
  };
}

// Team update — roster change (invite, join request, role change). The caller
// supplies the already-composed message line so this stays generic.
export function buildRosterEmail(
  ctx: DispatchBuildContext,
  args: { message: string; link: string; subject: string },
): EmailMessage {
  const foot = manageFooter(ctx);
  return {
    to: ctx.to,
    kind: "team_roster",
    subject: args.subject,
    text: `${args.message}

Open Kinectem:
${args.link}${foot.text}`,
    html: `<p>${escapeHtml(args.message)}</p>
<p><a href="${escapeHtml(args.link)}">Open Kinectem →</a></p>${foot.html}`,
  };
}

// Team update — a broadcast/announcement to the team or organization.
export function buildBroadcastEmail(
  ctx: DispatchBuildContext,
  args: {
    senderName: string;
    scopeName: string | null;
    preview: string;
    link: string;
  },
): EmailMessage {
  const foot = manageFooter(ctx);
  const scope = args.scopeName?.trim() ? args.scopeName.trim() : "your team";
  const scopeHtml = escapeHtml(scope);
  const senderHtml = escapeHtml(args.senderName);
  const previewHtml = escapeHtml(args.preview);
  return {
    to: ctx.to,
    kind: "team_broadcast",
    contextLabel: scope,
    subject: `New announcement for ${scope}`,
    text: `${args.senderName} posted an announcement for ${scope} on Kinectem:

"${args.preview}"

Read it:
${args.link}${foot.text}`,
    html: `<p><strong>${senderHtml}</strong> posted an announcement for <strong>${scopeHtml}</strong> on Kinectem:</p>
<blockquote>${previewHtml}</blockquote>
<p><a href="${escapeHtml(args.link)}">Read it →</a></p>${foot.html}`,
  };
}

// Reminder — game finished, recap not yet written (game_recap_reminder).
export function buildGameRecapReminderEmail(
  ctx: DispatchBuildContext,
  args: { teamName: string | null; opponent: string | null; teamUrl: string },
): EmailMessage {
  const foot = manageFooter(ctx);
  const team = args.teamName?.trim() ? args.teamName.trim() : "your team";
  const teamHtml = escapeHtml(team);
  const opp = args.opponent?.trim() ? ` vs ${args.opponent.trim()}` : "";
  const oppHtml = args.opponent?.trim()
    ? ` vs ${escapeHtml(args.opponent.trim())}`
    : "";
  return {
    to: ctx.to,
    kind: "reminder_game_recap",
    contextLabel: team,
    subject: `Don't forget to write the recap for ${team}`,
    text: `${team}'s game${opp} has wrapped up — don't forget to write the game recap while it's fresh.

Write it here:
${args.teamUrl}${foot.text}`,
    html: `<p><strong>${teamHtml}</strong>'s game${oppHtml} has wrapped up — don't forget to write the game recap while it's fresh.</p>
<p><a href="${escapeHtml(args.teamUrl)}">Write it →</a></p>${foot.html}`,
  };
}

// Reminder — schedule reminder, gate-friendly variant (carries unsubscribe).
export function buildScheduleReminderMessage(
  ctx: DispatchBuildContext,
  ev: ScheduleEmailEvent,
): EmailMessage {
  const base = buildScheduleReminderBody(ev);
  const foot = manageFooter(ctx);
  return {
    to: ctx.to,
    kind: "schedule_reminder",
    contextLabel: ev.teamName ?? undefined,
    subject: base.subject,
    text: base.text + foot.text,
    html: base.html + foot.html,
  };
}

// Reminder — schedule change notice, gate-friendly variant.
export function buildScheduleChangeMessage(
  ctx: DispatchBuildContext,
  ev: ScheduleEmailEvent & {
    status: "canceled" | "postponed";
    reason: string | null;
  },
): EmailMessage {
  const base = buildScheduleChangeBody(ev);
  const foot = manageFooter(ctx);
  return {
    to: ctx.to,
    kind: "schedule_change_notice",
    contextLabel: ev.teamName ?? undefined,
    subject: base.subject,
    text: base.text + foot.text,
    html: base.html + foot.html,
  };
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
<p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>
<p>If you no longer want to confirm this account, you can ignore this email and it will stay locked.</p>`,
  });
}
