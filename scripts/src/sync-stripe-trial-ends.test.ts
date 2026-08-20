import assert from "node:assert/strict";
import test from "node:test";
import {
  stripeTrialNeedsExtension,
  stripeTrialTargetMs,
} from "./sync-stripe-trial-ends";

test("a Stripe trial seconds before the legacy floor must be extended", () => {
  const targetMs = stripeTrialTargetMs(
    new Date("2026-11-01T00:00:00.000Z"),
    new Date("2026-08-20T00:00:00.000Z"),
  );

  assert.equal(targetMs, Date.parse("2026-11-01T00:00:00.000Z"));
  assert.equal(
    stripeTrialNeedsExtension(
      Date.parse("2026-10-31T23:59:30.000Z") / 1000,
      targetMs,
    ),
    true,
  );
});

test("an exact or later Stripe trial is not moved backward", () => {
  const targetMs = Date.parse("2026-11-01T00:00:00.000Z");

  assert.equal(stripeTrialNeedsExtension(targetMs / 1000, targetMs), false);
  assert.equal(
    stripeTrialNeedsExtension(
      Date.parse("2026-11-02T00:00:00.000Z") / 1000,
      targetMs,
    ),
    false,
  );
});