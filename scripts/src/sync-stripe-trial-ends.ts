// Operator reconciliation for the legacy organization billing floor.
//
// Organizations created before the Aug 20 rollout cannot receive their first
// annual charge before Nov 1, 2026. This script audits those local subscription
// rows, fixes only trialing rows below the floor, and extends matching live
// Stripe trials without proration or an early invoice.
//
// Run from the repo root:
//   pnpm --filter @workspace/scripts run sync-stripe-trial-ends -- --dry-run
//   pnpm --filter @workspace/scripts run sync-stripe-trial-ends
//
// Idempotent: local and Stripe dates already aligned within one minute are
// skipped. Remote subscriptions that are not trialing are reported and left
// unchanged. Always run --dry-run first.
//
// Self-contained: Stripe credential resolution mirrors
// scripts/src/fix-promo-coupon-durations.ts (connector first, then env var).

import { db, organizations, orgSubscriptions } from "@workspace/db";
import { and, eq, isNull, lt } from "drizzle-orm";
import { pathToFileURL } from "node:url";
import Stripe from "stripe";

const DRY_RUN = process.argv.includes("--dry-run");
const MIN_TRIAL_END_MS = 49 * 60 * 60 * 1000; // 48h Stripe minimum + buffer
const LEGACY_ROLLOUT_CUTOFF = new Date("2026-08-20T00:00:00.000Z");
const LEGACY_FIRST_CHARGE_FLOOR = new Date("2026-11-01T00:00:00.000Z");

export function stripeTrialTargetMs(
  localBillingStartsAt: Date | null,
  now = new Date(),
): number {
  return (
    Math.floor(
      Math.max(
        localBillingStartsAt?.getTime() ?? 0,
        LEGACY_FIRST_CHARGE_FLOOR.getTime(),
        now.getTime() + MIN_TRIAL_END_MS,
      ) / 1000,
    ) * 1000
  );
}

export function stripeTrialNeedsExtension(
  currentTrialEndUnix: number | null,
  targetMs: number,
): boolean {
  return currentTrialEndUnix == null || currentTrialEndUnix * 1000 < targetMs;
}

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
  const rows = await db
    .select({
      orgId: orgSubscriptions.organizationId,
      stripeSubscriptionId: orgSubscriptions.stripeSubscriptionId,
      billingStartsAt: orgSubscriptions.billingStartsAt,
      orgCreatedAt: organizations.createdAt,
    })
    .from(orgSubscriptions)
    .innerJoin(
      organizations,
      eq(organizations.id, orgSubscriptions.organizationId),
    )
    .where(
      and(
        eq(orgSubscriptions.status, "trialing"),
        lt(organizations.createdAt, LEGACY_ROLLOUT_CUTOFF),
      ),
    );

  if (rows.length === 0) {
    console.log("No legacy trialing organization subscriptions. Nothing to do.");
    return;
  }

  const rowsWithStripe = rows.filter((row) => row.stripeSubscriptionId);
  const secretKey =
    rowsWithStripe.length > 0 ? await resolveSecretKey() : null;
  if (rowsWithStripe.length > 0 && !secretKey && !DRY_RUN) {
    console.error(
      `Stripe is not configured; refusing a live run because ${rowsWithStripe.length} legacy row(s) have Stripe subscriptions.`,
    );
    process.exitCode = 1;
    return;
  }
  const stripe = secretKey ? new Stripe(secretKey) : null;

  let localUpdated = 0;
  let stripeUpdated = 0;
  let alreadyAligned = 0;
  let unchangedRemoteStatus = 0;
  let failures = 0;

  for (const row of rows) {
    const currentLocalMs = row.billingStartsAt?.getTime() ?? null;
    const policyLocalMs = Math.max(
      currentLocalMs ?? 0,
      LEGACY_FIRST_CHARGE_FLOOR.getTime(),
    );
    const subId = row.stripeSubscriptionId;

    if (!subId) {
      if (
        currentLocalMs != null &&
        currentLocalMs >= LEGACY_FIRST_CHARGE_FLOOR.getTime()
      ) {
        console.log(
          `org ${row.orgId}: local billing date already satisfies the legacy floor — skipping.`,
        );
        alreadyAligned++;
        continue;
      }

      console.log(
        `${DRY_RUN ? "[dry-run] " : ""}org ${row.orgId}: local billing_starts_at ${row.billingStartsAt?.toISOString() ?? "NULL"} -> ${LEGACY_FIRST_CHARGE_FLOOR.toISOString()} (no Stripe subscription)`,
      );
      if (!DRY_RUN) {
        await db
          .update(orgSubscriptions)
          .set({
            billingStartsAt: LEGACY_FIRST_CHARGE_FLOOR,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(orgSubscriptions.organizationId, row.orgId),
              eq(orgSubscriptions.status, "trialing"),
              isNull(orgSubscriptions.stripeSubscriptionId),
            ),
          );
      }
      localUpdated++;
      continue;
    }

    if (!stripe) {
      console.warn(
        `[dry-run] org ${row.orgId}: local billing_starts_at ${row.billingStartsAt?.toISOString() ?? "NULL"} -> ${new Date(policyLocalMs).toISOString()}; Stripe ${subId} could not be inspected because Stripe is not configured.`,
      );
      if (
        currentLocalMs == null ||
        currentLocalMs < LEGACY_FIRST_CHARGE_FLOOR.getTime()
      ) {
        localUpdated++;
      }
      failures++;
      continue;
    }

    let sub: Stripe.Subscription;
    try {
      sub = await stripe.subscriptions.retrieve(subId);
    } catch (err) {
      console.warn(`Couldn't retrieve ${subId} (org ${row.orgId}) — skipping.`, err);
      failures++;
      continue;
    }
    if (sub.status !== "trialing") {
      console.log(
        `${subId} (org ${row.orgId}): remote status ${sub.status}; local and Stripe records left unchanged.`,
      );
      unchangedRemoteStatus++;
      continue;
    }

    const stripeSafeTargetMs = stripeTrialTargetMs(
      new Date(policyLocalMs),
      new Date(),
    );
    const currentStripeMs = sub.trial_end ? sub.trial_end * 1000 : null;
    const stripeNeedsExtension = stripeTrialNeedsExtension(
      sub.trial_end,
      stripeSafeTargetMs,
    );
    const finalStripeMs: number = stripeNeedsExtension
      ? stripeSafeTargetMs
      : currentStripeMs!;
    const localNeedsAlignment =
      currentLocalMs == null ||
      currentLocalMs < LEGACY_FIRST_CHARGE_FLOOR.getTime() ||
      currentLocalMs !== finalStripeMs;

    if (!stripeNeedsExtension && !localNeedsAlignment) {
      console.log(
        `${subId} (org ${row.orgId}): local and Stripe dates already aligned — skipping.`,
      );
      alreadyAligned++;
      continue;
    }

    if (DRY_RUN) {
      if (stripeNeedsExtension) {
        console.log(
          `[dry-run] ${subId} (org ${row.orgId}): Stripe trial_end ${currentStripeMs ? new Date(currentStripeMs).toISOString() : "NULL"} -> ${new Date(finalStripeMs).toISOString()}`,
        );
        stripeUpdated++;
      }
      if (localNeedsAlignment) {
        console.log(
          `[dry-run] org ${row.orgId}: local billing_starts_at ${row.billingStartsAt?.toISOString() ?? "NULL"} -> ${new Date(finalStripeMs).toISOString()}`,
        );
        localUpdated++;
      }
      continue;
    }

    if (stripeNeedsExtension) {
      try {
        await stripe.subscriptions.update(subId, {
          trial_end: Math.floor(finalStripeMs / 1000),
          proration_behavior: "none",
        });
        console.log(
          `${subId} (org ${row.orgId}): Stripe trial_end -> ${new Date(finalStripeMs).toISOString()}`,
        );
        stripeUpdated++;
      } catch (err) {
        console.error(`Failed to update ${subId}:`, err);
        failures++;
        continue;
      }
    }

    if (localNeedsAlignment) {
      await db
        .update(orgSubscriptions)
        .set({
          billingStartsAt: new Date(finalStripeMs),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(orgSubscriptions.organizationId, row.orgId),
            eq(orgSubscriptions.status, "trialing"),
            eq(orgSubscriptions.stripeSubscriptionId, subId),
          ),
        );
      console.log(
        `org ${row.orgId}: local billing_starts_at -> ${new Date(finalStripeMs).toISOString()}`,
      );
      localUpdated++;
    }
  }

  console.log(
    `${DRY_RUN ? "[dry-run] " : ""}Done. ${localUpdated} local row(s) ${
      DRY_RUN ? "would be " : ""
    }updated; ${stripeUpdated} Stripe trial(s) ${
      DRY_RUN ? "would be " : ""
    }extended; ${alreadyAligned} already aligned; ${unchangedRemoteStatus} non-trialing remote subscription(s) unchanged; ${failures} failure(s).`,
  );

  if (failures > 0) process.exitCode = 1;
}

const isMain =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(process.argv[1]!).href;

if (isMain) {
  main()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
