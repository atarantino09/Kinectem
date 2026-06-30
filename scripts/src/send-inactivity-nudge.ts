// Send a "we miss you" inactivity nudge to users who haven't signed in for a
// while, encouraging them to come back.
//
// Run from the repo root:
//   pnpm --filter @workspace/scripts run send-inactivity-nudge -- --dry-run
//   pnpm --filter @workspace/scripts run send-inactivity-nudge
//   pnpm --filter @workspace/scripts run send-inactivity-nudge -- --days=30
//
// "Inactive" = the user's most recent session (proxy for last sign-in) — or
// their signup date if they've never had a session — is older than --days
// (default 21). Only active, non-deleted accounts are considered.
//
// Scheduling: meant to run periodically (e.g. a weekly Replit Scheduled
// Deployment). NOT idempotent — re-running re-sends to everyone still inactive,
// so keep the cadence modest and always preview with --dry-run first.
//
// COPPA: an inactive minor's nudge is never sent to the minor — it routes to
// their linked guardian. The nudge is the `motivational` category, so disabling
// motivational emails (or master pause) suppresses it; every send carries an
// unsubscribe link. See lib/email-campaign.ts for the gate.

import { db, users, sessions } from "@workspace/db";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import {
  resolveCredentials,
  resolveRecipient,
  sendEmail,
  escapeHtml,
  firstName,
  appBaseUrl,
  wrapHtml,
  unsubscribeText,
  type ResolvedRecipient,
} from "./lib/email-campaign";

const DEFAULT_DAYS = 21;

function parseDays(): number {
  const arg = process.argv
    .slice(2)
    .find((a) => a.startsWith("--days="));
  if (!arg) return DEFAULT_DAYS;
  const n = Number(arg.slice("--days=".length));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_DAYS;
}

function buildNudge(recipient: ResolvedRecipient): {
  subject: string;
  text: string;
  html: string;
} {
  const greeting = firstName(recipient.recipientName);
  const url = `${appBaseUrl()}/app`;
  const subject = recipient.isGuardianCopy
    ? `${recipient.subjectName}'s team has been busy on Kinectem`
    : `We miss you on Kinectem`;

  const lead = recipient.isGuardianCopy
    ? `It's been a little while since ${escapeHtml(recipient.subjectName)}'s family checked in on Kinectem. Their teams have been posting recaps, photos, and updates.`
    : `It's been a little while since you stopped by Kinectem. Your teams have been posting recaps, photos, and updates — come see what you've missed.`;

  const text = `Hi ${greeting},

${lead.replace(/<[^>]+>/g, "")}

Jump back in: ${url}

— The Kinectem Team${unsubscribeText(recipient.unsubscribeUrl)}`;

  const bodyHtml = `<p>Hi ${escapeHtml(greeting)},</p>
<p>${lead}</p>
<p><a href="${escapeHtml(url)}">Jump back into Kinectem →</a></p>
<p>— The Kinectem Team</p>`;
  const html = wrapHtml(bodyHtml, recipient.unsubscribeUrl);

  return { subject, text, html };
}

async function main() {
  const dryRun = process.argv.slice(2).includes("--dry-run");
  const days = parseDays();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Last-activity proxy = max(session.created_at), falling back to the user's
  // signup date when they have never had a session. Only active, non-deleted
  // accounts with an email (or a guardian, resolved later) are candidates.
  const lastSession = db
    .select({
      userId: sessions.userId,
      lastAt: sql<Date>`max(${sessions.createdAt})`.as("last_at"),
    })
    .from(sessions)
    .groupBy(sessions.userId)
    .as("last_session");

  const candidates = await db
    .select({
      id: users.id,
      lastActiveAt: sql<Date>`coalesce(${lastSession.lastAt}, ${users.createdAt})`,
    })
    .from(users)
    .leftJoin(lastSession, eq(lastSession.userId, users.id))
    .where(
      and(
        eq(users.accountStatus, "active"),
        isNull(users.deletedAt),
        lt(
          sql`coalesce(${lastSession.lastAt}, ${users.createdAt})`,
          cutoff,
        ),
      ),
    );

  if (candidates.length === 0) {
    console.log(`No users inactive for ${days}+ days. Nothing to do.`);
    return;
  }

  const creds = dryRun ? null : await resolveCredentials();
  if (!dryRun && !creds) {
    console.error(
      "SendGrid is not configured (no connector and no SENDGRID_API_KEY/EMAIL_FROM). Aborting.",
    );
    process.exit(1);
  }

  let sent = 0;
  let suppressed = 0;
  const emailedThisRun = new Set<string>();

  for (const c of candidates) {
    const recipient = await resolveRecipient(c.id, "motivational");
    if (!recipient) {
      suppressed++;
      continue;
    }
    if (emailedThisRun.has(recipient.to)) continue;
    emailedThisRun.add(recipient.to);

    const email = buildNudge(recipient);
    if (dryRun) {
      console.log(
        `[dry-run] ${recipient.to}${recipient.isGuardianCopy ? " (guardian)" : ""} <- inactive since ${new Date(c.lastActiveAt).toISOString().slice(0, 10)}`,
      );
      sent++;
      continue;
    }
    try {
      await sendEmail(
        creds!,
        recipient.to,
        email.subject,
        email.text,
        email.html,
      );
      console.log(`Sent nudge to ${recipient.to}`);
      sent++;
    } catch (err) {
      console.error(`Failed to email ${recipient.to}:`, err);
      suppressed++;
    }
  }

  console.log(
    `${dryRun ? "[dry-run] " : ""}Done. ${sent} nudge(s) ${dryRun ? "would be " : ""}sent across ${candidates.length} inactive user(s); ${suppressed} suppressed/failed.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
