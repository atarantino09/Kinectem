import { describe, expect, it, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  db,
  articles,
  articleAuthors,
  articleTags,
  notifications,
  organizationAdmins,
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

  it("fires the fan-out at publish when gameDate is added to a draft", async () => {
    // The most common path the user actually hits: coach saves a
    // draft from the form (no game date yet, so no tags), edits the
    // draft to add the game date, then publishes. The fan-out must
    // fire at publish time — Task #94's create-time hook alone misses
    // this path entirely.
    const { teamId, orgId } = await getFootballTeam();
    const { agent: coach } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );

    // 1) Create as draft, no game date.
    const draft = await coach.post("/api/v1/posts").send({
      postType: "long",
      organizationId: orgId,
      title: "Draft recap",
      body: "Wrote this in the locker room.",
      status: "draft",
    });
    expect(draft.status).toBe(201);
    const draftPostId = draft.body.id;
    const articleId = draftPostId.replace(/^article-/, "");

    // No tags yet — exactly the bug #108 was filed for.
    let tagRows = await db
      .select()
      .from(articleTags)
      .where(eq(articleTags.articleId, articleId));
    expect(tagRows).toHaveLength(0);

    // 2) PATCH the draft to add the game date.
    const patched = await coach.patch(`/api/v1/posts/${draftPostId}`).send({
      gameDate: new Date("2025-09-12T19:00:00Z").toISOString(),
    });
    expect(patched.status).toBe(200);

    // PATCH alone does NOT run the fan-out — that fires at publish.
    tagRows = await db
      .select()
      .from(articleTags)
      .where(eq(articleTags.articleId, articleId));
    expect(tagRows).toHaveLength(0);

    // 3) Publish — this is when the roster is fanned out.
    const published = await coach
      .post(`/api/v1/posts/${draftPostId}/publish`)
      .send();
    expect(published.status).toBe(200);

    tagRows = await db
      .select()
      .from(articleTags)
      .where(eq(articleTags.articleId, articleId));
    const taggedIds = new Set(tagRows.map((t) => t.userId));
    const accepted = await db
      .select({ userId: rosterEntries.userId, role: rosterEntries.role })
      .from(rosterEntries)
      .where(
        and(eq(rosterEntries.teamId, teamId), eq(rosterEntries.status, "accepted")),
      );
    const expectedPlayers = accepted
      .filter((r) => r.role === "player")
      .map((r) => r.userId);
    expect(expectedPlayers.length).toBeGreaterThan(0);
    for (const uid of expectedPlayers) {
      expect(taggedIds.has(uid)).toBe(true);
    }
  });

  it("clears gameDate when PATCH passes null and stops marking the article as a recap", async () => {
    const { orgId } = await getFootballTeam();
    const { agent: coach } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );

    // Save as draft with a date, then clear it via PATCH null. The
    // article should no longer carry a gameDate (and the publish
    // path will skip the fan-out as a result).
    const draft = await coach.post("/api/v1/posts").send({
      postType: "long",
      organizationId: orgId,
      title: "Wrong date",
      body: "Oops, wrong week.",
      status: "draft",
      gameDate: new Date("2025-09-12T19:00:00Z").toISOString(),
    });
    expect(draft.status).toBe(201);
    const articleId = draft.body.id.replace(/^article-/, "");

    const cleared = await coach.patch(`/api/v1/posts/${draft.body.id}`).send({
      gameDate: null,
    });
    expect(cleared.status).toBe(200);

    const [a] = await db
      .select()
      .from(articles)
      .where(eq(articles.id, articleId))
      .limit(1);
    expect(a.gameDate).toBeNull();
  });

  it("never inserts duplicate tags when fan-out runs more than once", async () => {
    // Idempotency guard. The create handler runs the fan-out, and
    // the publish handler runs it again whenever it gets a draft
    // with gameDate. For an article that's published immediately
    // (status != draft) and then later re-published, the second
    // pass must not produce duplicate article_tags rows.
    const { teamId, orgId } = await getFootballTeam();
    const { agent: coach } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );
    const created = await coach.post("/api/v1/posts").send({
      postType: "long",
      organizationId: orgId,
      title: "Westfield 49, Madison 0",
      body: "Total domination.",
      gameDate: new Date("2025-11-14T19:00:00Z").toISOString(),
    });
    expect(created.status).toBe(201);
    const postId = created.body.id;
    const articleId = postId.replace(/^article-/, "");

    const before = await db
      .select()
      .from(articleTags)
      .where(eq(articleTags.articleId, articleId));
    expect(before.length).toBeGreaterThan(0);

    // Re-trigger publish on an already-published article. The
    // helper does per-user dedupe, so the second call must be a
    // no-op for already-tagged users.
    const republished = await coach
      .post(`/api/v1/posts/${postId}/publish`)
      .send();
    expect(republished.status).toBe(200);

    const after = await db
      .select()
      .from(articleTags)
      .where(eq(articleTags.articleId, articleId));
    expect(after).toHaveLength(before.length);

    // Sanity-check: same set of users, same statuses — nothing
    // re-flipped (e.g., a player who declined isn't re-approved).
    const beforeKey = before.map((t) => `${t.userId}:${t.status}`).sort();
    const afterKey = after.map((t) => `${t.userId}:${t.status}`).sort();
    expect(afterKey).toEqual(beforeKey);
    expect(teamId).toBeTruthy();
  });

  it("fills in missing roster tags at publish without disturbing pre-existing ones", async () => {
    // Regression test for the partial-tag case the architect flagged:
    // if an article already has SOME tags (e.g., manual tags from
    // another path, or a previous fan-out that didn't cover everyone),
    // publishing must still tag the rest of the roster — and must
    // leave existing tag statuses (approved/pending/declined) alone.
    const { teamId, orgId } = await getFootballTeam();
    const { agent: coach } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );

    // Create a draft (no fan-out yet — no gameDate).
    const draft = await coach.post("/api/v1/posts").send({
      postType: "long",
      organizationId: orgId,
      title: "Partial-tag regression",
      body: "Some players manually tagged before publish.",
      status: "draft",
    });
    expect(draft.status).toBe(201);
    const postId = draft.body.id;
    const articleId = postId.replace(/^article-/, "");

    // Hand-insert one tag for one rostered player with a non-default
    // status. This simulates a tag created by some other path.
    const accepted = await db
      .select({ userId: rosterEntries.userId })
      .from(rosterEntries)
      .where(
        and(
          eq(rosterEntries.teamId, teamId),
          eq(rosterEntries.role, "player"),
          eq(rosterEntries.status, "accepted"),
        ),
      );
    expect(accepted.length).toBeGreaterThan(1);
    const seedUserId = accepted[0].userId;
    await db.insert(articleTags).values({
      articleId,
      userId: seedUserId,
      taggerUserId: null,
      status: "declined",
    });

    // Add the game date and publish.
    await coach
      .patch(`/api/v1/posts/${postId}`)
      .send({ gameDate: new Date("2025-12-05T19:00:00Z").toISOString() });
    const published = await coach.post(`/api/v1/posts/${postId}/publish`).send();
    expect(published.status).toBe(200);

    // The seed tag must be untouched (still "declined", not flipped
    // to "approved" by the fan-out).
    const seedRows = await db
      .select()
      .from(articleTags)
      .where(
        and(eq(articleTags.articleId, articleId), eq(articleTags.userId, seedUserId)),
      );
    expect(seedRows).toHaveLength(1);
    expect(seedRows[0].status).toBe("declined");

    // Every other accepted player on the roster must have been
    // tagged exactly once.
    const allTags = await db
      .select()
      .from(articleTags)
      .where(eq(articleTags.articleId, articleId));
    const taggedSet = new Set(allTags.map((t) => t.userId));
    for (const r of accepted) {
      expect(taggedSet.has(r.userId)).toBe(true);
    }
    // No duplicates: tag count == distinct user count.
    expect(allTags.length).toBe(taggedSet.size);
  });

  // ---------- Edit-published-recap fan-out maintenance ----------
  // These tests cover the path where a coach publishes a recap and
  // then later edits it to flip the "tag every rostered player"
  // checkbox. The PATCH handler must run the fan-out when gameDate
  // goes null -> non-null and must remove ONLY auto rows when it
  // goes non-null -> null (manual @-mention tags survive).

  it("PATCH null->date on a published recap fans out missing roster tags as auto", async () => {
    const { teamId, orgId } = await getFootballTeam();
    const { agent: coach } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );

    // Publish a long-form post WITHOUT a gameDate — no fan-out yet.
    const created = await coach.post("/api/v1/posts").send({
      postType: "long",
      organizationId: orgId,
      title: "Off-day thoughts",
      body: "Not a recap (yet).",
    });
    expect(created.status).toBe(201);
    const postId = created.body.id;
    const articleId = postId.replace(/^article-/, "");

    // No tags yet — confirm the baseline before the edit.
    let tagRows = await db
      .select()
      .from(articleTags)
      .where(eq(articleTags.articleId, articleId));
    expect(tagRows).toHaveLength(0);

    // Coach goes back to the post and adds a gameDate. The article
    // is already published, so the PATCH handler — not the publish
    // handler — must run the fan-out.
    const patched = await coach.patch(`/api/v1/posts/${postId}`).send({
      gameDate: new Date("2025-10-17T19:00:00Z").toISOString(),
    });
    expect(patched.status).toBe(200);

    tagRows = await db
      .select()
      .from(articleTags)
      .where(eq(articleTags.articleId, articleId));
    expect(tagRows.length).toBeGreaterThan(0);
    // Every fan-out row must be marked source = "auto".
    for (const t of tagRows) {
      expect(t.source).toBe("auto");
    }
    // Sanity: every accepted player on the team is now tagged.
    const accepted = await db
      .select({ userId: rosterEntries.userId })
      .from(rosterEntries)
      .where(
        and(
          eq(rosterEntries.teamId, teamId),
          eq(rosterEntries.role, "player"),
          eq(rosterEntries.status, "accepted"),
        ),
      );
    const taggedSet = new Set(tagRows.map((t) => t.userId));
    for (const r of accepted) {
      expect(taggedSet.has(r.userId)).toBe(true);
    }
  });

  it("PATCH date->null on a published recap removes ONLY auto rows; manual @-mentions survive", async () => {
    const { teamId, orgId } = await getFootballTeam();
    const { agent: coach } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );

    // Publish a recap with gameDate so the fan-out runs and creates
    // auto rows for the whole roster.
    const jordanId = await findUserId("jordan@kinectem.demo");
    const created = await coach.post("/api/v1/posts").send({
      postType: "long",
      organizationId: orgId,
      title: "Westfield 24, Cranford 21",
      body: "OT thriller.",
      gameDate: new Date("2025-10-24T19:00:00Z").toISOString(),
      // Jordan is also passed explicitly — the create handler marks
      // explicit ids as source = "manual" (manual wins on collision).
      taggedUserIds: [jordanId],
    });
    expect(created.status).toBe(201);
    const postId = created.body.id;
    const articleId = postId.replace(/^article-/, "");

    // Confirm Jordan's row is manual and at least one other row is auto.
    const before = await db
      .select()
      .from(articleTags)
      .where(eq(articleTags.articleId, articleId));
    const jordanBefore = before.find((t) => t.userId === jordanId);
    expect(jordanBefore?.source).toBe("manual");
    expect(before.some((t) => t.source === "auto")).toBe(true);

    // Coach unchecks the "tag roster" box: PATCH sets gameDate=null.
    const patched = await coach.patch(`/api/v1/posts/${postId}`).send({
      gameDate: null,
    });
    expect(patched.status).toBe(200);

    const after = await db
      .select()
      .from(articleTags)
      .where(eq(articleTags.articleId, articleId));
    // Every remaining row must be manual.
    for (const t of after) {
      expect(t.source).toBe("manual");
    }
    // Jordan (manual) survives.
    expect(after.some((t) => t.userId === jordanId)).toBe(true);
    // Some auto row that existed before must now be gone.
    const autoBefore = before.filter((t) => t.source === "auto");
    expect(autoBefore.length).toBeGreaterThan(0);
    for (const t of autoBefore) {
      expect(after.some((r) => r.userId === t.userId)).toBe(false);
    }
    // Article's gameDate is cleared on disk.
    const [a] = await db
      .select()
      .from(articles)
      .where(eq(articles.id, articleId))
      .limit(1);
    expect(a.gameDate).toBeNull();
    expect(teamId).toBeTruthy();
  });

  it("PATCH null->date->null round-trip leaves only the original manual tags", async () => {
    // Belt-and-suspenders: a coach who toggles tagging on then back
    // off should land in the same state as if they had never toggled
    // it on. No leftover auto rows, manual rows untouched.
    const { orgId } = await getFootballTeam();
    const { agent: coach } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );
    const jordanId = await findUserId("jordan@kinectem.demo");

    const created = await coach.post("/api/v1/posts").send({
      postType: "long",
      organizationId: orgId,
      title: "Toggle test",
      body: "Flip the checkbox twice.",
      // No gameDate, but one manual @-mention. The create handler
      // skips the fan-out (no gameDate) and stores Jordan as manual.
      taggedUserIds: [jordanId],
    });
    expect(created.status).toBe(201);
    const postId = created.body.id;
    const articleId = postId.replace(/^article-/, "");

    const initial = await db
      .select()
      .from(articleTags)
      .where(eq(articleTags.articleId, articleId));
    expect(initial).toHaveLength(1);
    expect(initial[0].userId).toBe(jordanId);
    expect(initial[0].source).toBe("manual");

    // Toggle ON: PATCH adds a gameDate, fan-out fires.
    let patched = await coach.patch(`/api/v1/posts/${postId}`).send({
      gameDate: new Date("2025-10-31T19:00:00Z").toISOString(),
    });
    expect(patched.status).toBe(200);
    const mid = await db
      .select()
      .from(articleTags)
      .where(eq(articleTags.articleId, articleId));
    expect(mid.length).toBeGreaterThan(1);
    // Jordan stays manual even though the fan-out ran.
    expect(mid.find((t) => t.userId === jordanId)?.source).toBe("manual");

    // Toggle OFF: PATCH clears gameDate, only auto rows are deleted.
    patched = await coach.patch(`/api/v1/posts/${postId}`).send({
      gameDate: null,
    });
    expect(patched.status).toBe(200);
    const final = await db
      .select()
      .from(articleTags)
      .where(eq(articleTags.articleId, articleId));
    // Back to exactly Jordan's manual row.
    expect(final).toHaveLength(1);
    expect(final[0].userId).toBe(jordanId);
    expect(final[0].source).toBe("manual");
  });

  it("PATCH gameDate change (non-null -> non-null) does NOT re-run the fan-out", async () => {
    // Only the on/off transition matters. Moving an existing recap
    // from one date to another shouldn't churn the tag table — the
    // roster is the same, the existing rows are still valid.
    const { orgId } = await getFootballTeam();
    const { agent: coach } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );

    const created = await coach.post("/api/v1/posts").send({
      postType: "long",
      organizationId: orgId,
      title: "Wrong date initially",
      body: "Will fix the date.",
      gameDate: new Date("2025-11-07T19:00:00Z").toISOString(),
    });
    expect(created.status).toBe(201);
    const postId = created.body.id;
    const articleId = postId.replace(/^article-/, "");

    const before = await db
      .select()
      .from(articleTags)
      .where(eq(articleTags.articleId, articleId));
    expect(before.length).toBeGreaterThan(0);
    const beforeKey = before
      .map((t) => `${t.userId}:${t.status}:${t.source}`)
      .sort();

    // Move the date by a week. Fan-out should be skipped — the
    // before/after row sets must be identical.
    const patched = await coach.patch(`/api/v1/posts/${postId}`).send({
      gameDate: new Date("2025-11-14T19:00:00Z").toISOString(),
    });
    expect(patched.status).toBe(200);

    const after = await db
      .select()
      .from(articleTags)
      .where(eq(articleTags.articleId, articleId));
    const afterKey = after
      .map((t) => `${t.userId}:${t.status}:${t.source}`)
      .sort();
    expect(afterKey).toEqual(beforeKey);
  });

  it("org admins can PATCH a published recap to toggle tagging", async () => {
    // The Edit button on PostPage is also visible to org admins, not
    // just the author. The PATCH endpoint must accept their writes.
    const { orgId } = await getFootballTeam();
    const { agent: coach } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );

    // Coach publishes a regular long-form post (no gameDate, no tags).
    const created = await coach.post("/api/v1/posts").send({
      postType: "long",
      organizationId: orgId,
      title: "Pre-game presser notes",
      body: "Not a recap.",
    });
    expect(created.status).toBe(201);
    const postId = created.body.id;
    const articleId = postId.replace(/^article-/, "");
    expect(
      (
        await db
          .select()
          .from(articleTags)
          .where(eq(articleTags.articleId, articleId))
      ).length,
    ).toBe(0);

    // Promote a non-author seed user to org admin so we can prove the
    // permission check passes for them. Using Lisa (parent) keeps her
    // distinct from the coach who authored the post.
    const lisaId = await findUserId("lisa@kinectem.demo");
    const existingAdmin = await db
      .select()
      .from(organizationAdmins)
      .where(
        and(
          eq(organizationAdmins.organizationId, orgId),
          eq(organizationAdmins.userId, lisaId),
        ),
      )
      .limit(1);
    if (existingAdmin.length === 0) {
      await db
        .insert(organizationAdmins)
        .values({ organizationId: orgId, userId: lisaId });
    }

    const { agent: admin } = await loginAs(
      (u) => u.email === "lisa@kinectem.demo",
    );
    const patched = await admin.patch(`/api/v1/posts/${postId}`).send({
      gameDate: new Date("2025-11-21T19:00:00Z").toISOString(),
    });
    expect(patched.status).toBe(200);

    // Org admin's PATCH ran the fan-out — same as if the coach did it.
    const tagRows = await db
      .select()
      .from(articleTags)
      .where(eq(articleTags.articleId, articleId));
    expect(tagRows.length).toBeGreaterThan(0);
    for (const t of tagRows) {
      expect(t.source).toBe("auto");
    }
  });

  it("PATCH null->date on a published recap notifies each newly-tagged player", async () => {
    // Task #145: when the auto-tag fan-out kicks in via the post-
    // publish edit path, every player who just got an article_tags
    // row should also get a "you were tagged" bell row pointing at
    // the post.
    const { teamId, orgId } = await getFootballTeam();
    const { agent: coach } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );

    const created = await coach.post("/api/v1/posts").send({
      postType: "long",
      organizationId: orgId,
      title: "Late-season recap",
      body: "Will become a recap on edit.",
    });
    expect(created.status).toBe(201);
    const postId = created.body.id;
    // Bell rows use the canonical prefixed post id (`article-<uuid>`)
    // so /posts/:postId resolves them — bare uuids 404 on the post page
    // (see NotificationsBell.tsx and parsePostId in spec-helpers.ts).
    const link = `/posts/${postId}`;

    // Pre-condition: nobody has a post_tag notification for this
    // article yet (since the fan-out hasn't run).
    const baseline = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.kind, "post_tag"), eq(notifications.link, link)));
    expect(baseline).toHaveLength(0);

    const patched = await coach.patch(`/api/v1/posts/${postId}`).send({
      gameDate: new Date("2025-12-12T19:00:00Z").toISOString(),
    });
    expect(patched.status).toBe(200);

    // Every accepted player (other than the coach themselves) should
    // have a bell row pointing at the post.
    const acceptedPlayers = await db
      .select({ userId: rosterEntries.userId })
      .from(rosterEntries)
      .where(
        and(
          eq(rosterEntries.teamId, teamId),
          eq(rosterEntries.role, "player"),
          eq(rosterEntries.status, "accepted"),
        ),
      );
    expect(acceptedPlayers.length).toBeGreaterThan(0);

    const notifs = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.kind, "post_tag"), eq(notifications.link, link)));
    expect(notifs.length).toBe(acceptedPlayers.length);
    const notifiedUserIds = new Set(notifs.map((n) => n.userId));
    for (const p of acceptedPlayers) {
      expect(notifiedUserIds.has(p.userId)).toBe(true);
    }
    // Message and unread-by-default sanity checks.
    for (const n of notifs) {
      expect(n.read).toBe(false);
      expect(n.message).toContain("Late-season recap");
      expect(n.message).toMatch(/^You were tagged in /);
    }
  });

  it("PATCH date->null on a published recap marks removed-auto players' post_tag bell rows read (no delete, no re-notify)", async () => {
    // Task #145: the inverse toggle removes the player's tag, so the
    // bell badge must clear (unread count drops to 0) — but we do NOT
    // delete the notification, because that row is also our throttle
    // signal for the next toggle-on. Marking it read clears the badge
    // and keeps the dedupe record intact.
    const { teamId, orgId } = await getFootballTeam();
    const { agent: coach } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );
    const jordanId = await findUserId("jordan@kinectem.demo");

    // Publish a recap with a manual @-mention for Jordan so we can
    // also confirm Jordan's tag survives untouched.
    const created = await coach.post("/api/v1/posts").send({
      postType: "long",
      organizationId: orgId,
      title: "Recap to be untoggled",
      body: "Will toggle off.",
      taggedUserIds: [jordanId],
    });
    expect(created.status).toBe(201);
    const postId = created.body.id;
    const articleId = postId.replace(/^article-/, "");
    // Bell rows use the canonical prefixed post id (`article-<uuid>`)
    // so /posts/:postId resolves them — bare uuids 404 on the post page.
    const link = `/posts/${postId}`;

    // Toggle ON via PATCH so the post-publish notification helper
    // inserts unread bell rows for every newly auto-tagged player.
    const toggleOn = await coach.patch(`/api/v1/posts/${postId}`).send({
      gameDate: new Date("2025-12-19T19:00:00Z").toISOString(),
    });
    expect(toggleOn.status).toBe(200);

    const autoUserIds = (
      await db
        .select({ userId: articleTags.userId })
        .from(articleTags)
        .where(
          and(
            eq(articleTags.articleId, articleId),
            eq(articleTags.source, "auto"),
          ),
        )
    ).map((r) => r.userId);
    expect(autoUserIds.length).toBeGreaterThan(0);

    const beforeToggleOff = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.kind, "post_tag"), eq(notifications.link, link)));
    // Every newly-tagged player got a bell row, all unread.
    const autoBeforeRows = beforeToggleOff.filter((n) =>
      autoUserIds.includes(n.userId),
    );
    expect(autoBeforeRows.length).toBe(autoUserIds.length);
    for (const n of autoBeforeRows) {
      expect(n.read).toBe(false);
    }

    // Toggle OFF: PATCH clears gameDate, auto article_tags rows are
    // deleted, matching unread post_tag bell rows are MARKED READ.
    const toggleOff = await coach.patch(`/api/v1/posts/${postId}`).send({
      gameDate: null,
    });
    expect(toggleOff.status).toBe(200);

    const afterToggleOff = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.kind, "post_tag"), eq(notifications.link, link)));
    // Same number of rows — none were deleted.
    expect(afterToggleOff.length).toBe(beforeToggleOff.length);
    // Every removed-auto player's bell row is now read (badge clears).
    for (const uid of autoUserIds) {
      const row = afterToggleOff.find((n) => n.userId === uid);
      expect(row).toBeTruthy();
      expect(row?.read).toBe(true);
    }
    // No "you were untagged" rows were inserted (volume only goes
    // down, never up, on the toggle-off transition).
    expect(afterToggleOff.length).toBeLessThanOrEqual(beforeToggleOff.length);
    // Sanity: teamId is exercised by the seed query above.
    expect(teamId).toBeTruthy();
  });

  it("throttles repeated post_tag notifications when a coach toggles tagging on/off/on quickly", async () => {
    // Task #145: a coach who flips the checkbox twice in a row should
    // not double-notify the same player. Throttling is keyed on the
    // (user, post) pair AND survives the toggle-off — the OFF
    // transition marks the bell row read instead of deleting it,
    // so the row is still there to dedupe against on the next ON.
    const { teamId, orgId } = await getFootballTeam();
    const { agent: coach } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );

    const created = await coach.post("/api/v1/posts").send({
      postType: "long",
      organizationId: orgId,
      title: "Toggle-spam recap",
      body: "Coach can't make up their mind.",
    });
    expect(created.status).toBe(201);
    const postId = created.body.id;
    const articleId = postId.replace(/^article-/, "");
    // Bell rows use the canonical prefixed post id (`article-<uuid>`)
    // so /posts/:postId resolves them — bare uuids 404 on the post page.
    const link = `/posts/${postId}`;

    // Toggle ON #1: every accepted player gets one unread bell row.
    let on = await coach.patch(`/api/v1/posts/${postId}`).send({
      gameDate: new Date("2025-12-26T19:00:00Z").toISOString(),
    });
    expect(on.status).toBe(200);
    const firstWave = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.kind, "post_tag"), eq(notifications.link, link)));
    expect(firstWave.length).toBeGreaterThan(0);
    const firstWaveIds = new Set(firstWave.map((n) => n.id));
    const firstWaveCount = firstWave.length;

    // Toggle OFF: bell rows are marked read but NOT deleted, so the
    // throttle has something to detect on the next ON.
    const off = await coach.patch(`/api/v1/posts/${postId}`).send({
      gameDate: null,
    });
    expect(off.status).toBe(200);
    const afterOff = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.kind, "post_tag"), eq(notifications.link, link)));
    // Same set of rows — none deleted, none added.
    expect(afterOff.length).toBe(firstWaveCount);
    expect(new Set(afterOff.map((n) => n.id))).toEqual(firstWaveIds);

    // Toggle ON #2 — within the throttle window. The fan-out re-runs
    // and re-creates the article_tags rows, but the notification
    // helper sees the recent post_tag rows and skips every user.
    on = await coach.patch(`/api/v1/posts/${postId}`).send({
      gameDate: new Date("2025-12-26T19:00:00Z").toISOString(),
    });
    expect(on.status).toBe(200);

    const secondWave = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.kind, "post_tag"), eq(notifications.link, link)));
    // Row count must NOT have grown — throttle suppressed every
    // newly-inserted article_tags row from re-notifying.
    expect(secondWave.length).toBe(firstWaveCount);
    // The same row ids are still here — throttling dedup didn't
    // erase or replace the originals.
    expect(new Set(secondWave.map((n) => n.id))).toEqual(firstWaveIds);
    expect(teamId).toBeTruthy();
  });

  it("admin approval fans out the roster when an author added gameDate after submitting (task #242)", async () => {
    // Regression for task #242. Path:
    //   1) Non-admin author creates a long-form post WITHOUT a gameDate.
    //      It enters the approval queue as "pending_approval" and the
    //      create handler skips the fan-out (no gameDate).
    //   2) Author realizes they meant to file it as a recap and PATCHes
    //      the article to add a gameDate. The PATCH handler only runs
    //      the fan-out for already-published recaps, so for a
    //      pending_approval row no tags are inserted yet.
    //   3) Admin approves the recap. Before #242 the approval handler
    //      just flipped status="published" with no tag fan-out — so the
    //      recap went live with zero rostered players tagged and never
    //      surfaced on their profile pages. After the fix, approval
    //      itself runs the fan-out (idempotently) so every accepted
    //      player ends up tagged and the recap appears under their
    //      profile's Posts tab.
    //
    // The seeded coach@kinectem.demo is also an org admin (so their
    // recaps auto-publish), so this test grants Marcus the "author"
    // position on JV Football to exercise a true non-admin author path.
    const orgId = (await getFootballTeam()).orgId;
    // Find JV Football's id.
    const [jv] = await db
      .select()
      .from(teams)
      .where(and(eq(teams.organizationId, orgId), eq(teams.name, "JV Football")))
      .limit(1);
    if (!jv) throw new Error("JV Football missing from seed");
    const teamId = jv.id;
    const marcusId = await findUserId("marcus@kinectem.demo");

    // Add Marcus to JV Football as an author + accepted, alongside a
    // few of his teammates so the fan-out has multiple players to tag.
    await ensureRosterPlayer(teamId, marcusId);
    await db
      .update(rosterEntries)
      .set({ position: "author" })
      .where(
        and(eq(rosterEntries.teamId, teamId), eq(rosterEntries.userId, marcusId)),
      );
    const jordanId = await findUserId("jordan@kinectem.demo");
    const tylerId = await findUserId("tyler@kinectem.demo");
    await ensureRosterPlayer(teamId, jordanId);
    await ensureRosterPlayer(teamId, tylerId);

    const { agent: marcus } = await loginAs(
      (u) => u.email === "marcus@kinectem.demo",
    );

    // 1) Marcus posts without gameDate. He's a non-admin author so the
    //    server routes this through the approval queue.
    const created = await marcus.post("/api/v1/posts").send({
      postType: "long",
      organizationId: orgId,
      teamId,
      title: "JV upset of the week",
      body: "Filed before I had the date handy.",
    });
    expect(created.status).toBe(201);
    expect(created.body.approvalStatus).toBe("pending_approval");
    const postId = created.body.id;
    const articleId = postId.replace(/^article-/, "");

    // No tags yet — there's no gameDate so the create handler's
    // fan-out is a no-op.
    let tagRows = await db
      .select()
      .from(articleTags)
      .where(eq(articleTags.articleId, articleId));
    expect(tagRows).toHaveLength(0);

    // 2) Marcus edits the pending recap to add the game date. The
    //    PATCH handler intentionally skips fan-out for non-published
    //    statuses — the fan-out happens at the next status transition
    //    (publish or, in this flow, admin approval).
    const patched = await marcus.patch(`/api/v1/posts/${postId}`).send({
      gameDate: new Date("2025-09-12T19:00:00Z").toISOString(),
    });
    expect(patched.status).toBe(200);
    tagRows = await db
      .select()
      .from(articleTags)
      .where(eq(articleTags.articleId, articleId));
    expect(tagRows).toHaveLength(0);

    // 3) Admin approves. This is the moment the regression fixed —
    //    the approval handler must now run the fan-out itself.
    const { agent: admin } = await loginAs(
      (u) => u.email === "sam@kinectem.demo",
    );
    const approve = await admin.post(
      `/api/v1/organizations/${orgId}/post-approvals/${postId}/approve`,
    );
    expect(approve.status).toBe(200);
    expect(approve.body.status).toBe("approved");

    // The article is now published.
    const [a] = await db
      .select()
      .from(articles)
      .where(eq(articles.id, articleId))
      .limit(1);
    expect(a.status).toBe("published");

    // Every accepted player on the team's roster must now be tagged
    // exactly once, with source = "auto".
    tagRows = await db
      .select()
      .from(articleTags)
      .where(eq(articleTags.articleId, articleId));
    const taggedSet = new Set(tagRows.map((t) => t.userId));
    const accepted = await db
      .select({ userId: rosterEntries.userId })
      .from(rosterEntries)
      .where(
        and(
          eq(rosterEntries.teamId, teamId),
          eq(rosterEntries.role, "player"),
          eq(rosterEntries.status, "accepted"),
        ),
      );
    expect(accepted.length).toBeGreaterThan(0);
    for (const r of accepted) {
      expect(taggedSet.has(r.userId)).toBe(true);
    }
    for (const t of tagRows) {
      expect(t.source).toBe("auto");
    }
    // No duplicates.
    expect(tagRows.length).toBe(taggedSet.size);

    // End-to-end check: the recap shows up on each tagged player's
    // profile feed (/users/:userId/posts) — the user-visible symptom
    // task #242 was filed for. We use Jordan (no consent flag) so the
    // tag is approved and visible to a stranger viewer.
    const strangerRes = await admin.get(`/api/v1/users/${jordanId}/posts`);
    expect(strangerRes.status).toBe(200);
    const profileIds = (
      strangerRes.body.data ?? strangerRes.body.items ?? []
    ).map((p: { id: string }) => p.id);
    expect(profileIds).toContain(postId);

    // Idempotency guard: re-approving (in practice, an admin who hits
    // the endpoint twice) must not double-insert tags. The endpoint
    // 404s the second call because status flipped off pending_approval,
    // but we still verify the tag set is unchanged.
    const reApprove = await admin.post(
      `/api/v1/organizations/${orgId}/post-approvals/${postId}/approve`,
    );
    expect(reApprove.status).toBe(404);
    const after = await db
      .select()
      .from(articleTags)
      .where(eq(articleTags.articleId, articleId));
    expect(after.length).toBe(tagRows.length);
  });

  it("rejects organizationId-only recap creation by an org admin with multiple teams (task #242)", async () => {
    // Regression for task #242. An org admin (sam, with no specific
    // coach/author roster affiliation in Westfield) used to be able
    // to POST /posts with only an organizationId — the server would
    // silently pick the first team in the org and run the auto-tag
    // fan-out against the wrong roster. The fix forces the admin to
    // pick a team explicitly.
    const { orgId } = await getFootballTeam();
    const { agent: admin } = await loginAs(
      (u) => u.email === "sam@kinectem.demo",
    );
    // Sanity: Westfield has more than one team in the seed.
    const orgTeams = await db
      .select()
      .from(teams)
      .where(eq(teams.organizationId, orgId));
    expect(orgTeams.length).toBeGreaterThan(1);

    const created = await admin.post("/api/v1/posts").send({
      postType: "long",
      organizationId: orgId,
      title: "Ambiguous recap",
      body: "no team picked",
      gameDate: new Date("2025-09-12T19:00:00Z").toISOString(),
    });
    expect(created.status).toBe(400);
    expect(String(created.body?.error ?? "")).toMatch(/team/i);
  });

  it("POST /posts publishing a brand-new recap notifies every newly auto-tagged player exactly once (task #249)", async () => {
    // Brand-new recap path. Before #249 only the post-publish edit
    // path notified players; fresh recaps fanned out tags but never
    // fired the "you were tagged" bell, so players had to stumble
    // onto the article on their own profile to know it existed.
    const { teamId, orgId } = await getFootballTeam();
    const { agent: coach, user: coachUser } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );

    const created = await coach.post("/api/v1/posts").send({
      postType: "long",
      organizationId: orgId,
      title: "Westfield 31, Roselle Catholic 7",
      body: "Big road win.",
      gameDate: new Date("2026-01-09T19:00:00Z").toISOString(),
      opponentName: "Roselle Catholic",
      gameScore: "31-7",
    });
    expect(created.status).toBe(201);
    const postId = created.body.id;
    const link = `/posts/${postId}`;

    const acceptedPlayers = await db
      .select({ userId: rosterEntries.userId })
      .from(rosterEntries)
      .where(
        and(
          eq(rosterEntries.teamId, teamId),
          eq(rosterEntries.role, "player"),
          eq(rosterEntries.status, "accepted"),
        ),
      );
    expect(acceptedPlayers.length).toBeGreaterThan(0);

    const notifs = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.kind, "post_tag"), eq(notifications.link, link)));
    // One bell row per rostered player, and never the coach themselves.
    expect(notifs.length).toBe(acceptedPlayers.length);
    const notifiedIds = new Set(notifs.map((n) => n.userId));
    for (const p of acceptedPlayers) {
      expect(notifiedIds.has(p.userId)).toBe(true);
    }
    expect(notifiedIds.has(coachUser.id)).toBe(false);
    for (const n of notifs) {
      expect(n.read).toBe(false);
      expect(n.message).toBe('You were tagged in "Westfield 31, Roselle Catholic 7"');
      expect(n.actorUserId).toBe(coachUser.id);
    }
  });

  it("POST /posts skips notifications when the recap is saved as a draft (task #249)", async () => {
    // Draft recaps don't have a public article to point a bell row at,
    // and the publish handler will re-run the fan-out + notify when
    // the draft actually goes live.
    const { teamId, orgId } = await getFootballTeam();
    const { agent: coach } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );

    const created = await coach.post("/api/v1/posts").send({
      postType: "long",
      organizationId: orgId,
      title: "Draft recap, no notify",
      body: "Saved for later.",
      gameDate: new Date("2026-01-16T19:00:00Z").toISOString(),
      status: "draft",
    });
    expect(created.status).toBe(201);
    const postId = created.body.id;
    const link = `/posts/${postId}`;

    const notifs = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.kind, "post_tag"), eq(notifications.link, link)));
    expect(notifs).toHaveLength(0);
    // Sanity: teamId is exercised in the rest of the suite.
    expect(teamId).toBeTruthy();
  });

  it("POST /posts pre-tagged players don't get a duplicate bell when the create-time fan-out runs (task #249)", async () => {
    // A coach who manually @-mentions a rostered player AND posts the
    // article as a recap should land each player with exactly one
    // article_tags row and exactly one bell notification — the
    // explicit @-mention is already represented by its own (manual)
    // tag, so the auto fan-out's "newly tagged" set must not include
    // it, and therefore the notify helper must skip it too.
    const { teamId, orgId } = await getFootballTeam();
    const jordanId = await findUserId("jordan@kinectem.demo");
    const { agent: coach } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );

    const created = await coach.post("/api/v1/posts").send({
      postType: "long",
      organizationId: orgId,
      title: "Westfield 20, Cranford 17",
      body: "Jordan was the player of the game.",
      gameDate: new Date("2026-01-23T19:00:00Z").toISOString(),
      opponentName: "Cranford",
      gameScore: "20-17",
      taggedUserIds: [jordanId],
    });
    expect(created.status).toBe(201);
    const postId = created.body.id;
    const articleId = postId.replace(/^article-/, "");
    const link = `/posts/${postId}`;

    // Jordan has exactly one tag row and exactly one bell notification.
    const jordanTags = await db
      .select()
      .from(articleTags)
      .where(
        and(eq(articleTags.articleId, articleId), eq(articleTags.userId, jordanId)),
      );
    expect(jordanTags).toHaveLength(1);
    expect(jordanTags[0].source).toBe("manual");

    const jordanNotifs = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.kind, "post_tag"),
          eq(notifications.link, link),
          eq(notifications.userId, jordanId),
        ),
      );
    expect(jordanNotifs).toHaveLength(1);

    // Total bell-row count still matches the rostered player count
    // (Jordan's row is the manual one, but the notify helper still
    // covered him because the create handler treats explicit ids as
    // newly-tagged users on first insert).
    const acceptedPlayers = await db
      .select({ userId: rosterEntries.userId })
      .from(rosterEntries)
      .where(
        and(
          eq(rosterEntries.teamId, teamId),
          eq(rosterEntries.role, "player"),
          eq(rosterEntries.status, "accepted"),
        ),
      );
    const allNotifs = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.kind, "post_tag"), eq(notifications.link, link)));
    // Deterministic check: the recipient set is exactly the
    // accepted-player roster (Jordan included), with no duplicates
    // and no extras (e.g. coach is excluded because the helper drops
    // the actor from its userIds set).
    const ids = allNotifs.map((n) => n.userId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(allNotifs.length).toBe(acceptedPlayers.length);
    const notifiedIds = new Set(ids);
    for (const p of acceptedPlayers) {
      expect(notifiedIds.has(p.userId)).toBe(true);
    }
    expect(notifiedIds.has(jordanId)).toBe(true);
  });

  it("POST /posts/:id/publish publishing a draft recap notifies every newly-tagged player exactly once (task #249)", async () => {
    // Save → publish path. The publish handler runs the fan-out at
    // publish time (because PATCH on a draft never does), so the
    // notify must fire from the same place.
    const { teamId, orgId } = await getFootballTeam();
    const { agent: coach, user: coachUser } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );

    const draft = await coach.post("/api/v1/posts").send({
      postType: "long",
      organizationId: orgId,
      title: "Draft → published recap",
      body: "Wrote this in the locker room.",
      status: "draft",
    });
    expect(draft.status).toBe(201);
    const postId = draft.body.id;
    const link = `/posts/${postId}`;

    // No bells yet — draft hasn't fanned out.
    let notifs = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.kind, "post_tag"), eq(notifications.link, link)));
    expect(notifs).toHaveLength(0);

    // Add the gameDate then publish.
    const patched = await coach.patch(`/api/v1/posts/${postId}`).send({
      gameDate: new Date("2026-01-30T19:00:00Z").toISOString(),
    });
    expect(patched.status).toBe(200);
    const published = await coach
      .post(`/api/v1/posts/${postId}/publish`)
      .send();
    expect(published.status).toBe(200);

    const acceptedPlayers = await db
      .select({ userId: rosterEntries.userId })
      .from(rosterEntries)
      .where(
        and(
          eq(rosterEntries.teamId, teamId),
          eq(rosterEntries.role, "player"),
          eq(rosterEntries.status, "accepted"),
        ),
      );
    expect(acceptedPlayers.length).toBeGreaterThan(0);

    notifs = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.kind, "post_tag"), eq(notifications.link, link)));
    // One bell row per rostered player, exactly once. The coach is
    // never on the receiving end.
    expect(notifs.length).toBe(acceptedPlayers.length);
    const notifiedIds = new Set(notifs.map((n) => n.userId));
    for (const p of acceptedPlayers) {
      expect(notifiedIds.has(p.userId)).toBe(true);
    }
    expect(notifiedIds.has(coachUser.id)).toBe(false);
    for (const n of notifs) {
      expect(n.read).toBe(false);
      expect(n.message).toBe('You were tagged in "Draft → published recap"');
      // Actor on the bell row is whoever pressed Publish (the
      // "acting user as actor" requirement from task #249). Here
      // the publisher is the same as the author, but the dedicated
      // co-author test below exercises the case where they differ.
      expect(n.actorUserId).toBe(coachUser.id);
    }
  });

  it("POST /posts/:id/publish credits the publishing co-author (not the original author) as the bell-notification actor (task #249)", async () => {
    // When a co-author publishes someone else's draft recap, the
    // bell row's actor must be the user who pressed Publish — the
    // "acting user as actor" requirement. Without that, players see
    // a notification attributed to a coach who didn't actually
    // publish the article. Both `sam@kinectem.demo` and
    // `coach@kinectem.demo` are Westfield admins, so this also
    // exercises the auto-publish (admin → "published") branch.
    const { teamId, orgId } = await getFootballTeam();
    const { agent: coach, user: coachUser } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );
    const { agent: sam, user: samUser } = await loginAs(
      (u) => u.email === "sam@kinectem.demo",
    );

    const draft = await coach.post("/api/v1/posts").send({
      postType: "long",
      organizationId: orgId,
      title: "Co-author publishes",
      body: "Sam will press publish on Coach Davis's draft.",
      status: "draft",
    });
    expect(draft.status).toBe(201);
    const postId = draft.body.id;
    const articleId = postId.replace(/^article-/, "");
    const link = `/posts/${postId}`;

    // Wire Sam in as a co-author so the publish handler accepts him.
    await db.insert(articleAuthors).values({
      articleId,
      userId: samUser.id,
    });

    // Add the gameDate via PATCH so the publish-time fan-out is the
    // one that actually inserts auto rows (and therefore drives the
    // notify).
    const patched = await coach.patch(`/api/v1/posts/${postId}`).send({
      gameDate: new Date("2026-02-12T19:00:00Z").toISOString(),
    });
    expect(patched.status).toBe(200);

    // Sam (the co-author, not the original author) presses Publish.
    const published = await sam.post(`/api/v1/posts/${postId}/publish`).send();
    expect(published.status).toBe(200);

    const acceptedPlayers = await db
      .select({ userId: rosterEntries.userId })
      .from(rosterEntries)
      .where(
        and(
          eq(rosterEntries.teamId, teamId),
          eq(rosterEntries.role, "player"),
          eq(rosterEntries.status, "accepted"),
        ),
      );
    expect(acceptedPlayers.length).toBeGreaterThan(0);

    const notifs = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.kind, "post_tag"), eq(notifications.link, link)));
    expect(notifs.length).toBe(acceptedPlayers.length);
    for (const n of notifs) {
      // The publisher (Sam) is the actor — NOT the article's
      // original author (Coach Davis).
      expect(n.actorUserId).toBe(samUser.id);
      expect(n.actorUserId).not.toBe(coachUser.id);
      expect(n.message).toBe('You were tagged in "Co-author publishes"');
      expect(n.read).toBe(false);
    }
  });

  it("POST /posts/:id/publish doesn't double-notify players who were manually pre-tagged on the draft (task #249)", async () => {
    // A coach who hand-mentioned a player while drafting should not
    // see that player get two bells when publishing — the fan-out's
    // dedupe means the publish-time notify skips that user.
    const { orgId } = await getFootballTeam();
    const jordanId = await findUserId("jordan@kinectem.demo");
    const { agent: coach } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );

    // Draft a recap with Jordan pre-tagged via taggedUserIds and NO
    // gameDate yet. Without a gameDate the create-time fan-out is a
    // no-op, so the only article_tags row at this point is Jordan's
    // manual @-mention. Drafts also skip the notify, so no bell row
    // exists yet. The gameDate gets added in the next step so the
    // publish handler is the one that runs the roster fan-out.
    const draft = await coach.post("/api/v1/posts").send({
      postType: "long",
      organizationId: orgId,
      title: "Pre-tagged Jordan",
      body: "Manual tag at draft time.",
      status: "draft",
      taggedUserIds: [jordanId],
    });
    expect(draft.status).toBe(201);
    const postId = draft.body.id;
    const articleId = postId.replace(/^article-/, "");
    const link = `/posts/${postId}`;

    // PATCH the draft to add the gameDate. Drafts intentionally skip
    // fan-out on PATCH, so Jordan's manual row is still the only one
    // and nobody has a bell yet.
    const patched = await coach.patch(`/api/v1/posts/${postId}`).send({
      gameDate: new Date("2026-02-06T19:00:00Z").toISOString(),
    });
    expect(patched.status).toBe(200);

    // Sanity: Jordan has exactly one manual tag row and zero bells.
    const jordanTagsBefore = await db
      .select()
      .from(articleTags)
      .where(
        and(eq(articleTags.articleId, articleId), eq(articleTags.userId, jordanId)),
      );
    expect(jordanTagsBefore).toHaveLength(1);
    expect(jordanTagsBefore[0].source).toBe("manual");
    const baseline = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.kind, "post_tag"), eq(notifications.link, link)));
    expect(baseline).toHaveLength(0);

    // Publish the draft. The publish handler runs the fan-out and
    // inserts auto rows for every other rostered player. Jordan's
    // row is unchanged (still manual) and the notify helper must
    // NOT include him in the userIds set — `applyArticleTagFanout`
    // already deduped him.
    const published = await coach.post(`/api/v1/posts/${postId}/publish`).send();
    expect(published.status).toBe(200);

    const jordanTagsAfter = await db
      .select()
      .from(articleTags)
      .where(
        and(eq(articleTags.articleId, articleId), eq(articleTags.userId, jordanId)),
      );
    expect(jordanTagsAfter).toHaveLength(1);

    // Jordan still has zero bell rows for this post — the dedupe
    // worked end-to-end.
    const jordanNotifs = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.kind, "post_tag"),
          eq(notifications.link, link),
          eq(notifications.userId, jordanId),
        ),
      );
    expect(jordanNotifs).toHaveLength(0);

    // Other rostered players DID get notified (one row each).
    const otherNotifs = await db
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.kind, "post_tag"), eq(notifications.link, link)),
      );
    expect(otherNotifs.length).toBeGreaterThan(0);
    const otherIds = otherNotifs.map((n) => n.userId);
    expect(otherIds).not.toContain(jordanId);
    expect(new Set(otherIds).size).toBe(otherIds.length);
  });

  it("non-admin, non-author cannot PATCH a published recap", async () => {
    // Negative path for the permission check: a regular logged-in
    // user (not author, not co-author, not org admin) gets 403.
    const { orgId } = await getFootballTeam();
    const { agent: coach } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );
    const created = await coach.post("/api/v1/posts").send({
      postType: "long",
      organizationId: orgId,
      title: "Permission probe",
      body: "Stranger should not edit this.",
    });
    expect(created.status).toBe(201);
    const postId = created.body.id;

    const { agent: stranger } = await loginAs(
      (u) => u.email === "marcus@kinectem.demo",
    );
    const denied = await stranger.patch(`/api/v1/posts/${postId}`).send({
      gameDate: new Date("2025-11-28T19:00:00Z").toISOString(),
    });
    expect(denied.status).toBe(403);
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

  it("orders tagged posts by publish time, newest first", async () => {
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

  it("sorts a freshly published recap about an old game above an older recap about a recent game", async () => {
    // Regression test for task #252 — the profile feed used to sort
    // recap articles by gameDate, which meant a brand-new write-up of
    // an old game would be buried weeks down a player's profile.
    // Now ordering uses publishedAt (when the post actually went live)
    // so the most recently published item is always at the top.
    const { orgId } = await getFootballTeam();
    const marcusId = await findUserId("marcus@kinectem.demo");

    const { agent: coach } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );

    // 1) Publish first: a recap about a RECENT game.
    const recentGameOldPost = await coach.post("/api/v1/posts").send({
      postType: "long",
      organizationId: orgId,
      title: "Westfield 21, Cranford 14",
      body: "Tight one in the rain.",
      gameDate: new Date("2025-11-21T19:00:00Z").toISOString(),
      opponentName: "Cranford",
      gameScore: "21-14",
    });
    expect(recentGameOldPost.status).toBe(201);

    // 2) Publish second (so its publishedAt is later): a recap about
    //    an OLD game. Under the old gameDate-based sort this would
    //    land BELOW the recent-game post; under the publish-time
    //    sort it must land ABOVE it.
    const oldGameNewPost = await coach.post("/api/v1/posts").send({
      postType: "long",
      organizationId: orgId,
      title: "Westfield 10, Linden 9 (catch-up writeup)",
      body: "Finally getting the recap up for our season opener.",
      gameDate: new Date("2025-08-29T19:00:00Z").toISOString(),
      opponentName: "Linden",
      gameScore: "10-9",
    });
    expect(oldGameNewPost.status).toBe(201);

    const { agent } = await loginAs(
      (u) => u.email === "marcus@kinectem.demo",
    );
    const res = await agent.get(`/api/v1/users/${marcusId}/posts`);
    expect(res.status).toBe(200);
    const list = (res.body.data ?? res.body.items ?? []) as Array<{ id: string }>;
    const idxNewPost = list.findIndex((p) => p.id === oldGameNewPost.body.id);
    const idxOldPost = list.findIndex((p) => p.id === recentGameOldPost.body.id);
    expect(idxNewPost).toBeGreaterThanOrEqual(0);
    expect(idxOldPost).toBeGreaterThanOrEqual(0);
    // The most recently published post wins, even though its game is older.
    expect(idxNewPost).toBeLessThan(idxOldPost);
  });
});

// Reference unused imports so the test file still typechecks even if
// Vitest's tree-shaking changes; harmless at runtime.
void app;
void request;
