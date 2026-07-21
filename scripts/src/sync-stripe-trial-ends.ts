// One-off migration helper for the rolling 90-day free period (Task #794).
// The startup migration re-stamps org_subscriptions.billing_starts_at from
// each org's creation date, but subscriptions ALREADY live in Stripe still
// carry the old fixed trial_end (Nov 1 2026). This script moves each live
// trialing Stripe subscription's trial_end to match the row's
// billing_starts_at so the first charge lands on the org's real day-90 date.
//
// Run from the repo root:
//   pnpm --filter @workspace/scripts run sync-stripe-trial-ends -- --dry-run
//   pnpm --filter @workspace/scripts run sync-stripe-trial-ends
//
// Idempotent: subscriptions whose trial_end already matches (±1 minute), or
// that are no longer trialing, are skipped. Stripe requires trial_end to be
// at least 48h in the future, so dates closer than that are floored.
//
// Self-contained: Stripe credential resolution mirrors
// scripts/src/fix-promo-coupon-durations.ts (connector first, then env var).

import { db, orgSubscriptions } from "@workspace/db";
import { and, eq, isNotNull } from "drizzle-orm";
import Stripe from "stripe";

const DRY_RUN = process.argv.includes("--dry-run");
const MIN_TRIAL_END_MS = 49 * 60 * 60 * 1000; // 48h Stripe minimum + buffer

async function resolveSecretKey(): Promise<string | null> {
  const envKey = process.env.STRIPE_SECRET_KEY;
  if (envKey) return envKey;

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? `repl ${process.env.REPL_IDENTITY}`
    : process.env.WEB_REPL_RENEWAL
      ? `depl ${process.env.WEB_REPL_RENEWAL}`
      : null;
  if (!hostname || !xReplitToken) return null;

  try {
    const res = await fetch(
      `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=stripe`,
      { headers: { Accept: "application/json", "X-Replit-Token": xReplitToken } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      items?: Array<{ settings?: { secret?: string } }>;
    };
    return data.items?.[0]?.settings?.secret ?? null;
  } catch {
    return null;
  }
}

async function main() {
  const secretKey = await resolveSecretKey();
  if (!secretKey) {
    console.error("Stripe is not configured in this environment; aborting.");
    process.exitCode = 1;
    return;
  }
  const stripe = new Stripe(secretKey);

  const rows = await db
    .select({
      orgId: orgSubscriptions.organizationId,
      stripeSubscriptionId: orgSubscriptions.stripeSubscriptionId,
      billingStartsAt: orgSubscriptions.billingStartsAt,
    })
    .from(orgSubscriptions)
    .where(
      and(
        isNotNull(orgSubscriptions.stripeSubscriptionId),
        isNotNull(orgSubscriptions.billingStartsAt),
        eq(orgSubscriptions.status, "trialing"),
      ),
    );

  if (rows.length === 0) {
    console.log("No trialing Stripe subscriptions to sync. Nothing to do.");
    return;
  }

  let updated = 0;
  let skipped = 0;
  for (const row of rows) {
    const subId = row.stripeSubscriptionId!;
    let sub: Stripe.Subscription;
    try {
      sub = await stripe.subscriptions.retrieve(subId);
    } catch (err) {
      console.warn(`Couldn't retrieve ${subId} (org ${row.orgId}) — skipping.`, err);
      skipped++;
      continue;
    }
    if (sub.status !== "trialing") {
      console.log(`${subId}: status ${sub.status}, not trialing — skipping.`);
      skipped++;
      continue;
    }

    const floor = Date.now() + MIN_TRIAL_END_MS;
    const target = Math.max(row.billingStartsAt!.getTime(), floor);
    const targetUnix = Math.floor(target / 1000);
    if (sub.trial_end && Math.abs(sub.trial_end - targetUnix) <= 60) {
      console.log(`${subId}: trial_end already correct — skipping.`);
      skipped++;
      continue;
    }

    if (DRY_RUN) {
      console.log(
        `[dry-run] ${subId} (org ${row.orgId}): trial_end ${sub.trial_end} -> ${targetUnix} (${new Date(target).toISOString()})`,
      );
      updated++;
      continue;
    }
    try {
      await stripe.subscriptions.update(subId, {
        trial_end: targetUnix,
        proration_behavior: "none",
      });
      console.log(
        `${subId} (org ${row.orgId}): trial_end -> ${new Date(target).toISOString()}`,
      );
      updated++;
    } catch (err) {
      console.error(`Failed to update ${subId}:`, err);
      skipped++;
    }
  }

  console.log(
    `${DRY_RUN ? "[dry-run] " : ""}Done. ${updated} subscription(s) ${
      DRY_RUN ? "would be " : ""
    }updated; ${skipped} skipped.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
