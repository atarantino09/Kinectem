import { describe, expect, it, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  db,
  articles,
  articleTags,
  organizations,
  rosterEntries,
  teams,
  users,
} from "@workspace/db";
import { app, loginAs, request } from "./helpers";

async function getFootballTeam(): Promise<{ teamId: string; orgId: string }> {
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.name, "Westfield Athletic Club"))
    .limit(1);
  if (!org) throw new Error("Westfield org missing from seed");
  const [t] = await db
    .select()
    .from(teams)
    .where(
      and(eq(teams.organizationId, org.id), eq(teams.name, "Varsity Football")),
    )
    .limit(1);
  if (!t) throw new Error("Varsity Football missing from seed");
  return { teamId: t.id, orgId: org.id };
}

async function findUserId(email: string): Promise<string> {
  const [u] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!u) throw new Error(`User ${email} missing from seed`);
  return u.id;
}

async function setRequireTagConsent(userId: string, value: boolean) {
  await db.update(users).set({ requireTagConsent: value }).where(eq(users.id, userId));
}

async function ensureRosterPlayer(teamId: string, userId: string) {
  const existing = await db
    .select()
    .from(rosterEntries)
    .where(and(eq(rosterEntries.teamId, teamId), eq(rosterEntries.userId, userId)))
    .limit(1);
  if (existing.length > 0) {
    await db
      .update(rosterEntries)
      .set({ status: "accepted", role: "player" })
      .where(and(eq(rosterEntries.teamId, teamId), eq(rosterEntries.userId, userId)));
  } else {
    await db.insert(rosterEntries).values({
      teamId,
      userId,
      role: "player",
      status: "accepted",
      position: "Util",
    });
  }
}

describe("auto-tag rostered players on game-recap articles", () => {
  beforeEach(async () => {
    // Reset consent flags so tests are independent.
    await db
      .update(users)
      .set({ requireTagConsent: false })
      .where(eq(users.email, "lisa@kinectem.demo"));
    await db
      .update(users)
      .set({ requireTagConsent: false })
      .where(eq(users.email, "samira@kinectem.demo"));
    await db
      .update(users)
      .set({ requireTagConsent: false })
      .where(eq(users.email, "marcus@kinectem.demo"));
  });

  it("auto-tags every accepted player when a recap is posted (and only players)", async () => {
    const { teamId, orgId } = await getFootballTeam();
    const { agent: coach, user: coachUser } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );

    const before = Date.now();
    const res = await coach.post("/api/v1/posts").send({
      postType: "long",
      organizationId: orgId,
      title: "Westfield 34, Cranford 14",
      body: "A statement win on opening night.",
      gameDate: new Date("2025-09-12T19:00:00Z").toISOString(),
      opponentName: "Cranford",
      gameScore: "34-14",
    });
    expect(res.status).toBe(201);
    expect(res.body.postType).toBe("long");
    expect(res.body.id).toMatch(/^article-/);

    const articleId = res.body.id.replace(/^article-/, "");
    const [a] = await db
      .select()
      .from(articles)
      .where(eq(articles.id, articleId))
      .limit(1);
    expect(a).toBeTruthy();
    // Game metadata persisted (otherwise the heuristic would never fire).
    expect(a.gameDate).toBeTruthy();
    expect(a.opponentName).toBe("Cranford");
    expect(a.teamScore).toBe(34);
    expect(a.opponentScore).toBe(14);
    expect(a.teamId).toBe(teamId);
    expect(a.createdAt.getTime()).toBeGreaterThanOrEqual(before - 1000);

    // The fan-out should produce one tag per accepted player on the
    // team — no rows for the head coach, no rows for non-team users.
    const tags = await db
      .select()
      .from(articleTags)
      .where(eq(articleTags.articleId, articleId));
    const taggedIds = new Set(tags.map((t) => t.userId));

    const accepted = await db
      .select({ userId: rosterEntries.userId, role: rosterEntries.role })
      .from(rosterEntries)
      .where(
        and(eq(rosterEntries.teamId, teamId), eq(rosterEntries.status, "accepted")),
      );
    const expectedPlayers = accepted
      .filter((r) => r.role === "player")
      .map((r) => r.userId);
    const expectedNonPlayers = accepted
      .filter((r) => r.role !== "player")
      .map((r) => r.userId);

    for (const uid of expectedPlayers) {
      expect(taggedIds.has(uid)).toBe(true);
    }
    for (const uid of expectedNonPlayers) {
      expect(taggedIds.has(uid)).toBe(false);
    }
    // Coach is the tagger on every row, never the taggee.
    for (const t of tags) {
      expect(t.taggerUserId).toBe(coachUser.id);
      expect(t.userId).not.toBe(coachUser.id);
    }
    // Without consent flags, every tag is auto-approved.
    for (const t of tags) {
      expect(t.status).toBe("approved");
    }
  });

  it("marks tags as pending when the player or their parent has requireTagConsent=true", async () => {
    const { teamId, orgId } = await getFootballTeam();
    const samiraId = await findUserId("samira@kinectem.demo");
    const lisaId = await findUserId("lisa@kinectem.demo");
    const marcusId = await findUserId("marcus@kinectem.demo");

    // Samira is on Varsity Basketball in the seed; put her on
    // Varsity Football too so we can exercise the parent-consent path.
    await ensureRosterPlayer(teamId, samiraId);

    // Parent (Lisa) requires consent; Samira's tag should be pending.
    await setRequireTagConsent(lisaId, true);
    // Marcus opts in to consent on his own account; his tag should be pending.
    await setRequireTagConsent(marcusId, true);

    const { agent: coach } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );
    const res = await coach.post("/api/v1/posts").send({
      postType: "long",
      organizationId: orgId,
      title: "Westfield 21, Hillside 7",
      body: "Defense came to play.",
      gameDate: new Date("2025-09-19T19:00:00Z").toISOString(),
      opponentName: "Hillside",
      gameScore: "21-7",
    });
    expect(res.status).toBe(201);

    const articleId = res.body.id.replace(/^article-/, "");
    const tagRows = await db
      .select()
      .from(articleTags)
      .where(eq(articleTags.articleId, articleId));
    const byUser = new Map(tagRows.map((t) => [t.userId, t.status]));

    expect(byUser.get(samiraId)).toBe("pending"); // via parent
    expect(byUser.get(marcusId)).toBe("pending"); // via self

    // Other players still approved.
    const jordanId = await findUserId("jordan@kinectem.demo");
    expect(byUser.get(jordanId)).toBe("approved");
  });

  it("dedupes explicit taggedUserIds with the auto-tag fan-out and lets pending win", async () => {
    const { teamId, orgId } = await getFootballTeam();
    const samiraId = await findUserId("samira@kinectem.demo");
    const lisaId = await findUserId("lisa@kinectem.demo");
    await ensureRosterPlayer(teamId, samiraId);
    await setRequireTagConsent(lisaId, true);

    const { agent: coach } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );
    const jordanId = await findUserId("jordan@kinectem.demo");
    const res = await coach.post("/api/v1/posts").send({
      postType: "long",
      organizationId: orgId,
      title: "Westfield 28, Linden 10",
      body: "Three TDs and a stop.",
      gameDate: new Date("2025-09-26T19:00:00Z").toISOString(),
      opponentName: "Linden",
      gameScore: "28-10",
      // Both already on the roster; coach passes them explicitly.
      // Samira (consent-required) must remain pending despite explicit
      // approval; Jordan stays approved as a single deduped row.
      taggedUserIds: [samiraId, jordanId],
    });
    expect(res.status).toBe(201);
    const articleId = res.body.id.replace(/^article-/, "");
    const tagRows = await db
      .select()
      .from(articleTags)
      .where(eq(articleTags.articleId, articleId));
    const samiraRows = tagRows.filter((t) => t.userId === samiraId);
    const jordanRows = tagRows.filter((t) => t.userId === jordanId);
    expect(samiraRows).toHaveLength(1);
    expect(jordanRows).toHaveLength(1);
    expect(samiraRows[0].status).toBe("pending");
    expect(jordanRows[0].status).toBe("approved");
  });

  it("does not auto-tag when gameDate is omitted (regular long-form post)", async () => {
    const { orgId } = await getFootballTeam();
    const { agent: coach } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );
    const res = await coach.post("/api/v1/posts").send({
      postType: "long",
      organizationId: orgId,
      title: "Coach's column: leadership in week 3",
      body: "Just a thought piece, not a recap.",
    });
    expect(res.status).toBe(201);
    const articleId = res.body.id.replace(/^article-/, "");
    const tagRows = await db
      .select()
      .from(articleTags)
      .where(eq(articleTags.articleId, articleId));
    expect(tagRows).toHaveLength(0);
  });
});

describe("GET /users/:userId/posts merges authored + tagged", () => {
  beforeEach(async () => {
    await db
      .update(users)
      .set({ requireTagConsent: false })
      .where(eq(users.email, "lisa@kinectem.demo"));
    await db
      .update(users)
      .set({ requireTagConsent: false })
      .where(eq(users.email, "samira@kinectem.demo"));
    await db
      .update(users)
      .set({ requireTagConsent: false })
      .where(eq(users.email, "marcus@kinectem.demo"));
  });

  it("hides pending-tag articles from strangers but shows them to self/parent with tagStatus=pending", async () => {
    const { teamId, orgId } = await getFootballTeam();
    const samiraId = await findUserId("samira@kinectem.demo");
    const lisaId = await findUserId("lisa@kinectem.demo");
    await ensureRosterPlayer(teamId, samiraId);
    await setRequireTagConsent(lisaId, true);

    // Coach posts a recap; Samira will be auto-tagged as pending.
    const { agent: coach } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );
    const created = await coach.post("/api/v1/posts").send({
      postType: "long",
      organizationId: orgId,
      title: "Westfield 14, Roselle 3",
      body: "Grind-it-out win.",
      gameDate: new Date("2025-10-03T19:00:00Z").toISOString(),
      opponentName: "Roselle",
      gameScore: "14-3",
    });
    expect(created.status).toBe(201);
    const expectedPostId = created.body.id;

    // Stranger viewer (an unrelated logged-in user) should NOT see it.
    const { agent: stranger } = await loginAs(
      (u) => u.email === "marcus@kinectem.demo",
    );
    const strangerRes = await stranger.get(`/api/v1/users/${samiraId}/posts`);
    expect(strangerRes.status).toBe(200);
    const strangerIds = (strangerRes.body.data ?? strangerRes.body.items ?? []).map(
      (p: { id: string }) => p.id,
    );
    expect(strangerIds).not.toContain(expectedPostId);

    // Samira herself should see it with tagStatus=pending.
    const { agent: self } = await loginAs(
      (u) => u.email === "samira@kinectem.demo",
    );
    const selfRes = await self.get(`/api/v1/users/${samiraId}/posts`);
    expect(selfRes.status).toBe(200);
    const selfList = (selfRes.body.data ?? selfRes.body.items ?? []) as Array<{
      id: string;
      tagStatus?: string | null;
    }>;
    const selfHit = selfList.find((p) => p.id === expectedPostId);
    expect(selfHit).toBeTruthy();
    expect(selfHit?.tagStatus).toBe("pending");

    // Parent (Lisa) viewing her child's profile should also see it.
    const { agent: parent } = await loginAs(
      (u) => u.email === "lisa@kinectem.demo",
    );
    const parentRes = await parent.get(`/api/v1/users/${samiraId}/posts`);
    expect(parentRes.status).toBe(200);
    const parentList = (parentRes.body.data ?? parentRes.body.items ?? []) as Array<{
      id: string;
      tagStatus?: string | null;
    }>;
    const parentHit = parentList.find((p) => p.id === expectedPostId);
    expect(parentHit).toBeTruthy();
    expect(parentHit?.tagStatus).toBe("pending");
  });

  it("shows approved-tag recaps to strangers with no tagStatus annotation", async () => {
    const { teamId, orgId } = await getFootballTeam();
    const marcusId = await findUserId("marcus@kinectem.demo");

    const { agent: coach } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );
    const created = await coach.post("/api/v1/posts").send({
      postType: "long",
      organizationId: orgId,
      title: "Westfield 17, Plainfield 7",
      body: "Big road win.",
      gameDate: new Date("2025-10-10T19:00:00Z").toISOString(),
      opponentName: "Plainfield",
      gameScore: "17-7",
    });
    expect(created.status).toBe(201);
    const expectedPostId = created.body.id;

    // Stranger viewer — Marcus is not consent-required, so the tag is
    // approved and visible to anyone hitting his profile.
    const { agent: stranger } = await loginAs(
      (u) => u.email === "lisa@kinectem.demo",
    );
    const res = await stranger.get(`/api/v1/users/${marcusId}/posts`);
    expect(res.status).toBe(200);
    const list = (res.body.data ?? res.body.items ?? []) as Array<{
      id: string;
      tagStatus?: string | null;
    }>;
    const hit = list.find((p) => p.id === expectedPostId);
    expect(hit).toBeTruthy();
    // Approved tags do NOT carry a tagStatus annotation.
    expect(hit?.tagStatus ?? null).toBeNull();
    expect(teamId).toBeTruthy(); // team plumbing is exercised above
  });

  it("never surfaces declined or removed tags — even to self/parent/admin", async () => {
    const { teamId, orgId } = await getFootballTeam();
    const samiraId = await findUserId("samira@kinectem.demo");
    const lisaId = await findUserId("lisa@kinectem.demo");
    await ensureRosterPlayer(teamId, samiraId);
    await setRequireTagConsent(lisaId, true);

    const { agent: coach } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );
    const created = await coach.post("/api/v1/posts").send({
      postType: "long",
      organizationId: orgId,
      title: "Westfield 24, Scotch Plains 6",
      body: "Workmanlike.",
      gameDate: new Date("2025-10-17T19:00:00Z").toISOString(),
      opponentName: "Scotch Plains",
      gameScore: "24-6",
    });
    expect(created.status).toBe(201);
    const articleId = created.body.id.replace(/^article-/, "");

    // Samira (or her parent on her behalf) declines the tag.
    await db
      .update(articleTags)
      .set({ status: "declined" })
      .where(
        and(
          eq(articleTags.articleId, articleId),
          eq(articleTags.userId, samiraId),
        ),
      );

    // Self should NOT see it (declined drops off her profile feed).
    const { agent: self } = await loginAs(
      (u) => u.email === "samira@kinectem.demo",
    );
    const selfRes = await self.get(`/api/v1/users/${samiraId}/posts`);
    expect(selfRes.status).toBe(200);
    const selfList = (selfRes.body.data ?? selfRes.body.items ?? []) as Array<{
      id: string;
    }>;
    expect(selfList.find((p) => p.id === created.body.id)).toBeUndefined();

    // Parent should NOT see it either.
    const { agent: parent } = await loginAs(
      (u) => u.email === "lisa@kinectem.demo",
    );
    const parentRes = await parent.get(`/api/v1/users/${samiraId}/posts`);
    const parentList = (parentRes.body.data ?? parentRes.body.items ?? []) as Array<{
      id: string;
    }>;
    expect(parentList.find((p) => p.id === created.body.id)).toBeUndefined();

    // Admin should NOT see it either — declined means declined.
    const { agent: admin } = await loginAs(
      (u) => u.email === "andrew@kinectem.com",
    );
    const adminRes = await admin.get(`/api/v1/users/${samiraId}/posts`);
    const adminList = (adminRes.body.data ?? adminRes.body.items ?? []) as Array<{
      id: string;
    }>;
    expect(adminList.find((p) => p.id === created.body.id)).toBeUndefined();
  });

  it("orders tagged posts by gameDate desc nulls last", async () => {
    const { orgId } = await getFootballTeam();
    const marcusId = await findUserId("marcus@kinectem.demo");

    const { agent: coach } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );
    const older = await coach.post("/api/v1/posts").send({
      postType: "long",
      organizationId: orgId,
      title: "Westfield 7, Westfield-East 0",
      body: "Scrappy preseason.",
      gameDate: new Date("2025-08-22T19:00:00Z").toISOString(),
      opponentName: "Westfield East",
      gameScore: "7-0",
    });
    expect(older.status).toBe(201);
    const newer = await coach.post("/api/v1/posts").send({
      postType: "long",
      organizationId: orgId,
      title: "Westfield 42, Summit 0",
      body: "Statement game.",
      gameDate: new Date("2025-11-07T19:00:00Z").toISOString(),
      opponentName: "Summit",
      gameScore: "42-0",
    });
    expect(newer.status).toBe(201);

    const { agent } = await loginAs(
      (u) => u.email === "marcus@kinectem.demo",
    );
    const res = await agent.get(`/api/v1/users/${marcusId}/posts`);
    expect(res.status).toBe(200);
    const list = (res.body.data ?? res.body.items ?? []) as Array<{ id: string }>;
    const idxNewer = list.findIndex((p) => p.id === newer.body.id);
    const idxOlder = list.findIndex((p) => p.id === older.body.id);
    expect(idxNewer).toBeGreaterThanOrEqual(0);
    expect(idxOlder).toBeGreaterThanOrEqual(0);
    expect(idxNewer).toBeLessThan(idxOlder);
  });
});

// Reference unused imports so the test file still typechecks even if
// Vitest's tree-shaking changes; harmless at runtime.
void app;
void request;
