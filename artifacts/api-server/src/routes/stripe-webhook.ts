import type { Request, Response } from "express";
import { db, organizations, orgSubscriptions } from "@workspace/db";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { getStripeClient } from "../lib/stripeClient.js";
import {
  mapStripeStatus,
  stripeTrialEndAtOrAfterPolicy,
} from "../lib/stripe-billing.js";
import { logger } from "../lib/logger.js";
import { recordReferralInvoice } from "../lib/competition-referrals";

// Optional Stripe webhook. Only active when STRIPE_WEBHOOK_SECRET is set:
// create an endpoint in the Stripe dashboard pointing at
// <APP_BASE_URL>/api/stripe/webhook and paste its signing secret into Secrets.
// Without it the card-on-file flow still works via the Checkout success-redirect
// reconcile. When configured, this handler also keeps status + first-charge date
// aligned and extends any trialing subscription below its org policy floor.
export async function stripeWebhookHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    res.status(503).json({ error: "Webhook not configured" });
    return;
  }
  const signature = req.headers["stripe-signature"];
  const sig = Array.isArray(signature) ? signature[0] : signature;
  if (!sig) {
    res.status(400).json({ error: "Missing stripe-signature" });
    return;
  }
  if (!Buffer.isBuffer(req.body)) {
    logger.error(
      "Stripe webhook body is not a Buffer — express.json() ran before the raw parser",
    );
    res.status(500).json({ error: "Webhook processing error" });
    return;
  }

  const stripe = await getStripeClient();
  if (!stripe) {
    res.status(503).json({ error: "Stripe not configured" });
    return;
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    logger.warn({ err }, "Stripe webhook signature verification failed");
    res.status(400).json({ error: "Invalid signature" });
    return;
  }

  try {
    if (event.type === "invoice.paid") {
      await recordReferralInvoice(event.data.object as Stripe.Invoice);
    }
    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const sub = event.data.object as Stripe.Subscription;
      const orgId = (sub.metadata?.orgId as string | undefined) ?? null;
      const status = mapStripeStatus(sub.status);
      const customerId =
        typeof sub.customer === "string" ? sub.customer : sub.customer.id;
      const [knownSub] = orgId
        ? await db
            .select({
              orgId: orgSubscriptions.organizationId,
              orgCreatedAt: organizations.createdAt,
              freeUntil: orgSubscriptions.freeUntil,
            })
            .from(orgSubscriptions)
            .innerJoin(
              organizations,
              eq(organizations.id, orgSubscriptions.organizationId),
            )
            .where(eq(orgSubscriptions.organizationId, orgId))
            .limit(1)
        : await db
            .select({
              orgId: orgSubscriptions.organizationId,
              orgCreatedAt: organizations.createdAt,
              freeUntil: orgSubscriptions.freeUntil,
            })
            .from(orgSubscriptions)
            .innerJoin(
              organizations,
              eq(organizations.id, orgSubscriptions.organizationId),
            )
            .where(eq(orgSubscriptions.stripeSubscriptionId, sub.id))
            .limit(1);

      const resolvedOrgId = orgId ?? knownSub?.orgId ?? null;
      let effectiveTrialEnd = sub.trial_end
        ? new Date(sub.trial_end * 1000)
        : null;
      if (sub.status === "trialing" && knownSub?.freeUntil) {
        // Fixed-date offers must never be expanded into a rolling 90-day trial.
        if (effectiveTrialEnd?.getTime() !== knownSub.freeUntil.getTime()) {
          const fresh = await stripe.subscriptions.retrieve(sub.id);
          if (fresh.trial_end !== Math.floor(knownSub.freeUntil.getTime() / 1000)) {
            throw new Error("FREE2027 Stripe billing date is not aligned; reconcile billing before accepting the webhook.");
          }
        }
        effectiveTrialEnd = knownSub.freeUntil;
      }
      if (
        sub.status === "trialing" &&
        effectiveTrialEnd &&
        knownSub?.orgCreatedAt
        && !knownSub.freeUntil
      ) {
        const safeTrialEnd = stripeTrialEndAtOrAfterPolicy(
          knownSub.orgCreatedAt,
          effectiveTrialEnd,
        );
        const safeTrialEndUnix = Math.floor(safeTrialEnd.getTime() / 1000);
        const normalizedSafeTrialEnd = new Date(safeTrialEndUnix * 1000);
        if (effectiveTrialEnd.getTime() < normalizedSafeTrialEnd.getTime()) {
          await stripe.subscriptions.update(sub.id, {
            trial_end: safeTrialEndUnix,
            proration_behavior: "none",
          });
          effectiveTrialEnd = normalizedSafeTrialEnd;
        }
      }

      if (resolvedOrgId) {
        await db
          .update(orgSubscriptions)
          .set({
            stripeSubscriptionId: sub.id,
            stripeCustomerId: customerId,
            status,
            ...(sub.status === "trialing" && effectiveTrialEnd
              ? { billingStartsAt: effectiveTrialEnd }
              : {}),
            updatedAt: new Date(),
          })
          .where(eq(orgSubscriptions.organizationId, resolvedOrgId));
      } else {
        await db
          .update(orgSubscriptions)
          .set({ status, updatedAt: new Date() })
          .where(eq(orgSubscriptions.stripeSubscriptionId, sub.id));
      }
    }
    res.status(200).json({ received: true });
  } catch (err) {
    logger.error({ err }, "Stripe webhook handler error");
    res.status(500).json({ error: "Webhook processing error" });
  }
}
