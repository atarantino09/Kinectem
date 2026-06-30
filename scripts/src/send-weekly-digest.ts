// Send the weekly team-activity digest to every follower whose teams had
// activity (new recaps or announcements) in the past 7 days.
//
// Run from the repo root:
//   pnpm --filter @workspace/scripts run send-weekly-digest -- --dry-run
//   pnpm --filter @workspace/scripts run send-weekly-digest
//
// Scheduling: meant to run once a week (e.g. a Replit Scheduled Deployment
// every Monday morning). Idempotent within a window in practice — re-running
// the same day re-sends, so schedule it once per week. Always preview with
// --dry-run first.
//
// COPPA: a minor's digest is never sent to the minor — it routes to their
// linked guardian (and guardians already auto-follow their child's teams, so
// the guardian's own digest covers those teams). Each enabled recipient gets a
// working unsubscribe link. See lib/email-campaign.ts for the gate.

import {
  db,
  teamFollowers,
  teams,
  articles,
  broadcasts,
} from "@workspace/db";
import { and, eq, gte, inArray, desc } from "drizzle-orm";
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

const WINDOW_DAYS = 7;

interface TeamActivity {
  teamName: string;
  recapTitles: string[];
  recapCount: number;
  announcementCount: number;
}

function buildDigest(args: {
  recipient: ResolvedRecipient;
  activity: TeamActivity[];
}): { subject: string; text: string; html: string } {
  const { recipient, activity } = args;
  const greeting = firstName(recipient.recipientName);
  const totalRecaps = activity.reduce((n, a) => n + a.recapCount, 0);
  const totalAnnouncements = activity.reduce(
    (n, a) => n + a.announcementCount,
    0,
  );
  const feedUrl = `${appBaseUrl()}/app`;

  const subject =
    totalRecaps > 0
      ? `This week on Kinectem: ${totalRecaps} new recap${totalRecaps === 1 ? "" : "s"} from your teams`
      : `This week's updates from your Kinectem teams`;

  const intro = recipient.isGuardianCopy
    ? `Here's what happened this week with the teams ${escapeHtml(recipient.recipientName)}'s family follows.`
    : `Here's what happened this week with the teams you follow.`;

  // Plain text
  const textLines: string[] = [`Hi ${greeting},`, "", intro.replace(/<[^>]+>/g, ""), ""];
  for (const a of activity) {
    textLines.push(`• ${a.teamName}`);
    for (const t of a.recapTitles) textLines.push(`    - New recap: ${t}`);
    if (a.recapCount > a.recapTitles.length) {
      textLines.push(`    - +${a.recapCount - a.recapTitles.length} more recap(s)`);
    }
    if (a.announcementCount > 0) {
      textLines.push(
        `    - ${a.announcementCount} new announcement${a.announcementCount === 1 ? "" : "s"}`,
      );
    }
  }
  textLines.push("", `Catch up: ${feedUrl}`, "", "— The Kinectem Team");
  const text = textLines.join("\n") + unsubscribeText(recipient.unsubscribeUrl);

  // HTML
  const items = activity
    .map((a) => {
      const recapItems = a.recapTitles
        .map((t) => `<li>New recap: ${escapeHtml(t)}</li>`)
        .join("");
      const moreRecaps =
        a.recapCount > a.recapTitles.length
          ? `<li>+${a.recapCount - a.recapTitles.length} more recap(s)</li>`
          : "";
      const announce =
        a.announcementCount > 0
          ? `<li>${a.announcementCount} new announcement${a.announcementCount === 1 ? "" : "s"}</li>`
          : "";
      return `<li style="margin-bottom:8px"><strong>${escapeHtml(a.teamName)}</strong><ul>${recapItems}${moreRecaps}${announce}</ul></li>`;
    })
    .join("");
  const bodyHtml = `<p>Hi ${escapeHtml(greeting)},</p>
<p>${intro}</p>
<ul>${items}</ul>
<p><a href="${escapeHtml(feedUrl)}">Catch up on Kinectem →</a></p>
<p style="color:#6b7280;font-size:13px">${totalRecaps} recap${totalRecaps === 1 ? "" : "s"} and ${totalAnnouncements} announcement${totalAnnouncements === 1 ? "" : "s"} this week.</p>
<p>— The Kinectem Team</p>`;
  const html = wrapHtml(bodyHtml, recipient.unsubscribeUrl);

  return { subject, text, html };
}

async function main() {
  const dryRun = process.argv.slice(2).includes("--dry-run");
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // Distinct followers (each may follow many teams).
  const followerRows = await db
    .selectDistinct({ userId: teamFollowers.userId })
    .from(teamFollowers);
  if (followerRows.length === 0) {
    console.log("No team followers. Nothing to do.");
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
  let skippedNoActivity = 0;
  let suppressed = 0;
  // Parents auto-follow their child's teams, so a guardian who follows teams
  // already receives a digest covering those teams — dedupe by resolved
  // recipient email so nobody is emailed twice in one run.
  const emailedThisRun = new Set<string>();

  for (const { userId } of followerRows) {
    // Teams this follower follows.
    const followed = await db
      .select({ teamId: teamFollowers.teamId, teamName: teams.name })
      .from(teamFollowers)
      .innerJoin(teams, eq(teams.id, teamFollowers.teamId))
      .where(eq(teamFollowers.userId, userId));
    if (followed.length === 0) continue;
    const teamIds = followed.map((f) => f.teamId);
    const nameByTeam = new Map(followed.map((f) => [f.teamId, f.teamName]));

    // New published recaps in those teams this window.
    const recaps = await db
      .select({
        teamId: articles.teamId,
        title: articles.title,
      })
      .from(articles)
      .where(
        and(
          inArray(articles.teamId, teamIds),
          eq(articles.status, "published"),
          gte(articles.createdAt, since),
        ),
      )
      .orderBy(desc(articles.createdAt));

    // New announcements (team broadcasts) in those teams this window.
    const announcements = await db
      .select({ teamId: broadcasts.teamId })
      .from(broadcasts)
      .where(
        and(
          inArray(broadcasts.teamId, teamIds),
          eq(broadcasts.scope, "team"),
          gte(broadcasts.createdAt, since),
        ),
      );

    if (recaps.length === 0 && announcements.length === 0) {
      skippedNoActivity++;
      continue;
    }

    // Group activity per team.
    const byTeam = new Map<string, TeamActivity>();
    for (const id of teamIds) {
      byTeam.set(id, {
        teamName: nameByTeam.get(id) ?? "Your team",
        recapTitles: [],
        recapCount: 0,
        announcementCount: 0,
      });
    }
    for (const r of recaps) {
      const a = byTeam.get(r.teamId);
      if (!a) continue;
      a.recapCount++;
      if (a.recapTitles.length < 3) a.recapTitles.push(r.title);
    }
    for (const an of announcements) {
      if (!an.teamId) continue;
      const a = byTeam.get(an.teamId);
      if (a) a.announcementCount++;
    }
    const activity = [...byTeam.values()].filter(
      (a) => a.recapCount > 0 || a.announcementCount > 0,
    );
    if (activity.length === 0) {
      skippedNoActivity++;
      continue;
    }

    const recipient = await resolveRecipient(userId, "digest_weekly");
    if (!recipient) {
      suppressed++;
      continue;
    }
    if (emailedThisRun.has(recipient.to)) continue;
    emailedThisRun.add(recipient.to);

    const email = buildDigest({ recipient, activity });
    if (dryRun) {
      console.log(
        `[dry-run] ${recipient.to}${recipient.isGuardianCopy ? " (guardian)" : ""} <- ${activity.length} team(s), ${activity.reduce((n, a) => n + a.recapCount, 0)} recap(s)`,
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
      console.log(`Sent digest to ${recipient.to}`);
      sent++;
    } catch (err) {
      console.error(`Failed to email ${recipient.to}:`, err);
      suppressed++;
    }
  }

  console.log(
    `${dryRun ? "[dry-run] " : ""}Done. ${sent} digest(s) ${dryRun ? "would be " : ""}sent; ${skippedNoActivity} follower(s) had no activity; ${suppressed} suppressed/failed.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
