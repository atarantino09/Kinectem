import { describe, expect, it, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  db,
  users,
  notifications,
  parentChildNotificationReads,
  articles,
  articleTags,
  postComments,
  postReactions,
  userFollowers,
  conversations,
  conversationParticipants,
  messages,
  messageChildHides,
  rosterEntries,
  teams,
} from "@workspace/db";
import { app, loginAs, request } from "./helpers";

async function findUserId(email: string): Promise<string> {
  const [u] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!u) throw new Error(`User ${email} missing from seed`);
  return u.id;
}

async function getAnyTeamId(): Promise<string> {
  const [t] = await db.select({ id: teams.id }).from(teams).limit(1);
  if (!t) throw new Error("No teams in seed");
  return t.id;
}

describe("parent inbox: per-child unified notifications", () => {
  beforeEach(async () => {
    // Wipe parent read state for our test pair so each test starts clean.
    const lisaId = await findUserId("lisa@kinectem.demo");
    const samiraId = await findUserId("samira@kinectem.demo");
    await db
      .delete(parentChildNotificationReads)
      .where(
        and(
          eq(parentChildNotificationReads.parentId, lisaId),
          eq(parentChildNotificationReads.childId, samiraId),
        ),
      );
  });

  it("requires authentication", async () => {
    const samiraId = await findUserId("samira@kinectem.demo");
    const res = await request(app).get(
      `/api/v1/users/me/children/${samiraId}/notifications`,
    );
    expect(res.status).toBe(401);
  });

  it("rejects non-guardian users with 403", async () => {
    const samiraId = await findUserId("samira@kinectem.demo");
    const { agent: coach } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );
    const res = await coach.get(
      `/api/v1/users/me/children/${samiraId}/notifications`,
    );
    expect(res.status).toBe(403);
  });

  it("returns 404 for an unknown child id", async () => {
    const { agent: lisa } = await loginAs(
      (u) => u.email === "lisa@kinectem.demo",
    );
    const res = await lisa.get(
      "/api/v1/users/me/children/00000000-0000-0000-0000-000000000000/notifications",
    );
    expect(res.status).toBe(404);
  });

  it("aggregates direct notifications, tags, comments, messages, and roster events", async () => {
    const samiraId = await findUserId("samira@kinectem.demo");
    const lisaId = await findUserId("lisa@kinectem.demo");
    const coachId = await findUserId("coach@kinectem.demo");
    const teamId = await getAnyTeamId();

    // 1. Plant a direct notification for Samira
    const [notifRow] = await db
      .insert(notifications)
      .values({
        userId: samiraId,
        kind: "mention",
        message: "Coach mentioned you in a post",
        link: "/posts/test-post",
      })
      .returning();

    // 2. Plant an article + a tag of Samira on it
    const [article] = await db
      .insert(articles)
      .values({
        teamId,
        authorId: coachId,
        title: "Game Recap: Test Showdown",
        body: "Recap body",
        status: "published",
      })
      .returning();
    const [tag] = await db
      .insert(articleTags)
      .values({
        articleId: article.id,
        userId: samiraId,
        taggerUserId: coachId,
        status: "approved",
      })
      .returning();

    // 3. Plant a comment by the coach on that article (so it's about Samira)
    const [comment] = await db
      .insert(postComments)
      .values({
        postKind: "article",
        postRefId: article.id,
        authorId: coachId,
        body: "Great game from Samira tonight!",
      })
      .returning();

    // 4. Plant a DM to Samira from the coach
    const [conv] = await db
      .insert(conversations)
      .values({ kind: "direct" })
      .returning();
    await db.insert(conversationParticipants).values([
      {
        conversationId: conv.id,
        participantType: "user",
        participantId: samiraId,
      },
      {
        conversationId: conv.id,
        participantType: "user",
        participantId: coachId,
      },
    ]);
    const [msg] = await db
      .insert(messages)
      .values({
        conversationId: conv.id,
        senderUserId: coachId,
        body: "Nice work today!",
      })
      .returning();

    // Now fetch the parent inbox
    const { agent: lisa } = await loginAs(
      (u) => u.email === "lisa@kinectem.demo",
    );
    const res = await lisa.get(
      `/api/v1/users/me/children/${samiraId}/notifications`,
    );
    expect(res.status).toBe(200);
    const data = res.body.data as Array<{
      itemKey: string;
      kind: string;
      isRead: boolean;
    }>;
    const keys = new Set(data.map((d) => d.itemKey));
    expect(keys.has(`notification:${notifRow.id}`)).toBe(true);
    expect(keys.has(`tag:${tag.id}`)).toBe(true);
    expect(keys.has(`comment:${comment.id}`)).toBe(true);
    expect(keys.has(`message:${msg.id}`)).toBe(true);
    // All of the above start unread for the parent
    for (const k of [
      `notification:${notifRow.id}`,
      `tag:${tag.id}`,
      `comment:${comment.id}`,
      `message:${msg.id}`,
    ]) {
      const item = data.find((d) => d.itemKey === k);
      expect(item?.isRead).toBe(false);
    }
    expect(typeof res.body.unreadCount).toBe("number");
    expect(res.body.unreadCount).toBeGreaterThanOrEqual(4);

    // Mark the tag as read on behalf of the child as the parent
    const markRes = await lisa
      .post(`/api/v1/users/me/children/${samiraId}/notifications/read`)
      .send({ itemKey: `tag:${tag.id}` });
    expect(markRes.status).toBe(204);

    // The parent's read state row exists
    const reads = await db
      .select()
      .from(parentChildNotificationReads)
      .where(
        and(
          eq(parentChildNotificationReads.parentId, lisaId),
          eq(parentChildNotificationReads.childId, samiraId),
          eq(parentChildNotificationReads.itemKey, `tag:${tag.id}`),
        ),
      );
    expect(reads.length).toBe(1);

    // The CHILD's own notification row was NOT touched — parent-side
    // read state must not bleed into the child's view.
    const [childNotifAfter] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, notifRow.id));
    expect(childNotifAfter.read).toBe(false);

    // Refetching shows the tag as read but the others still unread
    const res2 = await lisa.get(
      `/api/v1/users/me/children/${samiraId}/notifications`,
    );
    expect(res2.status).toBe(200);
    const data2 = res2.body.data as Array<{
      itemKey: string;
      isRead: boolean;
    }>;
    const tagItem = data2.find((d) => d.itemKey === `tag:${tag.id}`);
    expect(tagItem?.isRead).toBe(true);
    const notifItem = data2.find(
      (d) => d.itemKey === `notification:${notifRow.id}`,
    );
    expect(notifItem?.isRead).toBe(false);

    // Mark all as read
    const markAll = await lisa.post(
      `/api/v1/users/me/children/${samiraId}/notifications/read-all`,
    );
    expect(markAll.status).toBe(200);
    expect(markAll.body.markedCount).toBeGreaterThanOrEqual(3);

    // Now everything should be read and unreadCount should be 0
    const res3 = await lisa.get(
      `/api/v1/users/me/children/${samiraId}/notifications`,
    );
    expect(res3.status).toBe(200);
    const data3 = res3.body.data as Array<{ isRead: boolean }>;
    expect(data3.every((d) => d.isRead)).toBe(true);
    expect(res3.body.unreadCount).toBe(0);
  });

  it("rejects unknown item kinds when marking as read", async () => {
    const samiraId = await findUserId("samira@kinectem.demo");
    const { agent: lisa } = await loginAs(
      (u) => u.email === "lisa@kinectem.demo",
    );
    const res = await lisa
      .post(`/api/v1/users/me/children/${samiraId}/notifications/read`)
      .send({ itemKey: "evil:abc" });
    expect(res.status).toBe(400);
  });

  it("summarizes per-child unread counts in one round-trip for the bell", async () => {
    const samiraId = await findUserId("samira@kinectem.demo");
    const lisaId = await findUserId("lisa@kinectem.demo");

    // Plant one fresh direct notification for Samira so she has at
    // least one unread item from the parent's perspective.
    const [notifRow] = await db
      .insert(notifications)
      .values({
        userId: samiraId,
        kind: "mention",
        message: "Summary endpoint test ping",
        link: "/posts/whatever",
      })
      .returning();

    const { agent: lisa } = await loginAs(
      (u) => u.email === "lisa@kinectem.demo",
    );
    const res = await lisa.get(
      "/api/v1/users/me/children-notifications-summary",
    );
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    const samiraEntry = (
      res.body.data as Array<{ childId: string; unreadCount: number }>
    ).find((d) => d.childId === samiraId);
    expect(samiraEntry).toBeDefined();
    expect(samiraEntry!.unreadCount).toBeGreaterThanOrEqual(1);
    expect(typeof res.body.totalUnreadCount).toBe("number");
    expect(res.body.totalUnreadCount).toBeGreaterThanOrEqual(1);

    // Marking the item as read drops the count back down on the
    // next call so the bell badge can shrink.
    const markRes = await lisa
      .post(`/api/v1/users/me/children/${samiraId}/notifications/read`)
      .send({ itemKey: `notification:${notifRow.id}` });
    expect(markRes.status).toBe(204);

    const res2 = await lisa.get(
      "/api/v1/users/me/children-notifications-summary",
    );
    expect(res2.status).toBe(200);
    const samiraEntry2 = (
      res2.body.data as Array<{ childId: string; unreadCount: number }>
    ).find((d) => d.childId === samiraId);
    expect(samiraEntry2).toBeDefined();
    expect(samiraEntry2!.unreadCount).toBe(
      Math.max(0, samiraEntry!.unreadCount - 1),
    );

    // Anonymous callers must be rejected.
    const anon = await request(app).get(
      "/api/v1/users/me/children-notifications-summary",
    );
    expect(anon.status).toBe(401);

    // Avoid bleeding state into other tests in this suite.
    await db
      .delete(parentChildNotificationReads)
      .where(
        and(
          eq(parentChildNotificationReads.parentId, lisaId),
          eq(parentChildNotificationReads.childId, samiraId),
        ),
      );
    await db.delete(notifications).where(eq(notifications.id, notifRow.id));
  });

  describe("Approve / Remove decisions", () => {
    it("approve drops the item from the default feed and records 'approved'", async () => {
      const samiraId = await findUserId("samira@kinectem.demo");
      const lisaId = await findUserId("lisa@kinectem.demo");
      // Plant a fresh direct notification we can decide on.
      const [notifRow] = await db
        .insert(notifications)
        .values({
          userId: samiraId,
          kind: "mention",
          message: "Approve me",
          link: "/posts/x",
        })
        .returning();
      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const itemKey = `notification:${notifRow.id}`;

      const before = await lisa.get(
        `/api/v1/users/me/children/${samiraId}/notifications`,
      );
      expect(before.status).toBe(200);
      const beforeKeys = (before.body.data as Array<{ itemKey: string }>).map(
        (d) => d.itemKey,
      );
      expect(beforeKeys).toContain(itemKey);
      const beforeUnread = before.body.unreadCount as number;

      const decideRes = await lisa
        .post(`/api/v1/users/me/children/${samiraId}/notifications/decision`)
        .send({ itemKey, decision: "approved" });
      expect(decideRes.status).toBe(200);
      expect(decideRes.body.decision).toBe("approved");

      const [readRow] = await db
        .select()
        .from(parentChildNotificationReads)
        .where(
          and(
            eq(parentChildNotificationReads.parentId, lisaId),
            eq(parentChildNotificationReads.childId, samiraId),
            eq(parentChildNotificationReads.itemKey, itemKey),
          ),
        );
      expect(readRow?.decision).toBe("approved");
      expect(readRow?.decidedAt).toBeTruthy();

      const after = await lisa.get(
        `/api/v1/users/me/children/${samiraId}/notifications`,
      );
      const afterKeys = (after.body.data as Array<{ itemKey: string }>).map(
        (d) => d.itemKey,
      );
      expect(afterKeys).not.toContain(itemKey);
      expect(after.body.unreadCount).toBe(Math.max(0, beforeUnread - 1));

      // The bell should no longer count this item either.
      const summary = await lisa.get(
        "/api/v1/users/me/children-notifications-summary",
      );
      const samiraEntry = (
        summary.body.data as Array<{ childId: string; unreadCount: number }>
      ).find((d) => d.childId === samiraId);
      expect(samiraEntry?.unreadCount).toBe(
        Math.max(0, beforeUnread - 1),
      );

      await db.delete(notifications).where(eq(notifications.id, notifRow.id));
    });

    it("approve does NOT change the underlying tag/comment/message rows", async () => {
      const samiraId = await findUserId("samira@kinectem.demo");
      const coachId = await findUserId("coach@kinectem.demo");
      const teamId = await getAnyTeamId();

      const [article] = await db
        .insert(articles)
        .values({
          teamId,
          authorId: coachId,
          title: "Approve safety check",
          body: "x",
          status: "published",
        })
        .returning();
      const [tag] = await db
        .insert(articleTags)
        .values({
          articleId: article.id,
          userId: samiraId,
          taggerUserId: coachId,
          status: "approved",
        })
        .returning();

      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const decideRes = await lisa
        .post(`/api/v1/users/me/children/${samiraId}/notifications/decision`)
        .send({ itemKey: `tag:${tag.id}`, decision: "approved" });
      expect(decideRes.status).toBe(200);

      const [tagAfter] = await db
        .select()
        .from(articleTags)
        .where(eq(articleTags.id, tag.id));
      // Approve must not flip a tag to declined or pending.
      expect(tagAfter?.status).toBe("approved");
    });

    it("remove on a tag declines it AND drops the row from the feed", async () => {
      const samiraId = await findUserId("samira@kinectem.demo");
      const coachId = await findUserId("coach@kinectem.demo");
      const teamId = await getAnyTeamId();

      const [article] = await db
        .insert(articles)
        .values({
          teamId,
          authorId: coachId,
          title: "Remove tag test",
          body: "x",
          status: "published",
        })
        .returning();
      const [tag] = await db
        .insert(articleTags)
        .values({
          articleId: article.id,
          userId: samiraId,
          taggerUserId: coachId,
          status: "approved",
        })
        .returning();

      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const itemKey = `tag:${tag.id}`;
      const res = await lisa
        .post(`/api/v1/users/me/children/${samiraId}/notifications/decision`)
        .send({ itemKey, decision: "removed" });
      expect(res.status).toBe(200);

      const [tagAfter] = await db
        .select()
        .from(articleTags)
        .where(eq(articleTags.id, tag.id));
      expect(tagAfter?.status).toBe("declined");

      const after = await lisa.get(
        `/api/v1/users/me/children/${samiraId}/notifications`,
      );
      const afterKeys = (after.body.data as Array<{ itemKey: string }>).map(
        (d) => d.itemKey,
      );
      expect(afterKeys).not.toContain(itemKey);
    });

    it("remove on a comment hides it (sets hiddenAt)", async () => {
      const samiraId = await findUserId("samira@kinectem.demo");
      const coachId = await findUserId("coach@kinectem.demo");
      const teamId = await getAnyTeamId();

      const [article] = await db
        .insert(articles)
        .values({
          teamId,
          authorId: coachId,
          title: "Remove comment test",
          body: "x",
          status: "published",
        })
        .returning();
      // Tag samira so the comment surfaces in her parent's feed.
      await db.insert(articleTags).values({
        articleId: article.id,
        userId: samiraId,
        taggerUserId: coachId,
        status: "approved",
      });
      const [comment] = await db
        .insert(postComments)
        .values({
          postKind: "article",
          postRefId: article.id,
          authorId: coachId,
          body: "Remove me please",
        })
        .returning();

      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const res = await lisa
        .post(`/api/v1/users/me/children/${samiraId}/notifications/decision`)
        .send({ itemKey: `comment:${comment.id}`, decision: "removed" });
      expect(res.status).toBe(200);

      const [commentAfter] = await db
        .select()
        .from(postComments)
        .where(eq(postComments.id, comment.id));
      expect(commentAfter?.hiddenAt).toBeTruthy();
    });

    it("remove on a message inserts a per-child hide row", async () => {
      const samiraId = await findUserId("samira@kinectem.demo");
      const coachId = await findUserId("coach@kinectem.demo");

      const [conv] = await db
        .insert(conversations)
        .values({ kind: "direct" })
        .returning();
      await db.insert(conversationParticipants).values([
        {
          conversationId: conv.id,
          participantType: "user",
          participantId: samiraId,
        },
        {
          conversationId: conv.id,
          participantType: "user",
          participantId: coachId,
        },
      ]);
      const [msg] = await db
        .insert(messages)
        .values({
          conversationId: conv.id,
          senderUserId: coachId,
          body: "Inappropriate message",
        })
        .returning();

      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const res = await lisa
        .post(`/api/v1/users/me/children/${samiraId}/notifications/decision`)
        .send({ itemKey: `message:${msg.id}`, decision: "removed" });
      expect(res.status).toBe(200);

      const hides = await db
        .select()
        .from(messageChildHides)
        .where(
          and(
            eq(messageChildHides.messageId, msg.id),
            eq(messageChildHides.childId, samiraId),
          ),
        );
      expect(hides.length).toBe(1);

      // Subsequent fetches no longer include the message.
      const after = await lisa.get(
        `/api/v1/users/me/children/${samiraId}/notifications`,
      );
      const keys = (after.body.data as Array<{ itemKey: string }>).map(
        (d) => d.itemKey,
      );
      expect(keys).not.toContain(`message:${msg.id}`);
    });

    it("remove on a roster entry deletes it like the formal decline endpoint", async () => {
      const samiraId = await findUserId("samira@kinectem.demo");
      const teamId = await getAnyTeamId();
      const [entry] = await db
        .insert(rosterEntries)
        .values({
          teamId,
          userId: samiraId,
          role: "player",
          status: "pending",
        })
        .returning();

      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const res = await lisa
        .post(`/api/v1/users/me/children/${samiraId}/notifications/decision`)
        .send({ itemKey: `roster:${entry.id}`, decision: "removed" });
      expect(res.status).toBe(200);

      const remaining = await db
        .select()
        .from(rosterEntries)
        .where(eq(rosterEntries.id, entry.id));
      expect(remaining.length).toBe(0);
    });

    it("remove on an ACCEPTED roster entry leaves membership intact (just-dismiss)", async () => {
      // Regression for the over-broad delete: a "child joined the team"
      // event must not let the parent quietly delete an existing
      // membership through the dashboard. Remove on an accepted entry
      // must record the decision (so the row disappears) but leave the
      // rosterEntries row untouched.
      const samiraId = await findUserId("samira@kinectem.demo");
      const teamId = await getAnyTeamId();
      const [entry] = await db
        .insert(rosterEntries)
        .values({
          teamId,
          userId: samiraId,
          role: "player",
          status: "accepted",
        })
        .returning();

      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const res = await lisa
        .post(`/api/v1/users/me/children/${samiraId}/notifications/decision`)
        .send({ itemKey: `roster:${entry.id}`, decision: "removed" });
      expect(res.status).toBe(200);

      // Membership is preserved.
      const remaining = await db
        .select()
        .from(rosterEntries)
        .where(eq(rosterEntries.id, entry.id));
      expect(remaining.length).toBe(1);
      expect(remaining[0].status).toBe("accepted");

      // But the item is now hidden from the dashboard stream.
      const after = await lisa.get(
        `/api/v1/users/me/children/${samiraId}/notifications`,
      );
      const keys = (after.body.data as Array<{ itemKey: string }>).map(
        (d) => d.itemKey,
      );
      expect(keys).not.toContain(`roster:${entry.id}`);
    });

    it("rejects unknown decision values", async () => {
      const samiraId = await findUserId("samira@kinectem.demo");
      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const res = await lisa
        .post(`/api/v1/users/me/children/${samiraId}/notifications/decision`)
        .send({ itemKey: "notification:abc", decision: "evil" });
      expect(res.status).toBe(400);
    });

    it("non-guardian callers cannot decide on a child's items", async () => {
      const samiraId = await findUserId("samira@kinectem.demo");
      const { agent: coach } = await loginAs(
        (u) => u.email === "coach@kinectem.demo",
      );
      const res = await coach
        .post(`/api/v1/users/me/children/${samiraId}/notifications/decision`)
        .send({ itemKey: "notification:abc", decision: "approved" });
      expect(res.status).toBe(403);
    });

    it("returns 404 when itemKey is not in this child's stream and has no prior decision", async () => {
      const samiraId = await findUserId("samira@kinectem.demo");
      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      // Well-formed but completely fabricated reference. The shape passes
      // validation, but no real tag with this id is in Samira's stream.
      const fakeItemKey = `tag:00000000-0000-0000-0000-000000000999`;
      const res = await lisa
        .post(`/api/v1/users/me/children/${samiraId}/notifications/decision`)
        .send({ itemKey: fakeItemKey, decision: "removed" });
      expect(res.status).toBe(404);
    });

    it("rejects an attempt by a parent to mutate another child's tag (IDOR scope)", async () => {
      // Plant a tag that belongs to a different athlete (NOT Samira) on
      // an article. Then have Lisa (Samira's parent) try to use that
      // foreign tag id as if it were in Samira's stream. Membership
      // validation must reject this with a 404 — and the foreign tag
      // must remain untouched.
      const samiraId = await findUserId("samira@kinectem.demo");
      const coachId = await findUserId("coach@kinectem.demo");
      const otherAthleteId = await findUserId("marcus@kinectem.demo");
      const teamId = await getAnyTeamId();
      const [article] = await db
        .insert(articles)
        .values({
          teamId,
          authorId: coachId,
          title: "Foreign tag IDOR",
          body: "x",
          status: "published",
        })
        .returning();
      const [foreignTag] = await db
        .insert(articleTags)
        .values({
          articleId: article.id,
          userId: otherAthleteId,
          taggerUserId: coachId,
          status: "approved",
        })
        .returning();

      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const res = await lisa
        .post(`/api/v1/users/me/children/${samiraId}/notifications/decision`)
        .send({ itemKey: `tag:${foreignTag.id}`, decision: "removed" });
      expect(res.status).toBe(404);

      const [tagAfter] = await db
        .select()
        .from(articleTags)
        .where(eq(articleTags.id, foreignTag.id));
      // The foreign tag must still be approved — the IDOR attempt
      // must NOT have flipped its status.
      expect(tagAfter?.status).toBe("approved");
    });

    it("removing the same item twice is idempotent (second call still 200)", async () => {
      const samiraId = await findUserId("samira@kinectem.demo");
      const coachId = await findUserId("coach@kinectem.demo");
      const teamId = await getAnyTeamId();
      const [article] = await db
        .insert(articles)
        .values({
          teamId,
          authorId: coachId,
          title: "Idempotent remove",
          body: "x",
          status: "published",
        })
        .returning();
      const [tag] = await db
        .insert(articleTags)
        .values({
          articleId: article.id,
          userId: samiraId,
          taggerUserId: coachId,
          status: "approved",
        })
        .returning();

      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const itemKey = `tag:${tag.id}`;
      const first = await lisa
        .post(`/api/v1/users/me/children/${samiraId}/notifications/decision`)
        .send({ itemKey, decision: "removed" });
      expect(first.status).toBe(200);
      // The tag is now declined and the item drops out of the stream.
      // A second Remove should be safely ignored — and a flip back to
      // Approve must succeed because a prior decision row exists.
      const second = await lisa
        .post(`/api/v1/users/me/children/${samiraId}/notifications/decision`)
        .send({ itemKey, decision: "removed" });
      expect(second.status).toBe(200);
      const flip = await lisa
        .post(`/api/v1/users/me/children/${samiraId}/notifications/decision`)
        .send({ itemKey, decision: "approved" });
      expect(flip.status).toBe(200);
    });

    it("remove on a like notification only revokes the actor's reaction on the specific post (scoped, not global)", async () => {
      const samiraId = await findUserId("samira@kinectem.demo");
      const coachId = await findUserId("coach@kinectem.demo");
      const teamId = await getAnyTeamId();
      // Two posts — one referenced by the notification, one unrelated.
      const [postA] = await db
        .insert(articles)
        .values({
          teamId,
          authorId: samiraId,
          title: "Post A (notif targets this)",
          body: "x",
          status: "published",
        })
        .returning();
      const [postB] = await db
        .insert(articles)
        .values({
          teamId,
          authorId: samiraId,
          title: "Post B (unrelated)",
          body: "x",
          status: "published",
        })
        .returning();
      // Coach reacted to BOTH posts.
      await db.insert(postReactions).values([
        {
          postKind: "article",
          postRefId: postA.id,
          userId: coachId,
          reactionType: "like",
        },
        {
          postKind: "article",
          postRefId: postB.id,
          userId: coachId,
          reactionType: "like",
        },
      ]);
      // Notification carrying actorUserId + link to postA.
      const [notif] = await db
        .insert(notifications)
        .values({
          userId: samiraId,
          actorUserId: coachId,
          kind: "reaction",
          message: "Coach liked your post",
          link: `/posts/article-${postA.id}`,
        })
        .returning();

      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const res = await lisa
        .post(`/api/v1/users/me/children/${samiraId}/notifications/decision`)
        .send({ itemKey: `notification:${notif.id}`, decision: "removed" });
      expect(res.status).toBe(200);

      // Reaction on the targeted post is gone…
      const onA = await db
        .select()
        .from(postReactions)
        .where(
          and(
            eq(postReactions.postKind, "article"),
            eq(postReactions.postRefId, postA.id),
            eq(postReactions.userId, coachId),
          ),
        );
      expect(onA.length).toBe(0);
      // …but the unrelated reaction must remain.
      const onB = await db
        .select()
        .from(postReactions)
        .where(
          and(
            eq(postReactions.postKind, "article"),
            eq(postReactions.postRefId, postB.id),
            eq(postReactions.userId, coachId),
          ),
        );
      expect(onB.length).toBe(1);

      await db.delete(notifications).where(eq(notifications.id, notif.id));
    });

    it("remove on a follow notification revokes only the (actor → child) edge", async () => {
      const samiraId = await findUserId("samira@kinectem.demo");
      const coachId = await findUserId("coach@kinectem.demo");
      // Coach follows Samira AND a third party — the third-party edge
      // must remain untouched.
      const otherUserId = await findUserId("marcus@kinectem.demo");
      await db
        .insert(userFollowers)
        .values([
          { followerUserId: coachId, followingUserId: samiraId },
          { followerUserId: coachId, followingUserId: otherUserId },
        ])
        .onConflictDoNothing();
      const [notif] = await db
        .insert(notifications)
        .values({
          userId: samiraId,
          actorUserId: coachId,
          kind: "follow",
          message: "Coach started following you",
          link: `/users/${coachId}`,
        })
        .returning();

      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const res = await lisa
        .post(`/api/v1/users/me/children/${samiraId}/notifications/decision`)
        .send({ itemKey: `notification:${notif.id}`, decision: "removed" });
      expect(res.status).toBe(200);

      const stillFollowingSamira = await db
        .select()
        .from(userFollowers)
        .where(
          and(
            eq(userFollowers.followerUserId, coachId),
            eq(userFollowers.followingUserId, samiraId),
          ),
        );
      expect(stillFollowingSamira.length).toBe(0);
      const stillFollowingOther = await db
        .select()
        .from(userFollowers)
        .where(
          and(
            eq(userFollowers.followerUserId, coachId),
            eq(userFollowers.followingUserId, otherUserId),
          ),
        );
      expect(stillFollowingOther.length).toBe(1);

      // Cleanup.
      await db.delete(notifications).where(eq(notifications.id, notif.id));
      await db
        .delete(userFollowers)
        .where(
          and(
            eq(userFollowers.followerUserId, coachId),
            eq(userFollowers.followingUserId, otherUserId),
          ),
        );
    });

    it("approve-all stamps every visible item and zeroes the unread count", async () => {
      const samiraId = await findUserId("samira@kinectem.demo");
      const lisaId = await findUserId("lisa@kinectem.demo");
      // Plant two fresh notifications we can approve in one shot.
      const planted = await db
        .insert(notifications)
        .values([
          {
            userId: samiraId,
            kind: "mention",
            message: "Approve-all #1",
            link: "/posts/aa1",
          },
          {
            userId: samiraId,
            kind: "mention",
            message: "Approve-all #2",
            link: "/posts/aa2",
          },
        ])
        .returning();

      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const before = await lisa.get(
        `/api/v1/users/me/children/${samiraId}/notifications`,
      );
      const beforeUnread = before.body.unreadCount as number;
      expect(beforeUnread).toBeGreaterThanOrEqual(2);

      const res = await lisa.post(
        `/api/v1/users/me/children/${samiraId}/notifications/approve-all`,
      );
      expect(res.status).toBe(200);
      expect(res.body.approvedCount).toBeGreaterThanOrEqual(2);

      const after = await lisa.get(
        `/api/v1/users/me/children/${samiraId}/notifications`,
      );
      expect(after.body.data).toEqual([]);
      expect(after.body.unreadCount).toBe(0);

      // Persisted decisions for both items.
      const reads = await db
        .select()
        .from(parentChildNotificationReads)
        .where(
          and(
            eq(parentChildNotificationReads.parentId, lisaId),
            eq(parentChildNotificationReads.childId, samiraId),
          ),
        );
      const approvedKeys = reads
        .filter((r) => r.decision === "approved")
        .map((r) => r.itemKey);
      for (const n of planted) {
        expect(approvedKeys).toContain(`notification:${n.id}`);
      }

      // Cleanup so subsequent tests start fresh.
      await db
        .delete(notifications)
        .where(eq(notifications.userId, samiraId));
    });
  });

  it("does not surface comments authored by the child themselves", async () => {
    const samiraId = await findUserId("samira@kinectem.demo");
    const teamId = await getAnyTeamId();

    // Samira authors an article and comments on it
    const [article] = await db
      .insert(articles)
      .values({
        teamId,
        authorId: samiraId,
        title: "My own post",
        body: "x",
        status: "published",
      })
      .returning();
    const [selfComment] = await db
      .insert(postComments)
      .values({
        postKind: "article",
        postRefId: article.id,
        authorId: samiraId,
        body: "self comment",
      })
      .returning();

    const { agent: lisa } = await loginAs(
      (u) => u.email === "lisa@kinectem.demo",
    );
    const res = await lisa.get(
      `/api/v1/users/me/children/${samiraId}/notifications`,
    );
    expect(res.status).toBe(200);
    const data = res.body.data as Array<{ itemKey: string }>;
    const keys = new Set(data.map((d) => d.itemKey));
    expect(keys.has(`comment:${selfComment.id}`)).toBe(false);
  });
});
