// Task #400 — guardian capability check.
//
// "Guardian" capability is derived from the actual parent↔child link
// (`users.parentId`), not from the caller's `role` string. A coach (or
// any other role) can legitimately also be a parent of a kid on the
// platform, so the Family dashboard and guardian-only endpoints must
// gate on "has at least one linked child" rather than `role === "parent"`.

import { db, users } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

export async function countLinkedChildren(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(eq(users.parentId, userId));
  return row?.n ?? 0;
}

export async function isGuardian(userId: string): Promise<boolean> {
  return (await countLinkedChildren(userId)) > 0;
}
