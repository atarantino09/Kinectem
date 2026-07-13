// Task #400 — guardian capability check.
//
// "Guardian" capability is derived from the actual parent↔child link, not
// from the caller's `role` string. A coach (or any other role) can
// legitimately also be a parent of a kid on the platform, so the Family
// dashboard and guardian-only endpoints must gate on "has at least one
// linked child" rather than `role === "parent"`.
//
// Task #755 — links now live in `guardian_links` (multi-guardian). A user
// counts as a guardian when they hold at least one ACTIVE link.

import { db, guardianLinks } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";

export async function countLinkedChildren(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(distinct ${guardianLinks.childId})::int` })
    .from(guardianLinks)
    .where(
      and(
        eq(guardianLinks.guardianId, userId),
        eq(guardianLinks.status, "active"),
      ),
    );
  return row?.n ?? 0;
}

export async function isGuardian(userId: string): Promise<boolean> {
  return (await countLinkedChildren(userId)) > 0;
}
