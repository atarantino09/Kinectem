// Send the "your first charge is coming up" reminder to org admins whose
// organization HAS a card on file and whose free period ends within
// the next 14 days. Quotes the exact charge date and amount (promo-discounted
// when a promo is applied) and reminds them they can cancel any time before
// the charge at no cost.
//
// Run from the repo root:
//   pnpm --filter @workspace/scripts run send-trial-ending-reminders -- --dry-run
//   pnpm --filter @workspace/scripts run send-trial-ending-reminders
//
// IDEMPOTENT: each org is stamped (org_subscriptions.trial_reminder_sent_at)
// after at least one recipient is emailed successfully, so re-running never
// re-sends. Safe to schedule DAILY (e.g. a Replit Scheduled Deployment).
//
// Self-contained on purpose: leaf workspace packages can't import the
// api-server's email helpers, so the SendGrid send mirrors
// scripts/src/send-billing-reminders.ts.

import {
  db,
  organizations,
  organizationAdmins,
  orgSubscriptions,
  promoCodes,
  users,
} from "@workspace/db";
import { and, eq, isNull, isNotNull, inArray, lte, gte } from "drizzle-orm";
import {
  emailButton,
  emailKeyValue,
  emailSection,
  emailStatusCallout,
  renderBrandedEmailHtml,
} from "@workspace/email-template";
import { pathToFileURL } from "node:url";

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

const REMINDER_WINDOW_DAYS = 14;

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
function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
function formatUsd(amount: number): string {
  const hasCents = Math.round(amount * 100) % 100 !== 0;
  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

// First-year charge after any applied promo (promos discount year 1 only).
function firstYearCharge(
  plan: PlanTier,
  promo: { discountType: string; discountValue: number } | null,
): number {
  const list = PLAN_YEARLY_USD[plan];
  if (!promo) return list;
  if (promo.discountType === "percent") {
    return Math.max(0, list * (1 - promo.discountValue / 100));
  }
  return Math.max(0, list - promo.discountValue);
}

// Resolve SendGrid credentials — connector first, then env vars. Mirrors
// send-billing-reminders.ts.
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

export function buildTrialEndingReminderEmail(args: {
  adminName: string;
  orgName: string;
  plan: PlanTier;
  orgId: string;
  billingStartsAt: Date;
  promo: { code: string; discountType: string; discountValue: number } | null;
}): { subject: string; text: string; html: string } {
  const greeting = firstName(args.adminName);
  const planName = PLAN_LABEL[args.plan];
  const charge = formatUsd(firstYearCharge(args.plan, args.promo));
  const list = formatUsd(PLAN_YEARLY_USD[args.plan]);
  const dateLabel = formatDate(args.billingStartsAt);
  const url = subscribeUrl(args.orgId);

  const promoLine = args.promo
    ? ` Your promo code ${args.promo.code.toUpperCase()} is applied, so your first year is ${charge} instead of ${list}; renewals bill at the regular ${list}/yr.`
    : "";

  const subject = `Heads up: your Kinectem billing starts ${dateLabel}`;

  const text = `Hi ${greeting},

Your free period for ${args.orgName} ends soon. On ${dateLabel}, the card on file will be charged ${charge} for your first year on the ${planName} plan.${promoLine}

Want to make a change first? You can switch plans — or cancel billing entirely and pay nothing — any time before ${dateLabel}:

${url}

If everything looks good, there's nothing to do. Thanks for building your club's story on Kinectem!

— The Kinectem Team`;

  const bodyHtml = `<p>Hi ${escapeHtml(greeting)},</p>
${emailStatusCallout("warning", `<strong>Upcoming charge:</strong> your free period for <strong>${escapeHtml(args.orgName)}</strong> ends soon. ${escapeHtml(promoLine.trim())}`)}
${emailSection({
  eyebrow: "Billing details",
  title: "Your first charge",
  bodyHtml: emailKeyValue([
    { label: "Charge date", value: dateLabel },
    { label: "Plan", value: planName },
    { label: "First-year amount", value: charge },
  ]),
})}
${emailSection({
  title: "Review your plan",
  bodyHtml: `<p>You can switch plans or cancel billing entirely and pay nothing any time before ${escapeHtml(dateLabel)}.</p>${emailButton({ href: url, label: "Manage your plan" })}`,
})}
<p>If everything looks good, there's nothing to do. Thanks for building your club's story on Kinectem!</p>
<p>— The Kinectem Team</p>`;
  const html = renderBrandedEmailHtml({
    bodyHtml,
    subject,
    baseUrl: appBaseUrl(),
    contextLabel: args.orgName,
  });

  return { subject, text, html };
}

async function main() {
  const dryRun = process.argv.slice(2).includes("--dry-run");

  const now = new Date();
  const windowEnd = new Date(
    now.getTime() + REMINDER_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );

  // Orgs with a card on file, still trialing, charge date within 14 days,
  // not yet reminded.
  const subs = await db
    .select({
      orgId: orgSubscriptions.organizationId,
      plan: orgSubscriptions.plan,
      orgName: organizations.name,
      billingStartsAt: orgSubscriptions.billingStartsAt,
      promoCode: promoCodes.code,
      promoDiscountType: promoCodes.discountType,
      promoDiscountValue: promoCodes.discountValue,
    })
    .from(orgSubscriptions)
    .innerJoin(
      organizations,
      eq(organizations.id, orgSubscriptions.organizationId),
    )
    .leftJoin(promoCodes, eq(promoCodes.id, orgSubscriptions.promoCodeId))
    .where(
      and(
        isNotNull(orgSubscriptions.stripeSubscriptionId),
        eq(orgSubscriptions.status, "trialing"),
        isNull(orgSubscriptions.trialReminderSentAt),
        isNotNull(orgSubscriptions.billingStartsAt),
        gte(orgSubscriptions.billingStartsAt, now),
        lte(orgSubscriptions.billingStartsAt, windowEnd),
      ),
    );

  if (subs.length === 0) {
    console.log(
      "No organizations need a trial-ending reminder. Nothing to do.",
    );
    return;
  }

  const creds = dryRun ? null : await resolveCredentials();
  if (!dryRun && !creds) {
    console.error(
      "SendGrid is not configured (no connector and no SENDGRID_API_KEY/EMAIL_FROM). Aborting.",
    );
    process.exit(1);
  }

  let orgsReminded = 0;
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
    const promo =
      sub.promoCode && sub.promoDiscountType && sub.promoDiscountValue != null
        ? {
            code: sub.promoCode,
            discountType: sub.promoDiscountType,
            discountValue: sub.promoDiscountValue,
          }
        : null;

    let sentForOrg = 0;
    for (const r of recipients) {
      const email = buildTrialEndingReminderEmail({
        adminName: r.name,
        orgName: sub.orgName,
        plan: sub.plan as PlanTier,
        orgId: sub.orgId,
        billingStartsAt: sub.billingStartsAt!,
        promo,
      });
      if (dryRun) {
        console.log(
          `[dry-run] ${r.email} <- ${sub.orgName} (${sub.plan}, charge ${formatDate(sub.billingStartsAt!)})`,
        );
        sentForOrg++;
        continue;
      }
      try {
        await sendEmail(
          creds!,
          r.email!,
          email.subject,
          email.text,
          email.html,
        );
        console.log(`Sent to ${r.email} (${sub.orgName})`);
        sentForOrg++;
      } catch (err) {
        console.error(`Failed to email ${r.email}:`, err);
      }
    }

    // Stamp only after at least one successful send so failures retry on the
    // next run.
    if (!dryRun && sentForOrg > 0) {
      await db
        .update(orgSubscriptions)
        .set({ trialReminderSentAt: new Date(), updatedAt: new Date() })
        .where(eq(orgSubscriptions.organizationId, sub.orgId));
    }
    if (sentForOrg > 0) orgsReminded++;
    else skipped++;
  }

  console.log(
    `${dryRun ? "[dry-run] " : ""}Done. ${orgsReminded} org(s) ${
      dryRun ? "would be " : ""
    }reminded; ${skipped} skipped.`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
