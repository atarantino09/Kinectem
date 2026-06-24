import { db, orgSubscriptions, teams } from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";

export type PlanTier = "starter" | "pro" | "elite";

// Source of truth for per-tier team caps. `null` = unlimited. Mirrors the
// public marketing pricing tiers (Starter 1–15, Pro 16–40, Elite 41+).
export const PLAN_TEAM_LIMITS: Record<PlanTier, number | null> = {
  starter: 15,
  pro: 40,
  elite: null,
};

// Orgs without a selected subscription fall back to the entry tier so team
// creation is always bounded by some plan.
export const DEFAULT_PLAN: PlanTier = "starter";

export function teamLimitForPlan(plan: PlanTier): number | null {
  return PLAN_TEAM_LIMITS[plan] ?? null;
}

// Resolve the plan an org is currently on (its selected subscription, else
// the default entry tier).
export async function getOrgPlan(orgId: string): Promise<PlanTier> {
  const [sub] = await db
    .select({ plan: orgSubscriptions.plan })
    .from(orgSubscriptions)
    .where(eq(orgSubscriptions.organizationId, orgId))
    .limit(1);
  return (sub?.plan as PlanTier | undefined) ?? DEFAULT_PLAN;
}

// Count the org's active (non-archived) teams — archived teams don't consume
// a plan slot, matching the public team list.
export async function countActiveTeams(orgId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(teams)
    .where(and(eq(teams.organizationId, orgId), isNull(teams.archivedAt)));
  return row?.count ?? 0;
}
