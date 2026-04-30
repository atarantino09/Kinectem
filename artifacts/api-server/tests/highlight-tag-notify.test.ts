import { describe, expect, it, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  db,
  highlightTags,
  notifications,
  organizations,
  rosterEntries,
  teams,
  users,
} from "@workspace/db";
import { notifyNewlyTaggedInHighlight } from "../src/lib/article-tagging";
import { loginAs } from "./helpers";

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

async function ensureRosterPlayer(teamId: string, userId: string) {
  const existing = await db
    .select()
    .from(rosterEntries)
    .where(
      and(eq(rosterEntries.teamId, teamId), eq(rosterEntries.userId, userId)),
    )
    .limit(1);
  if (existing.length > 0) {
    await db
      .update(rosterEntries)
      .set({ status: "accepted", role: "player", position: "player" })
      .where(
        and(eq(rosterEntries.teamId, teamId), eq(rosterEntries.userId, userId)),
      );
  } else {
    await db.insert(rosterEntries).values({
      teamId,
      userId,
      role: "player",
      status: "accepted",
      position: "player",
    });
  }
}

async function setRequireTagConsent(userId: string, value: boolean) {
  await db
    .update(users)
    .set({ requireTagConsent: value })
    .where(eq(users.id, userId));
}

// Highlight composer (task #313) lets the post author tag specific roster
// players. Task #320: those tagged players need a bell notification so they
// don't have to discover the tag by accident, mirroring the recap fan-out.
describe("highlight tag notifications (task #320)", () => {
  beforeEach(async () => {
    // Reset consent flags so each scenario starts from the same baseline.
    for (const email of [
      "lisa@kinectem.demo",
      "samira@kinectem.demo",
      "marcus@kinectem.demo",
      "jordan@kinectem.demo",
      "tyler@kinectem.demo",
    ]) {
      await db
        .update(users)
        .set({ requireTagConsent: false })
        .where(eq(users.email, email));
    }
  });

  it("notifies a tagged player with a link to the highlight post", async () => {
    const { team } = await (async () => {
      const { teamId } = await getFootballTeam();
      return { team: { id: teamId } };
    })();
    const { agent: uploader } = await loginAs(
      (u) => u.email === "marcus@kinectem.demo",
    );
    const jordanId = await findUserId("jordan@kinectem.demo");
    await ensureRosterPlayer(team.id, jordanId);
    const marcusId = await findUserId("marcus@kinectem.demo");
    await ensureRosterPlayer(team.id, marcusId);

    const create = await uploader.post("/api/v1/posts").send({
      postType: "short",
      teamId: team.id,
      title: "Game-winning catch",
      description: "Tagging the QB.",
      videoUrl: "https://example.com/clip.mp4",
    });
    expect(create.status).toBe(201);
    const postId: string = create.body.id;
    expect(postId.startsWith("highlight-")).toBe(true);

    const tagRes = await uploader.post(`/api/v1/posts/${postId}/tags`).send({
      tags: [{ taggedEntityType: "user", taggedEntityId: jordanId }],
    });
    expect(tagRes.status).toBe(201);
    expect(tagRes.body.tags).toHaveLength(1);

    // Jordan must have exactly one bell row pointing at the post.
    const jordanNotifs = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, jordanId),
          eq(notifications.kind, "post_tag"),
          eq(notifications.link, `/posts/${postId}`),
        ),
      );
    expect(jordanNotifs).toHaveLength(1);
    expect(jordanNotifs[0].read).toBe(false);
    expect(jordanNotifs[0].message).toBe(
      'You were tagged in "Game-winning catch"',
    );
    expect(jordanNotifs[0].actorUserId).toBe(marcusId);
  });

  it("suppresses the notification for tags the user added to themselves", async () => {
    const { teamId } = await getFootballTeam();
    const { agent: uploader } = await loginAs(
      (u) => u.email === "marcus@kinectem.demo",
    );
    const marcusId = await findUserId("marcus@kinectem.demo");
    await ensureRosterPlayer(teamId, marcusId);

    const create = await uploader.post("/api/v1/posts").send({
      postType: "short",
      teamId,
      title: "Solo edit",
      description: "Self-tag — should not ping me.",
      videoUrl: "https://example.com/solo.mp4",
    });
    expect(create.status).toBe(201);
    const postId: string = create.body.id;

    const tagRes = await uploader.post(`/api/v1/posts/${postId}/tags`).send({
      tags: [{ taggedEntityType: "user", taggedEntityId: marcusId }],
    });
    expect(tagRes.status).toBe(201);
    // The tag row was inserted (the response carries it) — only the
    // notification is suppressed.
    expect(tagRes.body.tags).toHaveLength(1);
    const insertedTag = await db
      .select()
      .from(highlightTags)
      .where(eq(highlightTags.id, tagRes.body.tags[0].id));
    expect(insertedTag).toHaveLength(1);

    const marcusNotifs = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, marcusId),
          eq(notifications.kind, "post_tag"),
          eq(notifications.link, `/posts/${postId}`),
        ),
      );
    expect(marcusNotifs).toHaveLength(0);
  });

  it("uses a 'review tag' prompt when the tag is pending consent", async () => {
    const { teamId } = await getFootballTeam();
    const { agent: uploader } = await loginAs(
      (u) => u.email === "marcus@kinectem.demo",
    );
    const samiraId = await findUserId("samira@kinectem.demo");
    const lisaId = await findUserId("lisa@kinectem.demo");
    await ensureRosterPlayer(teamId, samiraId);
    // Parent (Lisa) requires consent → Samira's tag lands as pending.
    await setRequireTagConsent(lisaId, true);

    const create = await uploader.post("/api/v1/posts").send({
      postType: "short",
      teamId,
      title: "Practice clip",
      description: "Includes a minor whose guardian gates tags.",
      videoUrl: "https://example.com/practice.mp4",
    });
    expect(create.status).toBe(201);
    const postId: string = create.body.id;

    const tagRes = await uploader.post(`/api/v1/posts/${postId}/tags`).send({
      tags: [{ taggedEntityType: "user", taggedEntityId: samiraId }],
    });
    expect(tagRes.status).toBe(201);
    expect(tagRes.body.tags).toHaveLength(1);
    expect(tagRes.body.tags[0].status).toBe("pending");

    // Samira gets a review-tag prompt rather than the plain "you were
    // tagged" message — the wording surfaces the action she needs to take.
    const samiraNotifs = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, samiraId),
          eq(notifications.kind, "post_tag"),
          eq(notifications.link, `/posts/${postId}`),
        ),
      );
    expect(samiraNotifs).toHaveLength(1);
    expect(samiraNotifs[0].message).toBe(
      'Please review a tag on you in "Practice clip"',
    );
  });

  it("does not duplicate the bell row when a tag is re-sent on the same post", async () => {
    // Re-tagging the same player on the same post is a no-op at the
    // tag table (ON CONFLICT DO NOTHING), so the helper sees zero
    // newly-inserted rows and writes no second bell entry.
    const { teamId } = await getFootballTeam();
    const { agent: uploader } = await loginAs(
      (u) => u.email === "marcus@kinectem.demo",
    );
    const jordanId = await findUserId("jordan@kinectem.demo");
    const tylerId = await findUserId("tyler@kinectem.demo");
    await ensureRosterPlayer(teamId, jordanId);
    await ensureRosterPlayer(teamId, tylerId);

    const create = await uploader.post("/api/v1/posts").send({
      postType: "short",
      teamId,
      title: "Re-tag demo",
      videoUrl: "https://example.com/retag.mp4",
    });
    expect(create.status).toBe(201);
    const postId: string = create.body.id;

    const first = await uploader.post(`/api/v1/posts/${postId}/tags`).send({
      tags: [{ taggedEntityType: "user", taggedEntityId: jordanId }],
    });
    expect(first.status).toBe(201);

    // Adding Tyler in a separate request — Jordan's tag is now a no-op
    // (already inserted), so Jordan keeps exactly one bell row, and
    // Tyler picks up his first.
    const second = await uploader.post(`/api/v1/posts/${postId}/tags`).send({
      tags: [
        { taggedEntityType: "user", taggedEntityId: jordanId },
        { taggedEntityType: "user", taggedEntityId: tylerId },
      ],
    });
    expect(second.status).toBe(201);

    const jordanNotifs = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, jordanId),
          eq(notifications.kind, "post_tag"),
          eq(notifications.link, `/posts/${postId}`),
        ),
      );
    expect(jordanNotifs).toHaveLength(1);

    const tylerNotifs = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, tylerId),
          eq(notifications.kind, "post_tag"),
          eq(notifications.link, `/posts/${postId}`),
        ),
      );
    expect(tylerNotifs).toHaveLength(1);
  });

  it("notifies the gating parent so they can review the tag from their bell (task #323)", async () => {
    // Samira is Lisa's child in the seed. With Lisa requiring consent the
    // tag lands as `pending` — Samira can't approve it herself, so Lisa
    // (the actual decision-maker) needs her own bell row pointing at the
    // post in "view as your child" mode rather than only seeing the prompt
    // if she happens to open the family inbox.
    const { teamId } = await getFootballTeam();
    const { agent: uploader } = await loginAs(
      (u) => u.email === "marcus@kinectem.demo",
    );
    const samiraId = await findUserId("samira@kinectem.demo");
    const lisaId = await findUserId("lisa@kinectem.demo");
    const marcusId = await findUserId("marcus@kinectem.demo");
    await ensureRosterPlayer(teamId, samiraId);
    await setRequireTagConsent(lisaId, true);

    const create = await uploader.post("/api/v1/posts").send({
      postType: "short",
      teamId,
      title: "Parent prompt clip",
      description: "Tag of a minor — parent should be pinged too.",
      videoUrl: "https://example.com/parent-prompt.mp4",
    });
    expect(create.status).toBe(201);
    const postId: string = create.body.id;

    const tagRes = await uploader.post(`/api/v1/posts/${postId}/tags`).send({
      tags: [{ taggedEntityType: "user", taggedEntityId: samiraId }],
    });
    expect(tagRes.status).toBe(201);
    expect(tagRes.body.tags[0].status).toBe("pending");

    // Lisa's bell carries a child-scoped link (`?asChild=<childId>`) that
    // lands the family-inbox view of the post so she can approve/decline.
    const parentLink = `/posts/${postId}?asChild=${samiraId}`;
    const lisaNotifs = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, lisaId),
          eq(notifications.kind, "post_tag"),
          eq(notifications.link, parentLink),
        ),
      );
    expect(lisaNotifs).toHaveLength(1);
    expect(lisaNotifs[0].message).toBe(
      'Please review a tag on Samira in "Parent prompt clip"',
    );
    expect(lisaNotifs[0].actorUserId).toBe(marcusId);

    // Samira still gets her own prompt at the un-scoped link — the parent
    // row is in addition to the child row, not a replacement.
    const samiraNotifs = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, samiraId),
          eq(notifications.kind, "post_tag"),
          eq(notifications.link, `/posts/${postId}`),
        ),
      );
    expect(samiraNotifs).toHaveLength(1);
  });

  it("does not ping the parent when the parent is the one tagging their child (task #323)", async () => {
    // Lisa tagging Samira herself is a self-tag at the family level — the
    // parent already knows about the action they just took, so no bell row
    // for Lisa even though Samira's tag still lands as `pending`.
    const { teamId } = await getFootballTeam();
    const samiraId = await findUserId("samira@kinectem.demo");
    const lisaId = await findUserId("lisa@kinectem.demo");
    await ensureRosterPlayer(teamId, samiraId);
    await setRequireTagConsent(lisaId, true);

    const fakeHighlightId = "00000000-0000-4000-8000-000000000323";
    const link = `/posts/highlight-${fakeHighlightId}`;
    const parentLink = `${link}?asChild=${samiraId}`;

    await notifyNewlyTaggedInHighlight({
      tags: [{ userId: samiraId, status: "pending" }],
      highlightId: fakeHighlightId,
      highlightTitle: "Parent self-tag",
      actorUserId: lisaId,
    });

    const lisaNotifs = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, lisaId),
          eq(notifications.kind, "post_tag"),
          eq(notifications.link, parentLink),
        ),
      );
    expect(lisaNotifs).toHaveLength(0);

    // Samira still gets her review prompt — only the parent fan-out is
    // suppressed when the parent is the actor.
    const samiraNotifs = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, samiraId),
          eq(notifications.kind, "post_tag"),
          eq(notifications.link, link),
        ),
      );
    expect(samiraNotifs).toHaveLength(1);
  });

  it("does not duplicate the parent bell row when the same tag is re-sent (task #323)", async () => {
    // Re-running the helper for the same (parent, child, post) tuple inside
    // the throttle window must not write a second parent row, mirroring
    // the player-side dedupe.
    const { teamId } = await getFootballTeam();
    const samiraId = await findUserId("samira@kinectem.demo");
    const lisaId = await findUserId("lisa@kinectem.demo");
    const marcusId = await findUserId("marcus@kinectem.demo");
    await ensureRosterPlayer(teamId, samiraId);
    await setRequireTagConsent(lisaId, true);

    const fakeHighlightId = "00000000-0000-4000-8000-000000000324";
    const link = `/posts/highlight-${fakeHighlightId}`;
    const parentLink = `${link}?asChild=${samiraId}`;

    await notifyNewlyTaggedInHighlight({
      tags: [{ userId: samiraId, status: "pending" }],
      highlightId: fakeHighlightId,
      highlightTitle: "Re-tag minor",
      actorUserId: marcusId,
    });
    await notifyNewlyTaggedInHighlight({
      tags: [{ userId: samiraId, status: "pending" }],
      highlightId: fakeHighlightId,
      highlightTitle: "Re-tag minor",
      actorUserId: marcusId,
    });

    const lisaNotifs = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, lisaId),
          eq(notifications.kind, "post_tag"),
          eq(notifications.link, parentLink),
        ),
      );
    expect(lisaNotifs).toHaveLength(1);
  });

  it("suppresses a second notification within the throttle window", async () => {
    // Directly exercise the time-window throttle: pre-seed a recent
    // post_tag bell row for the same (user, link) and call the helper
    // again. Because the prior row is inside TAG_NOTIF_THROTTLE_MS the
    // helper must skip the second insert — even though a brand-new tag
    // row was just added (i.e. the dedupe is NOT just "ON CONFLICT").
    const { teamId } = await getFootballTeam();
    const jordanId = await findUserId("jordan@kinectem.demo");
    await ensureRosterPlayer(teamId, jordanId);
    const marcusId = await findUserId("marcus@kinectem.demo");

    // Fabricate a post id we control so the link matches the helper's
    // computed link without needing a real post on disk.
    const fakeHighlightId = "00000000-0000-4000-8000-000000000000";
    const link = `/posts/highlight-${fakeHighlightId}`;

    // 1) Seed a "recent" bell row (within throttle window).
    await db.insert(notifications).values({
      userId: jordanId,
      kind: "post_tag",
      message: 'You were tagged in "First clip"',
      link,
      actorUserId: marcusId,
    });

    // 2) Call the helper again — must short-circuit on Jordan.
    await notifyNewlyTaggedInHighlight({
      tags: [{ userId: jordanId, status: "approved" }],
      highlightId: fakeHighlightId,
      highlightTitle: "Second clip",
      actorUserId: marcusId,
    });

    const jordanNotifs = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, jordanId),
          eq(notifications.kind, "post_tag"),
          eq(notifications.link, link),
        ),
      );
    expect(jordanNotifs).toHaveLength(1);
    // Still the original message — the second call did not insert.
    expect(jordanNotifs[0].message).toBe('You were tagged in "First clip"');

    // 3) Move the seeded row outside the throttle window and call
    // again — now a new bell row is allowed.
    const beyondWindow = new Date(Date.now() - 11 * 60 * 1000);
    await db
      .update(notifications)
      .set({ createdAt: beyondWindow })
      .where(
        and(
          eq(notifications.userId, jordanId),
          eq(notifications.link, link),
        ),
      );

    await notifyNewlyTaggedInHighlight({
      tags: [{ userId: jordanId, status: "approved" }],
      highlightId: fakeHighlightId,
      highlightTitle: "Third clip",
      actorUserId: marcusId,
    });

    const jordanAfter = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, jordanId),
          eq(notifications.kind, "post_tag"),
          eq(notifications.link, link),
        ),
      );
    expect(jordanAfter).toHaveLength(2);
    const messages = jordanAfter.map((n) => n.message).sort();
    expect(messages).toContain('You were tagged in "First clip"');
    expect(messages).toContain('You were tagged in "Third clip"');
  });
});
