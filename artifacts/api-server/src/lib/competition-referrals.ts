import { randomBytes } from "node:crypto";
import { db, competitionReferralCodes, competitionReferrals, competitionReferralPayments, orgSubscriptions, tournaments } from "@workspace/db";
import { eq, asc, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { PLAN_YEARLY_USD } from "./stripe-billing";

export const COMPETITION_REFERRAL_MIGRATION = {
  name: "2026-10-10-independent-competition-referrals",
  sql: `
    CREATE TABLE IF NOT EXISTS competition_referral_codes (
      competition_id uuid PRIMARY KEY REFERENCES tournaments(id) ON DELETE CASCADE,
      code text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS competition_referrals (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
      competition_id uuid REFERENCES tournaments(id) ON DELETE SET NULL,
      competition_name text NOT NULL, organization_name text NOT NULL,
      referral_code text NOT NULL, commission_bps integer NOT NULL DEFAULT 1500,
      billing_not_before timestamptz NOT NULL DEFAULT '2027-08-01T04:00:00Z',
      attributed_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS competition_referrals_competition_idx ON competition_referrals(competition_id);
    ALTER TABLE competition_referrals ADD COLUMN IF NOT EXISTS billing_not_before timestamptz NOT NULL DEFAULT '2027-08-01T04:00:00Z';
    CREATE TABLE IF NOT EXISTS competition_referral_payments (
      referral_id uuid PRIMARY KEY REFERENCES competition_referrals(id) ON DELETE CASCADE,
      stripe_invoice_id text NOT NULL UNIQUE, amount_paid_cents integer NOT NULL,
      commission_cents integer NOT NULL, currency text NOT NULL,
      paid_at timestamptz NOT NULL, verified_at timestamptz NOT NULL DEFAULT now()
    );
  `,
};

export async function referralCodeFor(competitionId: string) {
  await db.insert(competitionReferralCodes).values({
    competitionId, code: `ref-${randomBytes(8).toString("hex")}`,
  }).onConflictDoNothing();
  const [row] = await db.select().from(competitionReferralCodes).where(eq(competitionReferralCodes.competitionId, competitionId));
  if (!row) throw new Error("Could not create a unique referral code. Try again.");
  return row.code;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export async function resolveReferral(tx: Tx, code: string) {
  const [row] = await tx.select({ id: tournaments.id, name: tournaments.name, code: competitionReferralCodes.code })
    .from(competitionReferralCodes).innerJoin(tournaments, eq(tournaments.id, competitionReferralCodes.competitionId))
    .where(eq(competitionReferralCodes.code, code.trim().toLowerCase()));
  if (!row) throw new Error("Competition referral code not found. Use the referral tag, not the discount code.");
  return row;
}

// org row must already be locked: first attribution wins, including bulk retries.
export async function checkReferral(tx: Tx, orgId: string, code?: string) {
  if (!code) return null;
  const competition = await resolveReferral(tx, code);
  const [existing] = await tx.select().from(competitionReferrals).where(eq(competitionReferrals.organizationId, orgId));
  if (existing && existing.referralCode !== competition.code) {
    throw new Error(`This organization is already credited to ${existing.competitionName}. Its referral was not replaced.`);
  }
  return { competition, isNew: !existing };
}

export async function attachReferral(tx: Tx, org: { id: string; name: string }, referral: Awaited<ReturnType<typeof checkReferral>>) {
  if (!referral?.isNew) return;
  await tx.insert(competitionReferrals).values({
    organizationId: org.id, organizationName: org.name,
    competitionId: referral.competition.id, competitionName: referral.competition.name,
    referralCode: referral.competition.code,
  });
}

export function commissionForInvoice(invoice: Stripe.Invoice, expectedSubscription: string, bps: number) {
  const subscription = invoice.parent?.subscription_details?.subscription;
  const subscriptionId = typeof subscription === "string" ? subscription : subscription?.id;
  if (subscriptionId !== expectedSubscription || invoice.status !== "paid" ||
      invoice.amount_paid <= 0 || invoice.currency !== "usd" ||
      !["subscription_create", "subscription_cycle"].includes(invoice.billing_reason ?? "")) return null;
  const paidAt = invoice.status_transitions.paid_at;
  if (!paidAt) return null;
  // Exclude tax; never commission more than the cash actually collected.
  const baseCents = Math.max(0, Math.min(invoice.amount_paid, invoice.total_excluding_tax ?? invoice.amount_paid));
  return { amountPaidCents: invoice.amount_paid, commissionCents: Math.round(baseCents * bps / 10000),
    currency: invoice.currency, paidAt: new Date(paidAt * 1000), stripeInvoiceId: invoice.id };
}

export async function recordReferralInvoice(invoice: Stripe.Invoice) {
  const subscription = invoice.parent?.subscription_details?.subscription;
  const subscriptionId = typeof subscription === "string" ? subscription : subscription?.id;
  if (!subscriptionId) return;
  const [row] = await db.select({ referral: competitionReferrals, sub: orgSubscriptions })
    .from(orgSubscriptions).innerJoin(competitionReferrals, eq(competitionReferrals.organizationId, orgSubscriptions.organizationId))
    .where(eq(orgSubscriptions.stripeSubscriptionId, subscriptionId));
  if (!row) return;
  const payment = commissionForInvoice(invoice, subscriptionId, row.referral.commissionBps);
  if (!payment || payment.paidAt < row.referral.billingNotBefore ||
      Math.min(invoice.amount_paid, invoice.total_excluding_tax ?? invoice.amount_paid) < PLAN_YEARLY_USD[row.sub.plan] * 100) return;
  await db.insert(competitionReferralPayments).values({ referralId: row.referral.id, ...payment })
    .onConflictDoUpdate({ target: competitionReferralPayments.referralId, set: { ...payment, verifiedAt: new Date() },
      setWhere: sql`${competitionReferralPayments.paidAt} > ${payment.paidAt}` });
}

export async function competitionReferralReport(competitionId: string) {
  const rows = await db.select({ referral: competitionReferrals, sub: orgSubscriptions, payment: competitionReferralPayments })
    .from(competitionReferrals)
    .leftJoin(orgSubscriptions, eq(orgSubscriptions.organizationId, competitionReferrals.organizationId))
    .leftJoin(competitionReferralPayments, eq(competitionReferralPayments.referralId, competitionReferrals.id))
    .where(eq(competitionReferrals.competitionId, competitionId)).orderBy(asc(competitionReferrals.attributedAt));
  return rows.map(({ referral, sub, payment }) => ({
    organizationId: referral.organizationId, organizationName: referral.organizationName,
    attributedAt: referral.attributedAt.toISOString(), plan: sub?.plan ?? null,
    billingStartsAt: sub?.freeUntil?.toISOString() ?? sub?.billingStartsAt?.toISOString() ?? referral.billingNotBefore.toISOString(),
    status: payment ? "earned" : sub?.status === "canceled" ? "canceled" : sub ? "awaiting_payment" : "awaiting_plan",
    expectedCommissionCents: sub ? Math.round(PLAN_YEARLY_USD[sub.plan] * 100 * referral.commissionBps / 10000) : null,
    commissionCents: payment?.commissionCents ?? 0,
    paidAt: payment?.paidAt.toISOString() ?? null,
    stripeInvoiceId: payment?.stripeInvoiceId ?? null,
  }));
}
