import type { Request, Response } from "express";
import { db, orgSubscriptions } from "@workspace/db";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { getStripeClient } from "../lib/stripeClient.js";
import { mapStripeStatus } from "../lib/stripe-billing.js";
import { logger } from "../lib/logger.js";

// Optional Stripe webhook. Only active when STRIPE_WEBHOOK_SECRET is set:
// create an endpoint in the Stripe dashboard pointing at
// <APP_BASE_URL>/api/stripe/webhook and paste its signing secret into Secrets.
// Without it the card-on-file flow still works via the Checkout success-redirect
// reconcile; this handler just keeps org_subscriptions.status fresh after the
// Oct 1 charge (active / past_due / canceled).
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
      if (orgId) {
        await db
          .update(orgSubscriptions)
          .set({
            stripeSubscriptionId: sub.id,
            stripeCustomerId: customerId,
            status,
            updatedAt: new Date(),
          })
          .where(eq(orgSubscriptions.organizationId, orgId));
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
