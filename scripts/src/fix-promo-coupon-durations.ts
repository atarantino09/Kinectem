// Fix subscriptions whose promo discount was created with a duration:"forever"
// Stripe coupon. Promo discounts are meant to apply to the FIRST YEAR ONLY,
// so this script swaps each forever coupon on a live subscription for a
// first-invoice-only (`duration: "once"`) coupon carrying the same discount.
//
// Run from the repo root:
//   pnpm --filter @workspace/scripts run fix-promo-coupon-durations -- --dry-run
//   pnpm --filter @workspace/scripts run fix-promo-coupon-durations
//
// Idempotent: subscriptions whose discount is already a "once" coupon (or that
// have no discount) are skipped, so re-running is safe. Run this BEFORE the
// first invoice on Nov 1 2026 — a "once" coupon still discounts the upcoming
// first invoice, so year-1 pricing is preserved and renewals bill at list.
//
// Self-contained on purpose: leaf workspace packages can't import the
// api-server's Stripe helpers, so credential resolution mirrors
// artifacts/api-server/src/lib/stripeClient.ts (connector first, then the
// STRIPE_SECRET_KEY env var).

import { db, orgSubscriptions, promoCodes } from "@workspace/db";
import { and, eq, isNotNull } from "drizzle-orm";
import Stripe from "stripe";

const DRY_RUN = process.argv.includes("--dry-run");

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

// Mirrors ensurePromoCouponId in the api-server: percent coupons live under a
// versioned `_y1` id with duration:"once" (first yearly invoice only);
// amount coupons keep the unversioned id (they were always duration:"once").
async function ensureFirstYearCouponId(
  stripe: Stripe,
  promo: { code: string; discountType: string; discountValue: number },
): Promise<string | null> {
  const isPercent = promo.discountType === "percent";
  const couponId = isPercent
    ? `kinectem_promo_${promo.code}_y1`
    : `kinectem_promo_${promo.code}`;
  try {
    const existing = (await stripe.coupons.retrieve(couponId)) as Stripe.Coupon & {
      deleted?: boolean;
    };
    if (!existing.deleted) return couponId;
  } catch {
    // Not found — fall through to create.
  }
  try {
    if (isPercent) {
      await stripe.coupons.create({
        id: couponId,
        percent_off: Math.min(100, Math.max(1, promo.discountValue)),
        duration: "once",
        name: `Promo ${promo.code} (first year)`,
      });
    } else {
      await stripe.coupons.create({
        id: couponId,
        amount_off: Math.max(1, promo.discountValue) * 100,
        currency: "usd",
        duration: "once",
        name: `Promo ${promo.code}`,
      });
    }
    return couponId;
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

  // Every org subscription that has both a Stripe subscription and a promo.
  const rows = await db
    .select({
      orgId: orgSubscriptions.organizationId,
      stripeSubscriptionId: orgSubscriptions.stripeSubscriptionId,
      code: promoCodes.code,
      discountType: promoCodes.discountType,
      discountValue: promoCodes.discountValue,
    })
    .from(orgSubscriptions)
    .innerJoin(promoCodes, eq(orgSubscriptions.promoCodeId, promoCodes.id))
    .where(
      and(
        isNotNull(orgSubscriptions.stripeSubscriptionId),
        isNotNull(orgSubscriptions.promoCodeId),
      ),
    );

  console.log(
    `${DRY_RUN ? "[dry-run] " : ""}Found ${rows.length} subscription(s) with a promo code and a card on file.`,
  );

  let fixed = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const subId = row.stripeSubscriptionId!;
    let sub: Stripe.Subscription;
    try {
      sub = await stripe.subscriptions.retrieve(subId, {
        expand: ["discounts.source.coupon"],
      });
    } catch (err) {
      console.error(`  ✗ org ${row.orgId}: cannot retrieve ${subId}:`, err);
      failed++;
      continue;
    }

    // Stripe v22+: the coupon lives under discount.source.coupon.
    const foreverCoupons = (sub.discounts ?? [])
      .map((d) =>
        typeof d === "string"
          ? null
          : typeof d.source?.coupon === "object"
            ? d.source.coupon
            : null,
      )
      .filter(
        (c): c is Stripe.Coupon => c != null && c.duration === "forever",
      );
    if (foreverCoupons.length === 0) {
      skipped++;
      continue;
    }

    console.log(
      `  org ${row.orgId} (${subId}): forever coupon ${foreverCoupons
        .map((c) => c.id)
        .join(", ")} → first-year-only for code "${row.code}"`,
    );
    if (DRY_RUN) {
      fixed++;
      continue;
    }

    const newCouponId = await ensureFirstYearCouponId(stripe, row);
    if (!newCouponId) {
      // Never destructively remove a discount we can't replace — that would
      // silently take away the org's year-1 discount. Fail loudly instead.
      console.error(
        `    ✗ could not create a first-year coupon for code "${row.code}"; leaving subscription untouched.`,
      );
      failed++;
      continue;
    }
    try {
      await stripe.subscriptions.update(subId, {
        // Replaces ALL existing discounts on the subscription. Promo checkout
        // only ever attaches one, so this swap is exact.
        discounts: [{ coupon: newCouponId }],
      });
      fixed++;
      console.log(`    ✓ swapped to ${newCouponId}`);
    } catch (err) {
      console.error(`    ✗ failed to update ${subId}:`, err);
      failed++;
    }
  }

  console.log(
    `${DRY_RUN ? "[dry-run] " : ""}Done. ${fixed} fixed, ${skipped} already correct, ${failed} failed.`,
  );
  if (failed > 0) process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
