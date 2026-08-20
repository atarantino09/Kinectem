import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, organizations, orgSubscriptions } from "@workspace/db";

const stripeMocks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  updateSubscription: vi.fn(),
  getStripeClient: vi.fn(),
}));

vi.mock("../src/lib/stripeClient.js", () => ({
  getStripeClient: stripeMocks.getStripeClient,
}));

import { app, request } from "./helpers";

describe("Stripe subscription webhook billing alignment", () => {
  let originalWebhookSecret: string | undefined;

  beforeEach(() => {
    originalWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    stripeMocks.constructEvent.mockReset();
    stripeMocks.updateSubscription.mockReset();
    stripeMocks.getStripeClient.mockResolvedValue({
      webhooks: { constructEvent: stripeMocks.constructEvent },
      subscriptions: { update: stripeMocks.updateSubscription },
    });
  });

  afterEach(() => {
    if (originalWebhookSecret === undefined) {
      delete process.env.STRIPE_WEBHOOK_SECRET;
    } else {
      process.env.STRIPE_WEBHOOK_SECRET = originalWebhookSecret;
    }
  });

  it("extends a legacy trial even when it is only seconds below the floor", async () => {
    const [org] = await db
      .insert(organizations)
      .values({
        name: "Webhook legacy org",
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
      })
      .returning();
    await db.insert(orgSubscriptions).values({
      organizationId: org!.id,
      plan: "starter",
      status: "trialing",
      billingStartsAt: new Date("2026-10-31T23:59:30.000Z"),
    });

    stripeMocks.constructEvent.mockReturnValue({
      type: "customer.subscription.created",
      data: {
        object: {
          id: "sub_legacy_floor",
          status: "trialing",
          customer: "cus_legacy",
          metadata: { orgId: org!.id },
          trial_end: Date.parse("2026-10-31T23:59:30.000Z") / 1000,
        },
      },
    });

    const response = await request(app)
      .post("/api/stripe/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "valid-test-signature")
      .send(Buffer.from("{}"));

    expect(response.status).toBe(200);
    expect(stripeMocks.updateSubscription).toHaveBeenCalledWith(
      "sub_legacy_floor",
      {
        trial_end: Date.parse("2026-11-01T00:00:00.000Z") / 1000,
        proration_behavior: "none",
      },
    );

    const [stored] = await db
      .select()
      .from(orgSubscriptions)
      .where(eq(orgSubscriptions.organizationId, org!.id));
    expect(stored?.billingStartsAt?.toISOString()).toBe(
      "2026-11-01T00:00:00.000Z",
    );
    expect(stored?.stripeSubscriptionId).toBe("sub_legacy_floor");
  });

  it.each(["active", "canceled"] as const)(
    "leaves a %s remote subscription's billing date unchanged",
    async (remoteStatus) => {
      const [org] = await db
        .insert(organizations)
        .values({
          name: `Webhook ${remoteStatus} org`,
          createdAt: new Date("2026-07-01T00:00:00.000Z"),
        })
        .returning();
      const originalDate = new Date("2026-09-29T00:00:00.000Z");
      await db.insert(orgSubscriptions).values({
        organizationId: org!.id,
        plan: "starter",
        status: "trialing",
        billingStartsAt: originalDate,
      });

      stripeMocks.constructEvent.mockReturnValue({
        type: "customer.subscription.updated",
        data: {
          object: {
            id: `sub_${remoteStatus}`,
            status: remoteStatus,
            customer: `cus_${remoteStatus}`,
            metadata: { orgId: org!.id },
            trial_end: Date.parse("2026-09-29T00:00:00.000Z") / 1000,
          },
        },
      });

      const response = await request(app)
        .post("/api/stripe/webhook")
        .set("Content-Type", "application/json")
        .set("stripe-signature", "valid-test-signature")
        .send(Buffer.from("{}"));

      expect(response.status).toBe(200);
      expect(stripeMocks.updateSubscription).not.toHaveBeenCalled();

      const [stored] = await db
        .select()
        .from(orgSubscriptions)
        .where(eq(orgSubscriptions.organizationId, org!.id));
      expect(stored?.billingStartsAt?.toISOString()).toBe(
        originalDate.toISOString(),
      );
      expect(stored?.status).toBe(remoteStatus);
    },
  );
});