import { describe, expect, it } from "vitest";
import { db, userFollowers, postReactions, postComments, postShares } from "@workspace/db";
import { sql } from "drizzle-orm";
import { seedIfEmpty } from "../src/lib/seed";
import { loginAs, findUser } from "./helpers";

// ---------------------------------------------------------------------------
// Demo activity seeding
// ---------------------------------------------------------------------------
//
// The empty home feed after logging in as a demo user came from two issues:
// the login page no longer surfaced the demo accounts, and the seed only
// created authored posts (no follows / reactions / comments). With those
// gone, the personalized feed for every demo user was empty and only the
// discover-fallback (Task #182) saved it from being a blank screen.
//
// These tests pin the new contract: a freshly-seeded DB has demo follows,
// reactions, comments, and ≥2 shares; and signing in as Lisa (a parent who
// follows Coach) returns Coach's recap articles via the personalized feed
// path — proving the follow graph actually feeds the feed query.

describe("Demo activity seed", () => {
  it("creates user-to-user follows for the demo accounts", async () => {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(userFollowers);
    expect(count).toBeGreaterThan(0);
  });

  it("creates reactions on at least one seeded recap or highlight", async () => {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(postReactions);
    expect(count).toBeGreaterThan(0);
  });

  it("creates a few demo comments on seeded recaps", async () => {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(postComments);
    expect(count).toBeGreaterThan(0);
  });

  it("seeds at least two recap shares so re-shares show up in feeds", async () => {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(postShares);
    expect(count).toBeGreaterThanOrEqual(2);
  });
});

describe("Personalized feed for demo users", () => {
  it("returns Coach's recap articles in Lisa's home feed (she follows Coach)", async () => {
    const coach = await findUser((u) => u.email === "coach@kinectem.demo");
    const { agent } = await loginAs("lisa@kinectem.demo");
    const res = await agent.get("/api/v1/feed");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    // Lisa follows Coach in the demo activity seed. Coach authored the
    // seeded recap articles, so the personalized feed must include at
    // least one item authored by him — proof the follow graph wired
    // through to the feed query (and not the discover fallback path).
    const authorIds = res.body.data
      .map((p: { author?: { id?: string } }) => p.author?.id)
      .filter((x: unknown): x is string => typeof x === "string");
    expect(authorIds).toContain(coach.id);
  });

  it("Lisa's seeded follow graph is non-empty (so discover fallback cannot trigger)", async () => {
    // The discover fallback only kicks in when the viewer has zero
    // follows AND no own posts/shares. Asserting Lisa has follows here
    // closes the loophole on the previous test: even though Coach also
    // appears in the discover fallback's output, the feed Lisa receives
    // is provably the personalized merge — not the fallback — because
    // the fallback branch is unreachable for a viewer with follows.
    const lisa = await findUser((u) => u.email === "lisa@kinectem.demo");
    const rows = await db
      .select({ id: userFollowers.followingUserId })
      .from(userFollowers)
      .where(sql`${userFollowers.followerUserId} = ${lisa.id}`);
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe("Demo activity seed idempotency", () => {
  it("does not duplicate rows when seedIfEmpty runs again", async () => {
    // Snapshot every activity table's row count, run the seeder again
    // (it goes down the "already seeded" branch which calls the
    // backfill helper), and assert nothing changed. This pins the
    // onConflictDoNothing + comment-pre-check guarantees against
    // future regressions where someone forgets the conflict clause.
    const beforeFollows = await db.select({ c: sql<number>`count(*)::int` }).from(userFollowers);
    const beforeReactions = await db.select({ c: sql<number>`count(*)::int` }).from(postReactions);
    const beforeComments = await db.select({ c: sql<number>`count(*)::int` }).from(postComments);
    const beforeShares = await db.select({ c: sql<number>`count(*)::int` }).from(postShares);

    await seedIfEmpty();

    const afterFollows = await db.select({ c: sql<number>`count(*)::int` }).from(userFollowers);
    const afterReactions = await db.select({ c: sql<number>`count(*)::int` }).from(postReactions);
    const afterComments = await db.select({ c: sql<number>`count(*)::int` }).from(postComments);
    const afterShares = await db.select({ c: sql<number>`count(*)::int` }).from(postShares);

    expect(afterFollows[0]!.c).toBe(beforeFollows[0]!.c);
    expect(afterReactions[0]!.c).toBe(beforeReactions[0]!.c);
    expect(afterComments[0]!.c).toBe(beforeComments[0]!.c);
    expect(afterShares[0]!.c).toBe(beforeShares[0]!.c);
  });
});
