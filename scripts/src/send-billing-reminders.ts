// Send the "add a card before October 1" reminder to org admins whose
// organization has chosen a plan but has NOT yet put a card on file.
//
// Run from the repo root:
//   pnpm --filter @workspace/scripts run send-billing-reminders -- --dry-run
//   pnpm --filter @workspace/scripts run send-billing-reminders
//
// "No card on file" = org_subscriptions.stripe_subscription_id IS NULL. The
// reminder goes to every owner/admin of each such org that has an email.
//
// Scheduling: this is meant to run once on 2026-09-15 (e.g. a Replit Scheduled
// Deployment, or trigger it manually). It is NOT idempotent — re-running
// re-sends to everyone still missing a card. Always preview with --dry-run
// first to see the exact recipient list.
//
// This script is intentionally self-contained: leaf workspace packages can't
// import the api-server's email helpers, so the SendGrid send + the approved
// campaign copy live here. If the in-app billing email tone ever changes, this
// copy is the canonical source for the campaign.

import {
  db,
  organizations,
  organizationAdmins,
  orgSubscriptions,
  users,
} from "@workspace/db";
import { and, eq, isNull, inArray } from "drizzle-orm";

type PlanTier = "starter" | "pro" | "elite";

const PLAN_LABEL: Record<PlanTier, string> = {
  starter: "Starter",
  pro: "Pro",
  elite: "Elite",
};
// Yearly list price (whole USD) — mirrors PLAN_CATALOG in the api-server.
const PLAN_YEARLY_USD: Record<PlanTier, number> = {
  starter: 1000,
  pro: 1750,
  elite: 2500,
};

function appBaseUrl(): string {
  return (process.env.APP_BASE_URL ?? "https://kinectem.replit.app").replace(
    /\/+$/,
    "",
  );
}
function subscribeUrl(orgId: string): string {
  return `${appBaseUrl()}/app/organizations/${orgId}/subscribe`;
}
function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || "there";
}
function escapeHtml(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Resolve SendGrid credentials, preferring the Replit connector and falling
// back to env vars. Mirrors api-server/src/lib/email.ts (which scripts can't
// import). Returns null when nothing is configured.
async function resolveCredentials(): Promise<{
  apiKey: string;
  from: string;
} | null> {
  const envKey = process.env.SENDGRID_API_KEY;
  const envFrom = process.env.EMAIL_FROM;

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? `repl ${process.env.REPL_IDENTITY}`
    : process.env.WEB_REPL_RENEWAL
      ? `depl ${process.env.WEB_REPL_RENEWAL}`
      : null;

  if (hostname && xReplitToken) {
    try {
      const res = await fetch(
        `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=sendgrid`,
        {
          headers: {
            Accept: "application/json",
            "X-Replit-Token": xReplitToken,
          },
        },
      );
      if (res.ok) {
        const data = (await res.json()) as {
          items?: Array<{
            settings?: { api_key?: string; from_email?: string };
          }>;
        };
        const s = data.items?.[0]?.settings;
        const apiKey = s?.api_key ?? envKey;
        const from = s?.from_email ?? envFrom;
        if (apiKey && from) return { apiKey, from };
      }
    } catch {
      // Fall through to env vars.
    }
  }

  if (envKey && envFrom) return { apiKey: envKey, from: envFrom };
  return null;
}

async function sendEmail(
  creds: { apiKey: string; from: string },
  to: string,
  subject: string,
  text: string,
  html: string,
): Promise<void> {
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: creds.from },
      subject,
      content: [
        { type: "text/plain", value: text },
        { type: "text/html", value: html },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`SendGrid ${res.status} ${body.slice(0, 200)}`);
  }
}

function buildEmail(args: {
  adminName: string;
  orgName: string;
  plan: PlanTier;
  orgId: string;
}): { subject: string; text: string; html: string } {
  const greeting = firstName(args.adminName);
  const planName = PLAN_LABEL[args.plan];
  const price = `$${PLAN_YEARLY_USD[args.plan].toLocaleString("en-US")}`;
  const url = subscribeUrl(args.orgId);

  const subject =
    "Your Kinectem teams are set — one quick step before October 1";

  const text = `Hi ${greeting},

It's been a joy watching ${args.orgName} bring its teams, players, and families onto Kinectem.

Your free launch period wraps up on October 1, when annual billing begins for your ${planName} plan (${price}/yr). To keep everything running without a hitch — no lost access, no interruptions for your coaches or parents — just add a card on file now. You won't be charged until October 1.

Add your card: ${url}

It takes about 30 seconds, it's fully secure, and you can change your plan any time before billing starts. Questions? Just reply to this email.

Thanks for being one of our founding organizations — here's to a great season ahead.

— The Kinectem Team`;

  const html = `<p>Hi ${escapeHtml(greeting)},</p>
<p>It's been a joy watching <strong>${escapeHtml(args.orgName)}</strong> bring its teams, players, and families onto Kinectem. 🎉</p>
<p>Your free launch period wraps up on <strong>October 1</strong>, when annual billing begins for your <strong>${escapeHtml(planName)}</strong> plan (${escapeHtml(price)}/yr). To keep everything running without a hitch — no lost access, no interruptions for your coaches or parents — just add a card on file now. <strong>You won't be charged until October 1.</strong></p>
<p><a href="${escapeHtml(url)}">Add your card →</a></p>
<p>It takes about 30 seconds, it's fully secure, and you can change your plan any time before billing starts. Questions? Just reply to this email.</p>
<p>Thanks for being one of our founding organizations — here's to a great season ahead.</p>
<p>— The Kinectem Team</p>`;

  return { subject, text, html };
}

async function main() {
  const dryRun = process.argv.slice(2).includes("--dry-run");

  // Orgs with a chosen plan but no card on file yet.
  const subs = await db
    .select({
      orgId: orgSubscriptions.organizationId,
      plan: orgSubscriptions.plan,
      orgName: organizations.name,
    })
    .from(orgSubscriptions)
    .innerJoin(
      organizations,
      eq(organizations.id, orgSubscriptions.organizationId),
    )
    .where(isNull(orgSubscriptions.stripeSubscriptionId));

  if (subs.length === 0) {
    console.log("No organizations need a billing reminder. Nothing to do.");
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
  let skipped = 0;
  for (const sub of subs) {
    const admins = await db
      .select({ name: users.name, email: users.email })
      .from(organizationAdmins)
      .innerJoin(users, eq(users.id, organizationAdmins.userId))
      .where(
        and(
          eq(organizationAdmins.organizationId, sub.orgId),
          inArray(organizationAdmins.role, ["owner", "admin"]),
        ),
      );
    const recipients = admins.filter((a) => a.email);
    if (recipients.length === 0) {
      console.warn(`No admin email for "${sub.orgName}" — skipping.`);
      skipped++;
      continue;
    }
    for (const r of recipients) {
      const email = buildEmail({
        adminName: r.name,
        orgName: sub.orgName,
        plan: sub.plan as PlanTier,
        orgId: sub.orgId,
      });
      if (dryRun) {
        console.log(`[dry-run] ${r.email} <- ${sub.orgName} (${sub.plan})`);
        sent++;
        continue;
      }
      try {
        await sendEmail(creds!, r.email!, email.subject, email.text, email.html);
        console.log(`Sent to ${r.email} (${sub.orgName})`);
        sent++;
      } catch (err) {
        console.error(`Failed to email ${r.email}:`, err);
        skipped++;
      }
    }
  }

  console.log(
    `${dryRun ? "[dry-run] " : ""}Done. ${sent} email(s) ${
      dryRun ? "would be " : ""
    }sent across ${subs.length} org(s); ${skipped} recipient(s)/org(s) skipped.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
