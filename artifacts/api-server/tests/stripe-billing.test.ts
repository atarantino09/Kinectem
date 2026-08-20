import { afterEach, describe, expect, it, vi } from "vitest";

const { getStripeClient } = vi.hoisted(() => ({
  getStripeClient: vi.fn(),
}));

vi.mock("../src/lib/stripeClient.js", () => ({ getStripeClient }));

import {
  LEGACY_FIRST_CHARGE_FLOOR_ISO,
  billingStartAtOrAfterPolicy,
  billingStartDate,
  createCardOnFileCheckout,
  ensureStripeTrialEndAtPolicy,
  policyBillingStartDate,
} from "../src/lib/stripe-billing";

afterEach(() => {
  vi.useRealTimers();
  getStripeClient.mockReset();
});

describe("organization billing date policy", () => {
  it("defers a pre-rollout organization to November 1", () => {
    const createdAt = new Date("2026-07-01T12:00:00.000Z");
    const now = new Date("2026-08-20T12:00:00.000Z");

    expect(billingStartDate(createdAt, now).toISOString()).toBe(
      LEGACY_FIRST_CHARGE_FLOOR_ISO,
    );
  });

  it("does not shorten a legacy organization's later rolling date", () => {
    const createdAt = new Date("2026-08-19T12:00:00.000Z");

    expect(policyBillingStartDate(createdAt).toISOString()).toBe(
      "2026-11-17T12:00:00.000Z",
    );
  });

  it("keeps the rolling 90-day date for post-cutoff organizations", () => {
    const createdAt = new Date("2026-09-01T12:00:00.000Z");

    expect(policyBillingStartDate(createdAt).toISOString()).toBe(
      "2026-11-30T12:00:00.000Z",
    );
  });

  it("treats an organization created exactly at the cutoff as post-cutoff", () => {
    const createdAt = new Date("2026-08-20T00:00:00.000Z");

    expect(policyBillingStartDate(createdAt).toISOString()).toBe(
      "2026-11-18T00:00:00.000Z",
    );
  });

  it("never accepts a persisted legacy date below the floor", () => {
    const createdAt = new Date("2026-06-01T00:00:00.000Z");
    const staleDate = new Date("2026-09-15T00:00:00.000Z");

    expect(
      billingStartAtOrAfterPolicy(createdAt, staleDate).toISOString(),
    ).toBe(LEGACY_FIRST_CHARGE_FLOOR_ISO);
  });

  it("preserves a persisted date later than the policy floor", () => {
    const createdAt = new Date("2026-06-01T00:00:00.000Z");
    const laterDate = new Date("2026-11-15T00:00:00.000Z");

    expect(
      billingStartAtOrAfterPolicy(createdAt, laterDate).toISOString(),
    ).toBe(laterDate.toISOString());
  });

  it("sends the deferred persisted date to Stripe Checkout", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T12:00:00.000Z"));

    const createSession = vi.fn().mockResolvedValue({
      url: "https://checkout.stripe.test/session",
    });
    getStripeClient.mockResolvedValue({
      prices: {
        list: vi.fn().mockResolvedValue({ data: [{ id: "price_starter" }] }),
      },
      checkout: { sessions: { create: createSession } },
    });

    const result = await createCardOnFileCheckout({
      orgId: "00000000-0000-4000-8000-000000000878",
      plan: "starter",
      customerEmail: "owner@example.test",
      existingCustomerId: null,
      promo: null,
      orgCreatedAt: new Date("2026-06-01T00:00:00.000Z"),
      billingStartsAt: new Date("2026-09-15T00:00:00.000Z"),
    });

    expect(result).toEqual({
      url: "https://checkout.stripe.test/session",
      trialEnd: new Date(LEGACY_FIRST_CHARGE_FLOOR_ISO),
    });
    expect(createSession).toHaveBeenCalledOnce();
    const params = createSession.mock.calls[0]![0];
    expect(params.subscription_data.trial_end).toBe(
      Math.floor(new Date(LEGACY_FIRST_CHARGE_FLOOR_ISO).getTime() / 1000),
    );
  });

  it.each([
    {
      label: "post-cutoff org after day 90",
      orgCreatedAt: "2026-09-01T00:00:00.000Z",
      persisted: "2026-11-30T00:00:00.000Z",
    },
    {
      label: "legacy org whose rolling date was already after November 1",
      orgCreatedAt: "2026-08-19T00:00:00.000Z",
      persisted: "2026-11-17T00:00:00.000Z",
    },
  ])(
    "uses Stripe's future minimum for a late Checkout: $label",
    async ({ orgCreatedAt, persisted }) => {
      const now = new Date("2027-01-01T00:00:00.000Z");
      const expected = new Date("2027-01-03T01:00:00.000Z");
      vi.useFakeTimers();
      vi.setSystemTime(now);

      const createSession = vi.fn().mockResolvedValue({
        url: "https://checkout.stripe.test/late-session",
      });
      getStripeClient.mockResolvedValue({
        prices: {
          list: vi.fn().mockResolvedValue({ data: [{ id: "price_starter" }] }),
        },
        checkout: { sessions: { create: createSession } },
      });

      const result = await createCardOnFileCheckout({
        orgId: "00000000-0000-4000-8000-000000000879",
        plan: "starter",
        customerEmail: "owner@example.test",
        existingCustomerId: null,
        promo: null,
        orgCreatedAt: new Date(orgCreatedAt),
        billingStartsAt: new Date(persisted),
      });

      expect(result).toEqual({
        url: "https://checkout.stripe.test/late-session",
        trialEnd: expected,
      });
      const params = createSession.mock.calls[0]![0];
      expect(params.subscription_data.trial_end).toBe(
        expected.getTime() / 1000,
      );
    },
  );

  it("extends a verified pre-release Stripe trial during reconciliation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T12:00:00.000Z"));
    const updateSubscription = vi.fn().mockResolvedValue({});
    getStripeClient.mockResolvedValue({
      subscriptions: { update: updateSubscription },
    });

    const result = await ensureStripeTrialEndAtPolicy({
      subscriptionId: "sub_pre_release",
      status: "trialing",
      trialEnd: new Date("2026-10-15T00:00:00.000Z"),
      orgCreatedAt: new Date("2026-06-01T00:00:00.000Z"),
    });

    expect(result).toEqual({
      trialEnd: new Date(LEGACY_FIRST_CHARGE_FLOOR_ISO),
    });
    expect(updateSubscription).toHaveBeenCalledWith("sub_pre_release", {
      trial_end: Date.parse(LEGACY_FIRST_CHARGE_FLOOR_ISO) / 1000,
      proration_behavior: "none",
    });
  });
});