// Send the Daily Admin Digest — a summary of the previous day's Kinectem
// activity — to every enabled operator recipient (managed at
// /app/admin/daily-digest).
//
// Run from the repo root:
//   pnpm --filter @workspace/scripts run send-daily-admin-digest -- --dry-run
//   pnpm --filter @workspace/scripts run send-daily-admin-digest
//   pnpm --filter @workspace/scripts run send-daily-admin-digest -- --stdout
//   pnpm --filter @workspace/scripts run send-daily-admin-digest -- --day=2026-06-30
//
// Flags:
//   --dry-run   Build the digest and list who would be emailed; send nothing.
//   --stdout    Print the rendered text digest to stdout (implies no send).
//   --day=YYYY-MM-DD  Build the digest for a specific past day (default: yesterday).
//
// Scheduling: meant to run once every morning (a Replit Scheduled Deployment).
// A digest is sent even on a quiet day. Re-running the same day re-sends, so
// schedule it once per day. "Yesterday" is computed in ADMIN_DIGEST_TIME_ZONE
// (default UTC).
//
// COPPA: this digest goes to operator addresses, NOT app users, so there is no
// minor->guardian routing. The only COPPA concern is content — minor display
// names are masked by the shared builder.

import { db } from "@workspace/db";
import {
  buildDailyAdminDigest,
  getDigestWindow,
  getDigestWindowForDate,
  listActiveDigestRecipients,
  isDigestEnabled,
  DEFAULT_DIGEST_TIME_ZONE,
} from "@workspace/daily-admin-digest";
import { dailyAdminDigestRecipients } from "@workspace/db";
import { eq } from "drizzle-orm";
import { resolveCredentials, sendEmail, appBaseUrl } from "./lib/email-campaign";

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.slice(2).find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const toStdout = args.includes("--stdout");
  const day = parseArg("day");
  const timeZone = process.env.ADMIN_DIGEST_TIME_ZONE || DEFAULT_DIGEST_TIME_ZONE;

  const window = day
    ? getDigestWindowForDate(day, timeZone)
    : getDigestWindow(new Date(), timeZone);

  const digest = await buildDailyAdminDigest(db, {
    start: window.start,
    end: window.end,
    appBaseUrl: appBaseUrl(),
    label: window.label,
  });

  if (toStdout) {
    console.log(`Subject: ${digest.subject}\n`);
    console.log(digest.text);
    return;
  }

  // Global on/off switch, controlled by the admin toggle at
  // /app/admin/daily-digest. On by default. --stdout above always renders for
  // manual inspection; a real or dry run honors the switch.
  if (!(await isDigestEnabled(db))) {
    console.log(
      `${dryRun ? "[dry-run] " : ""}Daily digest is turned OFF in admin settings. Nothing sent.`,
    );
    return;
  }

  const recipients = await listActiveDigestRecipients(db);
  console.log(
    `Digest for ${window.label} (${timeZone}): ${digest.totalEvents} event(s). ${recipients.length} enabled recipient(s).`,
  );
  if (recipients.length === 0) {
    console.log("No enabled recipients. Nothing to send.");
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
  let failed = 0;
  for (const r of recipients) {
    if (dryRun) {
      console.log(`[dry-run] would email ${r.email}`);
      sent++;
      continue;
    }
    try {
      await sendEmail(
        creds!,
        r.email,
        digest.subject,
        digest.text,
        digest.html,
      );
      await db
        .update(dailyAdminDigestRecipients)
        .set({ lastSentAt: new Date() })
        .where(eq(dailyAdminDigestRecipients.id, r.id));
      console.log(`Sent digest to ${r.email}`);
      sent++;
    } catch (err) {
      console.error(`Failed to email ${r.email}:`, err);
      failed++;
    }
  }

  console.log(
    `${dryRun ? "[dry-run] " : ""}Done. ${sent} digest(s) ${dryRun ? "would be " : ""}sent; ${failed} failed.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
