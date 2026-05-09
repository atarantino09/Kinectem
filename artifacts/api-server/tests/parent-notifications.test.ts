import { describe, expect, it, beforeEach } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  users,
  notifications,
  parentChildNotificationReads,
  articles,
  articleTags,
  highlights,
  highlightTags,
  postComments,
  postReactions,
  userFollowers,
  conversations,
  conversationParticipants,
  messages,
  messageChildHides,
  rosterEntries,
  teams,
  teamFollowers,
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
        status: "pending",
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

    it("approve on a tag flips it to approved (never declined or pending)", async () => {
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
          status: "pending",
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
      // Approve must land the tag at `approved` — never declined and
      // never left at pending.
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
          status: "pending",
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

    it("approve on a pending roster entry flips it to accepted and auto-follows the team for child + parent", async () => {
      const samiraId = await findUserId("samira@kinectem.demo");
      const lisaId = await findUserId("lisa@kinectem.demo");
      const teamId = await getAnyTeamId();
      // Wipe existing roster + follow rows for a clean slate.
      await db
        .delete(rosterEntries)
        .where(
          and(
            eq(rosterEntries.teamId, teamId),
            eq(rosterEntries.userId, samiraId),
          ),
        );
      await db
        .delete(teamFollowers)
        .where(
          and(eq(teamFollowers.teamId, teamId), eq(teamFollowers.userId, samiraId)),
        );
      await db
        .delete(teamFollowers)
        .where(
          and(eq(teamFollowers.teamId, teamId), eq(teamFollowers.userId, lisaId)),
        );
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
        .send({ itemKey: `roster:${entry.id}`, decision: "approved" });
      expect(res.status).toBe(200);
      expect(res.body.decision).toBe("approved");

      // Roster entry is now accepted.
      const [after] = await db
        .select()
        .from(rosterEntries)
        .where(eq(rosterEntries.id, entry.id));
      expect(after?.status).toBe("accepted");

      // Child + parent both auto-followed the team.
      const childFollow = await db
        .select()
        .from(teamFollowers)
        .where(
          and(eq(teamFollowers.teamId, teamId), eq(teamFollowers.userId, samiraId)),
        );
      expect(childFollow.length).toBe(1);
      const parentFollow = await db
        .select()
        .from(teamFollowers)
        .where(
          and(eq(teamFollowers.teamId, teamId), eq(teamFollowers.userId, lisaId)),
        );
      expect(parentFollow.length).toBe(1);

      // The parent's verdict row also captured the prior `pending` status
      // so an Undo can restore it.
      const [readRow] = await db
        .select()
        .from(parentChildNotificationReads)
        .where(
          and(
            eq(parentChildNotificationReads.parentId, lisaId),
            eq(parentChildNotificationReads.childId, samiraId),
            eq(parentChildNotificationReads.itemKey, `roster:${entry.id}`),
          ),
        );
      expect(readRow?.decision).toBe("approved");
      expect(readRow?.priorStatus).toBe("pending");
    });

    it("approve on an already-accepted roster entry is a no-op", async () => {
      const samiraId = await findUserId("samira@kinectem.demo");
      const teamId = await getAnyTeamId();
      await db
        .delete(rosterEntries)
        .where(
          and(
            eq(rosterEntries.teamId, teamId),
            eq(rosterEntries.userId, samiraId),
          ),
        );
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
        .send({ itemKey: `roster:${entry.id}`, decision: "approved" });
      expect(res.status).toBe(200);

      const [after] = await db
        .select()
        .from(rosterEntries)
        .where(eq(rosterEntries.id, entry.id));
      expect(after?.status).toBe("accepted");
    });

    it("after parent-inbox approve, child's GET /users/:userId/teams reports the team as active", async () => {
      const samiraId = await findUserId("samira@kinectem.demo");
      const teamId = await getAnyTeamId();
      await db
        .delete(rosterEntries)
        .where(
          and(
            eq(rosterEntries.teamId, teamId),
            eq(rosterEntries.userId, samiraId),
          ),
        );
      const [entry] = await db
        .insert(rosterEntries)
        .values({
          teamId,
          userId: samiraId,
          role: "player",
          status: "pending",
        })
        .returning();

      // Parent approves the invite from the family inbox.
      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const decideRes = await lisa
        .post(`/api/v1/users/me/children/${samiraId}/notifications/decision`)
        .send({ itemKey: `roster:${entry.id}`, decision: "approved" });
      expect(decideRes.status).toBe(200);

      // Child's own teams list should now show the team as active —
      // i.e. no `pending` entry survives — confirming the child no
      // longer sees Accept / Decline prompts on My Teams etc.
      const { agent: samira } = await loginAs(
        (u) => u.email === "samira@kinectem.demo",
      );
      const teamsRes = await samira.get(`/api/v1/users/${samiraId}/teams`);
      expect(teamsRes.status).toBe(200);
      const data = teamsRes.body.data as Array<{
        id: string;
        status?: string;
      }>;
      const match = data.find((row) => row.id === teamId);
      expect(match).toBeDefined();
      expect(match?.status).toBe("active");
      expect(data.some((row) => row.id === teamId && row.status === "pending"))
        .toBe(false);
    });

    it("undo of a parent-approve on a roster entry restores it to pending", async () => {
      const samiraId = await findUserId("samira@kinectem.demo");
      const teamId = await getAnyTeamId();
      await db
        .delete(rosterEntries)
        .where(
          and(
            eq(rosterEntries.teamId, teamId),
            eq(rosterEntries.userId, samiraId),
          ),
        );
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
      const itemKey = `roster:${entry.id}`;
      const decideRes = await lisa
        .post(`/api/v1/users/me/children/${samiraId}/notifications/decision`)
        .send({ itemKey, decision: "approved" });
      expect(decideRes.status).toBe(200);

      const undoRes = await lisa
        .post(
          `/api/v1/users/me/children/${samiraId}/notifications/unset-decision`,
        )
        .send({ itemKey });
      expect(undoRes.status).toBe(200);
      expect(undoRes.body.reverted).toBe("approved");

      const [after] = await db
        .select()
        .from(rosterEntries)
        .where(eq(rosterEntries.id, entry.id));
      expect(after?.status).toBe("pending");
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
          status: "pending",
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

    it("end-to-end: real POST /reactions creates a like notification with actorUserId, and Remove undoes the like", async () => {
      // This guards the wiring the family dashboard needs: the
      // notification row produced by the live like endpoint must
      // carry `actorUserId` so the parent's Remove action can
      // revoke the underlying reaction. If actorUserId regresses
      // to null, the Remove handler falls back to "just dismiss"
      // and the like quietly stays — exactly the bug this task
      // closes.
      const samiraId = await findUserId("samira@kinectem.demo");
      const coachId = await findUserId("coach@kinectem.demo");
      const teamId = await getAnyTeamId();
      const [post] = await db
        .insert(articles)
        .values({
          teamId,
          authorId: samiraId,
          title: "Round-trip like test",
          body: "x",
          status: "published",
        })
        .returning();
      const postId = `article-${post.id}`;

      // Coach hits the real reactions endpoint.
      const { agent: coach } = await loginAs(
        (u) => u.email === "coach@kinectem.demo",
      );
      const likeRes = await coach.post(`/api/v1/posts/${postId}/reactions`);
      expect(likeRes.status).toBe(204);

      // The notification row exists, addressed to Samira, with
      // actorUserId pointing at the coach and a parseable post link.
      const [notif] = await db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, samiraId),
            eq(notifications.actorUserId, coachId),
            eq(notifications.link, `/posts/${postId}`),
          ),
        )
        .limit(1);
      expect(notif).toBeDefined();
      expect(notif!.actorUserId).toBe(coachId);
      expect(/like|react/i.test(notif!.message)).toBe(true);

      // Parent removes the notification — the reaction must vanish.
      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const decideRes = await lisa
        .post(`/api/v1/users/me/children/${samiraId}/notifications/decision`)
        .send({
          itemKey: `notification:${notif!.id}`,
          decision: "removed",
        });
      expect(decideRes.status).toBe(200);

      const reactionAfter = await db
        .select()
        .from(postReactions)
        .where(
          and(
            eq(postReactions.postKind, "article"),
            eq(postReactions.postRefId, post.id),
            eq(postReactions.userId, coachId),
          ),
        );
      expect(reactionAfter.length).toBe(0);

      await db.delete(notifications).where(eq(notifications.id, notif!.id));
    });

    it("end-to-end: real POST /users/:id/follow creates a follow notification with actorUserId, and Remove undoes the follow", async () => {
      // Same shape as the like round-trip, for follows. Confirms the
      // follow endpoint writes the notification row with actorUserId
      // set so the parent's Remove can revoke the (follower → child)
      // edge end-to-end.
      const samiraId = await findUserId("samira@kinectem.demo");
      const coachId = await findUserId("coach@kinectem.demo");

      // Make sure no stale follow edge exists from a prior run so the
      // real endpoint actually inserts one (and creates the bell row).
      await db
        .delete(userFollowers)
        .where(
          and(
            eq(userFollowers.followerUserId, coachId),
            eq(userFollowers.followingUserId, samiraId),
          ),
        );

      const { agent: coach } = await loginAs(
        (u) => u.email === "coach@kinectem.demo",
      );
      const followRes = await coach.post(`/api/v1/users/${samiraId}/follow`);
      expect(followRes.status).toBe(201);

      const [notif] = await db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, samiraId),
            eq(notifications.actorUserId, coachId),
            eq(notifications.kind, "follow"),
          ),
        )
        .orderBy(desc(notifications.createdAt))
        .limit(1);
      expect(notif).toBeDefined();
      expect(notif!.actorUserId).toBe(coachId);
      expect(/follow/i.test(notif!.message)).toBe(true);

      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const decideRes = await lisa
        .post(`/api/v1/users/me/children/${samiraId}/notifications/decision`)
        .send({
          itemKey: `notification:${notif!.id}`,
          decision: "removed",
        });
      expect(decideRes.status).toBe(200);

      const followAfter = await db
        .select()
        .from(userFollowers)
        .where(
          and(
            eq(userFollowers.followerUserId, coachId),
            eq(userFollowers.followingUserId, samiraId),
          ),
        );
      expect(followAfter.length).toBe(0);

      await db.delete(notifications).where(eq(notifications.id, notif!.id));
    });

    it("approve on a pending article tag flips it to approved and drops it from the child's pending-tags list", async () => {
      const samiraId = await findUserId("samira@kinectem.demo");
      const coachId = await findUserId("coach@kinectem.demo");
      const teamId = await getAnyTeamId();

      const [article] = await db
        .insert(articles)
        .values({
          teamId,
          authorId: coachId,
          title: "Approve flips pending article tag",
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
          status: "pending",
        })
        .returning();

      // Sanity: the child sees this tag as pending before the parent acts.
      const { agent: samira } = await loginAs(
        (u) => u.email === "samira@kinectem.demo",
      );
      const before = await samira.get("/api/v1/tags/pending");
      expect(before.status).toBe(200);
      const beforeIds = (before.body.data as Array<{ id: string }>).map(
        (t) => t.id,
      );
      expect(beforeIds).toContain(tag.id);

      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const decideRes = await lisa
        .post(`/api/v1/users/me/children/${samiraId}/notifications/decision`)
        .send({ itemKey: `tag:${tag.id}`, decision: "approved" });
      expect(decideRes.status).toBe(200);
      expect(decideRes.body.decision).toBe("approved");

      const [tagAfter] = await db
        .select()
        .from(articleTags)
        .where(eq(articleTags.id, tag.id));
      expect(tagAfter?.status).toBe("approved");

      // The child's own pending-tags list no longer surfaces this tag.
      const after = await samira.get("/api/v1/tags/pending");
      expect(after.status).toBe(200);
      const afterIds = (after.body.data as Array<{ id: string }>).map(
        (t) => t.id,
      );
      expect(afterIds).not.toContain(tag.id);
    });

    it("approve on a pending highlight tag flips it to approved and drops it from the child's pending-tags list", async () => {
      const samiraId = await findUserId("samira@kinectem.demo");
      const coachId = await findUserId("coach@kinectem.demo");
      const teamId = await getAnyTeamId();

      const [highlight] = await db
        .insert(highlights)
        .values({
          teamId,
          uploaderId: coachId,
          title: "Big play clip",
          videoUrl: "https://example.com/clip.mp4",
        })
        .returning();
      const [tag] = await db
        .insert(highlightTags)
        .values({
          highlightId: highlight.id,
          userId: samiraId,
          taggerUserId: coachId,
          status: "pending",
        })
        .returning();

      const { agent: samira } = await loginAs(
        (u) => u.email === "samira@kinectem.demo",
      );
      const before = await samira.get("/api/v1/tags/pending");
      expect(before.status).toBe(200);
      const beforeIds = (before.body.data as Array<{ id: string }>).map(
        (t) => t.id,
      );
      expect(beforeIds).toContain(tag.id);

      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const decideRes = await lisa
        .post(`/api/v1/users/me/children/${samiraId}/notifications/decision`)
        .send({ itemKey: `tag:${tag.id}`, decision: "approved" });
      expect(decideRes.status).toBe(200);

      const [tagAfter] = await db
        .select()
        .from(highlightTags)
        .where(eq(highlightTags.id, tag.id));
      expect(tagAfter?.status).toBe("approved");

      const after = await samira.get("/api/v1/tags/pending");
      const afterIds = (after.body.data as Array<{ id: string }>).map(
        (t) => t.id,
      );
      expect(afterIds).not.toContain(tag.id);
    });

    it("remove on a pending highlight tag declines it AND drops the row from the feed", async () => {
      const samiraId = await findUserId("samira@kinectem.demo");
      const coachId = await findUserId("coach@kinectem.demo");
      const teamId = await getAnyTeamId();

      const [highlight] = await db
        .insert(highlights)
        .values({
          teamId,
          uploaderId: coachId,
          title: "Remove highlight tag clip",
          videoUrl: "https://example.com/clip.mp4",
        })
        .returning();
      const [tag] = await db
        .insert(highlightTags)
        .values({
          highlightId: highlight.id,
          userId: samiraId,
          taggerUserId: coachId,
          status: "pending",
        })
        .returning();

      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const itemKey = `tag:${tag.id}`;
      // Sanity: the pending highlight tag surfaces in the family inbox.
      const before = await lisa.get(
        `/api/v1/users/me/children/${samiraId}/notifications`,
      );
      const beforeKeys = (before.body.data as Array<{ itemKey: string }>).map(
        (d) => d.itemKey,
      );
      expect(beforeKeys).toContain(itemKey);

      const res = await lisa
        .post(`/api/v1/users/me/children/${samiraId}/notifications/decision`)
        .send({ itemKey, decision: "removed" });
      expect(res.status).toBe(200);

      const [tagAfter] = await db
        .select()
        .from(highlightTags)
        .where(eq(highlightTags.id, tag.id));
      expect(tagAfter?.status).toBe("declined");

      const after = await lisa.get(
        `/api/v1/users/me/children/${samiraId}/notifications`,
      );
      const afterKeys = (after.body.data as Array<{ itemKey: string }>).map(
        (d) => d.itemKey,
      );
      expect(afterKeys).not.toContain(itemKey);
    });

    it("child-side decision after inbox load drops the article tag row from the parent inbox and unread count", async () => {
      // Regression: the parent inbox previously kept showing a "Pending
      // — please review" row for an article tag even after the child
      // themselves had already approved/declined it via their own
      // pending-tags endpoint, because the row only disappeared when
      // the parent explicitly recorded a decision. The loader now
      // filters tag items to status='pending', so a child-side decision
      // drops the row from the next fetch immediately.
      const samiraId = await findUserId("samira@kinectem.demo");
      const lisaId = await findUserId("lisa@kinectem.demo");
      const coachId = await findUserId("coach@kinectem.demo");
      const teamId = await getAnyTeamId();

      const [article] = await db
        .insert(articles)
        .values({
          teamId,
          authorId: coachId,
          title: "Child-decides-after-inbox-load (article)",
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
          status: "pending",
        })
        .returning();

      const itemKey = `tag:${tag.id}`;
      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );

      // Step 1: parent loads the inbox while the tag is still pending.
      // It surfaces and is counted as unread.
      const before = await lisa.get(
        `/api/v1/users/me/children/${samiraId}/notifications`,
      );
      expect(before.status).toBe(200);
      const beforeKeys = (before.body.data as Array<{ itemKey: string }>).map(
        (d) => d.itemKey,
      );
      expect(beforeKeys).toContain(itemKey);
      const beforeUnread = before.body.unreadCount as number;
      expect(beforeUnread).toBeGreaterThanOrEqual(1);

      // Bell summary should also count the tag.
      const summaryBefore = await lisa.get(
        "/api/v1/users/me/children-notifications-summary",
      );
      const samiraBefore = (
        summaryBefore.body.data as Array<{
          childId: string;
          unreadCount: number;
        }>
      ).find((d) => d.childId === samiraId);
      expect(samiraBefore?.unreadCount).toBe(beforeUnread);

      // Step 2: the CHILD herself approves the tag through her own
      // /tags/:tagId/approve endpoint. The parent never recorded a
      // per-item decision in parent_child_notification_reads.
      const { agent: samira } = await loginAs(
        (u) => u.email === "samira@kinectem.demo",
      );
      const childApprove = await samira.post(`/api/v1/tags/${tag.id}/approve`);
      expect(childApprove.status).toBe(200);
      // Sanity: the underlying tag is now `approved`.
      const [tagAfterChild] = await db
        .select()
        .from(articleTags)
        .where(eq(articleTags.id, tag.id));
      expect(tagAfterChild?.status).toBe("approved");
      // And no parent decision row exists for this item.
      const reads = await db
        .select()
        .from(parentChildNotificationReads)
        .where(
          and(
            eq(parentChildNotificationReads.parentId, lisaId),
            eq(parentChildNotificationReads.childId, samiraId),
            eq(parentChildNotificationReads.itemKey, itemKey),
          ),
        );
      expect(reads.length).toBe(0);

      // Step 3: the parent's next fetch must NOT include the row, and
      // the unread count drops by exactly one.
      const after = await lisa.get(
        `/api/v1/users/me/children/${samiraId}/notifications`,
      );
      expect(after.status).toBe(200);
      const afterKeys = (after.body.data as Array<{ itemKey: string }>).map(
        (d) => d.itemKey,
      );
      expect(afterKeys).not.toContain(itemKey);
      expect(after.body.unreadCount).toBe(Math.max(0, beforeUnread - 1));

      // Bell summary stays consistent with the visible feed.
      const summaryAfter = await lisa.get(
        "/api/v1/users/me/children-notifications-summary",
      );
      const samiraAfter = (
        summaryAfter.body.data as Array<{
          childId: string;
          unreadCount: number;
        }>
      ).find((d) => d.childId === samiraId);
      expect(samiraAfter?.unreadCount).toBe(after.body.unreadCount);
    });

    it("child-side decision after inbox load drops the highlight tag row from the parent inbox", async () => {
      // Same regression as the article-tag case, but for the highlight-
      // tag branch of loadChildNotificationItems. A child decline via
      // /tags/:tagId/decline should immediately drop the row.
      const samiraId = await findUserId("samira@kinectem.demo");
      const coachId = await findUserId("coach@kinectem.demo");
      const teamId = await getAnyTeamId();

      const [highlight] = await db
        .insert(highlights)
        .values({
          teamId,
          uploaderId: coachId,
          title: "Child-decides-after-inbox-load (highlight)",
          videoUrl: "https://example.com/clip.mp4",
        })
        .returning();
      const [tag] = await db
        .insert(highlightTags)
        .values({
          highlightId: highlight.id,
          userId: samiraId,
          taggerUserId: coachId,
          status: "pending",
        })
        .returning();

      const itemKey = `tag:${tag.id}`;
      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const before = await lisa.get(
        `/api/v1/users/me/children/${samiraId}/notifications`,
      );
      const beforeKeys = (before.body.data as Array<{ itemKey: string }>).map(
        (d) => d.itemKey,
      );
      expect(beforeKeys).toContain(itemKey);

      // The child declines the tag herself.
      const { agent: samira } = await loginAs(
        (u) => u.email === "samira@kinectem.demo",
      );
      const childDecline = await samira.post(`/api/v1/tags/${tag.id}/decline`);
      expect(childDecline.status).toBe(200);
      const [tagAfter] = await db
        .select()
        .from(highlightTags)
        .where(eq(highlightTags.id, tag.id));
      expect(tagAfter?.status).toBe("declined");

      // The parent's inbox no longer surfaces the row.
      const after = await lisa.get(
        `/api/v1/users/me/children/${samiraId}/notifications`,
      );
      const afterKeys = (after.body.data as Array<{ itemKey: string }>).map(
        (d) => d.itemKey,
      );
      expect(afterKeys).not.toContain(itemKey);
    });

    it("approve does NOT revive a tag that was already declined", async () => {
      const samiraId = await findUserId("samira@kinectem.demo");
      const coachId = await findUserId("coach@kinectem.demo");
      const teamId = await getAnyTeamId();

      const [article] = await db
        .insert(articles)
        .values({
          teamId,
          authorId: coachId,
          title: "Approve must not revive declined",
          body: "x",
          status: "published",
        })
        .returning();
      // Hand-insert a declined tag and a prior parent decision so the
      // membership check passes via the `prior` lookup (the loader
      // skips declined tags).
      const [tag] = await db
        .insert(articleTags)
        .values({
          articleId: article.id,
          userId: samiraId,
          taggerUserId: coachId,
          status: "declined",
        })
        .returning();
      const lisaId = await findUserId("lisa@kinectem.demo");
      await db.insert(parentChildNotificationReads).values({
        parentId: lisaId,
        childId: samiraId,
        itemKey: `tag:${tag.id}`,
        decision: "removed",
        decidedAt: new Date(),
      });

      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const decideRes = await lisa
        .post(`/api/v1/users/me/children/${samiraId}/notifications/decision`)
        .send({ itemKey: `tag:${tag.id}`, decision: "approved" });
      expect(decideRes.status).toBe(200);

      // Status must remain `declined` — parent approval cannot
      // resurrect a previously-declined tag.
      const [tagAfter] = await db
        .select()
        .from(articleTags)
        .where(eq(articleTags.id, tag.id));
      expect(tagAfter?.status).toBe("declined");
    });

    it("approve-all flips every pending article and highlight tag in the visible stream", async () => {
      const samiraId = await findUserId("samira@kinectem.demo");
      const coachId = await findUserId("coach@kinectem.demo");
      const teamId = await getAnyTeamId();

      // One pending article tag…
      const [article] = await db
        .insert(articles)
        .values({
          teamId,
          authorId: coachId,
          title: "Approve-all article tag",
          body: "x",
          status: "published",
        })
        .returning();
      const [aTag] = await db
        .insert(articleTags)
        .values({
          articleId: article.id,
          userId: samiraId,
          taggerUserId: coachId,
          status: "pending",
        })
        .returning();

      // …and one pending highlight tag.
      const [highlight] = await db
        .insert(highlights)
        .values({
          teamId,
          uploaderId: coachId,
          title: "Approve-all highlight tag",
          videoUrl: "https://example.com/clip.mp4",
        })
        .returning();
      const [hTag] = await db
        .insert(highlightTags)
        .values({
          highlightId: highlight.id,
          userId: samiraId,
          taggerUserId: coachId,
          status: "pending",
        })
        .returning();

      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      // Sanity: both tags surface in the family inbox before approve-all.
      const before = await lisa.get(
        `/api/v1/users/me/children/${samiraId}/notifications`,
      );
      const beforeKeys = (before.body.data as Array<{ itemKey: string }>).map(
        (d) => d.itemKey,
      );
      expect(beforeKeys).toContain(`tag:${aTag.id}`);
      expect(beforeKeys).toContain(`tag:${hTag.id}`);

      const res = await lisa.post(
        `/api/v1/users/me/children/${samiraId}/notifications/approve-all`,
      );
      expect(res.status).toBe(200);
      expect(res.body.approvedCount).toBeGreaterThanOrEqual(2);

      const [aAfter] = await db
        .select()
        .from(articleTags)
        .where(eq(articleTags.id, aTag.id));
      const [hAfter] = await db
        .select()
        .from(highlightTags)
        .where(eq(highlightTags.id, hTag.id));
      expect(aAfter?.status).toBe("approved");
      expect(hAfter?.status).toBe("approved");
    });

    it("approve-all does not clobber an already-declined tag in the visible stream", async () => {
      // A declined tag is filtered out by the loader, so it isn't part
      // of the visible stream and approve-all must leave it as declined.
      const samiraId = await findUserId("samira@kinectem.demo");
      const coachId = await findUserId("coach@kinectem.demo");
      const teamId = await getAnyTeamId();

      const [article] = await db
        .insert(articles)
        .values({
          teamId,
          authorId: coachId,
          title: "Approve-all leaves declined alone",
          body: "x",
          status: "published",
        })
        .returning();
      const [declinedTag] = await db
        .insert(articleTags)
        .values({
          articleId: article.id,
          userId: samiraId,
          taggerUserId: coachId,
          status: "declined",
        })
        .returning();

      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const res = await lisa.post(
        `/api/v1/users/me/children/${samiraId}/notifications/approve-all`,
      );
      expect(res.status).toBe(200);

      const [tagAfter] = await db
        .select()
        .from(articleTags)
        .where(eq(articleTags.id, declinedTag.id));
      expect(tagAfter?.status).toBe("declined");
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

  describe("Recently decided history & undo", () => {
    it("default GET hides decided items, but includeDecided=true brings them back", async () => {
      const samiraId = await findUserId("samira@kinectem.demo");
      const [notif] = await db
        .insert(notifications)
        .values({
          userId: samiraId,
          kind: "mention",
          message: "History fixture",
          link: "/posts/history-1",
        })
        .returning();
      const itemKey = `notification:${notif.id}`;
      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      // Approve so it leaves the live feed.
      const decideRes = await lisa
        .post(`/api/v1/users/me/children/${samiraId}/notifications/decision`)
        .send({ itemKey, decision: "approved" });
      expect(decideRes.status).toBe(200);

      const defaultRes = await lisa.get(
        `/api/v1/users/me/children/${samiraId}/notifications`,
      );
      expect(defaultRes.status).toBe(200);
      const defaultKeys = (
        defaultRes.body.data as Array<{ itemKey: string }>
      ).map((d) => d.itemKey);
      expect(defaultKeys).not.toContain(itemKey);

      const decidedRes = await lisa.get(
        `/api/v1/users/me/children/${samiraId}/notifications?includeDecided=true`,
      );
      expect(decidedRes.status).toBe(200);
      const decidedRows = decidedRes.body.data as Array<{
        itemKey: string;
        decision: string | null;
      }>;
      const decidedRow = decidedRows.find((d) => d.itemKey === itemKey);
      expect(decidedRow).toBeTruthy();
      expect(decidedRow?.decision).toBe("approved");
      // unreadCount must reflect the live (non-decided) feed only.
      expect(decidedRes.body.unreadCount).toBe(defaultRes.body.unreadCount);

      await db.delete(notifications).where(eq(notifications.id, notif.id));
    });

    it("includeDecided still surfaces decided items even after the source row is gone (placeholder)", async () => {
      const samiraId = await findUserId("samira@kinectem.demo");
      const [notif] = await db
        .insert(notifications)
        .values({
          userId: samiraId,
          kind: "mention",
          message: "About to vanish",
          link: "/posts/vanish",
        })
        .returning();
      const itemKey = `notification:${notif.id}`;
      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const decideRes = await lisa
        .post(`/api/v1/users/me/children/${samiraId}/notifications/decision`)
        .send({ itemKey, decision: "removed" });
      expect(decideRes.status).toBe(200);

      // Source notification gets purged (e.g. retention cleanup).
      await db.delete(notifications).where(eq(notifications.id, notif.id));

      const decidedRes = await lisa.get(
        `/api/v1/users/me/children/${samiraId}/notifications?includeDecided=true`,
      );
      expect(decidedRes.status).toBe(200);
      const row = (
        decidedRes.body.data as Array<{
          itemKey: string;
          decision: string | null;
        }>
      ).find((d) => d.itemKey === itemKey);
      // Placeholder still shown so the parent can revert the decision.
      expect(row).toBeTruthy();
      expect(row?.decision).toBe("removed");
    });

    it("unset-decision deletes the parent read row and brings the item back to the live feed", async () => {
      const samiraId = await findUserId("samira@kinectem.demo");
      const lisaId = await findUserId("lisa@kinectem.demo");
      const [notif] = await db
        .insert(notifications)
        .values({
          userId: samiraId,
          kind: "mention",
          message: "Undo me",
          link: "/posts/undo-1",
        })
        .returning();
      const itemKey = `notification:${notif.id}`;
      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const approve = await lisa
        .post(`/api/v1/users/me/children/${samiraId}/notifications/decision`)
        .send({ itemKey, decision: "approved" });
      expect(approve.status).toBe(200);

      const undo = await lisa
        .post(
          `/api/v1/users/me/children/${samiraId}/notifications/unset-decision`,
        )
        .send({ itemKey });
      expect(undo.status).toBe(200);

      const reads = await db
        .select()
        .from(parentChildNotificationReads)
        .where(
          and(
            eq(parentChildNotificationReads.parentId, lisaId),
            eq(parentChildNotificationReads.childId, samiraId),
            eq(parentChildNotificationReads.itemKey, itemKey),
          ),
        );
      expect(reads.length).toBe(0);

      const after = await lisa.get(
        `/api/v1/users/me/children/${samiraId}/notifications`,
      );
      const keys = (after.body.data as Array<{ itemKey: string }>).map(
        (d) => d.itemKey,
      );
      expect(keys).toContain(itemKey);

      await db.delete(notifications).where(eq(notifications.id, notif.id));
    });

    it("unset-decision on a removed tag flips it back from declined to pending", async () => {
      const samiraId = await findUserId("samira@kinectem.demo");
      const coachId = await findUserId("coach@kinectem.demo");
      const teamId = await getAnyTeamId();
      const [article] = await db
        .insert(articles)
        .values({
          teamId,
          authorId: coachId,
          title: "Undo tag fixture",
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
          status: "pending",
        })
        .returning();
      const itemKey = `tag:${tag.id}`;
      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const remove = await lisa
        .post(`/api/v1/users/me/children/${samiraId}/notifications/decision`)
        .send({ itemKey, decision: "removed" });
      expect(remove.status).toBe(200);
      const [declined] = await db
        .select()
        .from(articleTags)
        .where(eq(articleTags.id, tag.id));
      expect(declined?.status).toBe("declined");

      const undo = await lisa
        .post(
          `/api/v1/users/me/children/${samiraId}/notifications/unset-decision`,
        )
        .send({ itemKey });
      expect(undo.status).toBe(200);

      const [restored] = await db
        .select()
        .from(articleTags)
        .where(eq(articleTags.id, tag.id));
      // Reverting a remove on a declined tag should put it back into the
      // parent's pending review queue.
      expect(restored?.status).toBe("pending");
    });

    it("unset-decision on a removed highlight tag flips it back from declined to pending", async () => {
      const samiraId = await findUserId("samira@kinectem.demo");
      const coachId = await findUserId("coach@kinectem.demo");
      const teamId = await getAnyTeamId();
      const [highlight] = await db
        .insert(highlights)
        .values({
          teamId,
          uploaderId: coachId,
          title: "Undo highlight tag fixture",
          videoUrl: "https://example.com/undo-clip.mp4",
        })
        .returning();
      const [tag] = await db
        .insert(highlightTags)
        .values({
          highlightId: highlight.id,
          userId: samiraId,
          taggerUserId: coachId,
          status: "pending",
        })
        .returning();
      const itemKey = `tag:${tag.id}`;
      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const remove = await lisa
        .post(`/api/v1/users/me/children/${samiraId}/notifications/decision`)
        .send({ itemKey, decision: "removed" });
      expect(remove.status).toBe(200);
      const [declined] = await db
        .select()
        .from(highlightTags)
        .where(eq(highlightTags.id, tag.id));
      expect(declined?.status).toBe("declined");

      const undo = await lisa
        .post(
          `/api/v1/users/me/children/${samiraId}/notifications/unset-decision`,
        )
        .send({ itemKey });
      expect(undo.status).toBe(200);

      const [restored] = await db
        .select()
        .from(highlightTags)
        .where(eq(highlightTags.id, tag.id));
      // Reverting a remove on a declined highlight tag should put it
      // back into the parent's pending review queue, mirroring the
      // article-tag undo path.
      expect(restored?.status).toBe("pending");
    });

    it("unset-decision on a removed comment clears hiddenAt", async () => {
      const samiraId = await findUserId("samira@kinectem.demo");
      const coachId = await findUserId("coach@kinectem.demo");
      const teamId = await getAnyTeamId();
      const [article] = await db
        .insert(articles)
        .values({
          teamId,
          authorId: coachId,
          title: "Undo comment fixture",
          body: "x",
          status: "published",
        })
        .returning();
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
          body: "Will be hidden then unhidden",
        })
        .returning();
      const itemKey = `comment:${comment.id}`;
      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const remove = await lisa
        .post(`/api/v1/users/me/children/${samiraId}/notifications/decision`)
        .send({ itemKey, decision: "removed" });
      expect(remove.status).toBe(200);
      const [hidden] = await db
        .select()
        .from(postComments)
        .where(eq(postComments.id, comment.id));
      expect(hidden?.hiddenAt).toBeTruthy();

      const undo = await lisa
        .post(
          `/api/v1/users/me/children/${samiraId}/notifications/unset-decision`,
        )
        .send({ itemKey });
      expect(undo.status).toBe(200);

      const [restored] = await db
        .select()
        .from(postComments)
        .where(eq(postComments.id, comment.id));
      expect(restored?.hiddenAt).toBeNull();
    });

    it("unset-decision on an unknown item key returns 404", async () => {
      const samiraId = await findUserId("samira@kinectem.demo");
      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const res = await lisa
        .post(
          `/api/v1/users/me/children/${samiraId}/notifications/unset-decision`,
        )
        .send({ itemKey: `notification:00000000-0000-0000-0000-000000000999` });
      expect(res.status).toBe(404);
    });

    it("unset-decision rejects non-guardian callers with 403", async () => {
      const samiraId = await findUserId("samira@kinectem.demo");
      const { agent: coach } = await loginAs(
        (u) => u.email === "coach@kinectem.demo",
      );
      const res = await coach
        .post(
          `/api/v1/users/me/children/${samiraId}/notifications/unset-decision`,
        )
        .send({ itemKey: "notification:abc" });
      expect(res.status).toBe(403);
    });

    it("unset-decision requires authentication", async () => {
      const samiraId = await findUserId("samira@kinectem.demo");
      const res = await request(app)
        .post(
          `/api/v1/users/me/children/${samiraId}/notifications/unset-decision`,
        )
        .send({ itemKey: "notification:abc" });
      expect(res.status).toBe(401);
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

  describe("Remove on child-authored posts", () => {
    it("Remove on an authoredArticle hides the article and an Undo restores it", async () => {
      const samiraId = await findUserId("samira@kinectem.demo");
      const lisaId = await findUserId("lisa@kinectem.demo");
      const teamId = await getAnyTeamId();
      const [article] = await db
        .insert(articles)
        .values({
          teamId,
          authorId: samiraId,
          title: "Samira's own article",
          body: "child-written body",
          status: "published",
        })
        .returning();
      const itemKey = `authoredArticle:${article.id}`;
      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );

      // Sanity: the authored article surfaces in the family inbox.
      const before = await lisa.get(
        `/api/v1/users/me/children/${samiraId}/notifications`,
      );
      const beforeKeys = (before.body.data as Array<{ itemKey: string }>).map(
        (d) => d.itemKey,
      );
      expect(beforeKeys).toContain(itemKey);

      // Remove takes the article down (sets hiddenAt) and stamps the
      // parent as the user who hid it.
      const remove = await lisa
        .post(`/api/v1/users/me/children/${samiraId}/notifications/decision`)
        .send({ itemKey, decision: "removed" });
      expect(remove.status).toBe(200);
      const [hidden] = await db
        .select()
        .from(articles)
        .where(eq(articles.id, article.id));
      expect(hidden?.hiddenAt).toBeTruthy();
      expect(hidden?.hiddenByUserId).toBe(lisaId);

      // Live stream no longer surfaces the now-hidden article.
      const afterRemove = await lisa.get(
        `/api/v1/users/me/children/${samiraId}/notifications`,
      );
      const afterRemoveKeys = (
        afterRemove.body.data as Array<{ itemKey: string }>
      ).map((d) => d.itemKey);
      expect(afterRemoveKeys).not.toContain(itemKey);

      // Undo clears the hide so the article is visible on the child's
      // page again, and the parent's decision row is removed.
      const undo = await lisa
        .post(
          `/api/v1/users/me/children/${samiraId}/notifications/unset-decision`,
        )
        .send({ itemKey });
      expect(undo.status).toBe(200);
      const [restored] = await db
        .select()
        .from(articles)
        .where(eq(articles.id, article.id));
      expect(restored?.hiddenAt).toBeNull();
      expect(restored?.hiddenByUserId).toBeNull();
      const reads = await db
        .select()
        .from(parentChildNotificationReads)
        .where(
          and(
            eq(parentChildNotificationReads.parentId, lisaId),
            eq(parentChildNotificationReads.childId, samiraId),
            eq(parentChildNotificationReads.itemKey, itemKey),
          ),
        );
      expect(reads.length).toBe(0);
    });

    it("Remove on an authoredHighlight hides the clip and an Undo restores it", async () => {
      const samiraId = await findUserId("samira@kinectem.demo");
      const lisaId = await findUserId("lisa@kinectem.demo");
      const teamId = await getAnyTeamId();
      const [highlight] = await db
        .insert(highlights)
        .values({
          teamId,
          uploaderId: samiraId,
          title: "Samira's own clip",
          videoUrl: "https://example.com/samira.mp4",
        })
        .returning();
      const itemKey = `authoredHighlight:${highlight.id}`;
      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );

      const before = await lisa.get(
        `/api/v1/users/me/children/${samiraId}/notifications`,
      );
      const beforeKeys = (before.body.data as Array<{ itemKey: string }>).map(
        (d) => d.itemKey,
      );
      expect(beforeKeys).toContain(itemKey);

      const remove = await lisa
        .post(`/api/v1/users/me/children/${samiraId}/notifications/decision`)
        .send({ itemKey, decision: "removed" });
      expect(remove.status).toBe(200);
      const [hidden] = await db
        .select()
        .from(highlights)
        .where(eq(highlights.id, highlight.id));
      expect(hidden?.hiddenAt).toBeTruthy();
      expect(hidden?.hiddenByUserId).toBe(lisaId);

      const undo = await lisa
        .post(
          `/api/v1/users/me/children/${samiraId}/notifications/unset-decision`,
        )
        .send({ itemKey });
      expect(undo.status).toBe(200);
      const [restored] = await db
        .select()
        .from(highlights)
        .where(eq(highlights.id, highlight.id));
      expect(restored?.hiddenAt).toBeNull();
      expect(restored?.hiddenByUserId).toBeNull();
    });

    it("a parent cannot Remove an authoredArticle that isn't authored by their child (404)", async () => {
      // Article authored by the coach, NOT by Samira — itemKey must not
      // be honoured even though the kind prefix is well-formed. The
      // membership check should reject it as "not in the live stream
      // and no prior decision row" with a 404.
      const samiraId = await findUserId("samira@kinectem.demo");
      const coachId = await findUserId("coach@kinectem.demo");
      const teamId = await getAnyTeamId();
      const [foreign] = await db
        .insert(articles)
        .values({
          teamId,
          authorId: coachId,
          title: "Not Samira's article",
          body: "x",
          status: "published",
        })
        .returning();
      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const res = await lisa
        .post(`/api/v1/users/me/children/${samiraId}/notifications/decision`)
        .send({
          itemKey: `authoredArticle:${foreign.id}`,
          decision: "removed",
        });
      expect(res.status).toBe(404);
      // And critically: the foreign article must NOT have been hidden.
      const [stillVisible] = await db
        .select()
        .from(articles)
        .where(eq(articles.id, foreign.id));
      expect(stillVisible?.hiddenAt).toBeNull();
    });

    it("Undo on a Removed highlight tag that was approved restores it to approved (priorStatus)", async () => {
      // A child with `requireTagConsent = false` would have an
      // already-`approved` highlight tag surface in the parent inbox.
      // If the parent Removes it and then Undoes, the tag must come
      // back as `approved` — not silently demoted to `pending` — so
      // the child doesn't have to re-approve their own consent.
      const samiraId = await findUserId("samira@kinectem.demo");
      const coachId = await findUserId("coach@kinectem.demo");
      const lisaId = await findUserId("lisa@kinectem.demo");
      const teamId = await getAnyTeamId();
      const [highlight] = await db
        .insert(highlights)
        .values({
          teamId,
          uploaderId: coachId,
          title: "Auto-approved highlight",
          videoUrl: "https://example.com/auto.mp4",
        })
        .returning();
      const [tag] = await db
        .insert(highlightTags)
        .values({
          highlightId: highlight.id,
          userId: samiraId,
          taggerUserId: coachId,
          status: "approved",
        })
        .returning();
      const itemKey = `tag:${tag.id}`;
      // Plant a prior decision row so the membership check passes — the
      // loader skips non-pending tags, so without this the decision
      // endpoint would return 404 on the Remove.
      await db.insert(parentChildNotificationReads).values({
        parentId: lisaId,
        childId: samiraId,
        itemKey,
        decision: "approved",
        decidedAt: new Date(),
      });
      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );

      // Flip from approve → remove. The decision endpoint should
      // capture the current (`approved`) status before declining.
      const remove = await lisa
        .post(`/api/v1/users/me/children/${samiraId}/notifications/decision`)
        .send({ itemKey, decision: "removed" });
      expect(remove.status).toBe(200);
      const [declined] = await db
        .select()
        .from(highlightTags)
        .where(eq(highlightTags.id, tag.id));
      expect(declined?.status).toBe("declined");
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
      expect(readRow?.priorStatus).toBe("approved");


      // Undo must restore to `approved`, NOT `pending`.
      const undo = await lisa
        .post(
          `/api/v1/users/me/children/${samiraId}/notifications/unset-decision`,
        )
        .send({ itemKey });
      expect(undo.status).toBe(200);
      const [restored] = await db
        .select()
        .from(highlightTags)
        .where(eq(highlightTags.id, tag.id));
      expect(restored?.status).toBe("approved");
    });

    it("after Remove the child's authored article + highlight disappear from non-admin profile feeds but stay visible to admins", async () => {
      const samiraId = await findUserId("samira@kinectem.demo");
      const teamId = await getAnyTeamId();
      const [article] = await db
        .insert(articles)
        .values({
          teamId,
          authorId: samiraId,
          title: "Samira visibility article",
          body: "child-written body",
          status: "published",
        })
        .returning();
      const [highlight] = await db
        .insert(highlights)
        .values({
          teamId,
          uploaderId: samiraId,
          title: "Samira visibility clip",
          videoUrl: "https://example.com/samira-vis.mp4",
        })
        .returning();
      const articleKey = `authoredArticle:${article.id}`;
      const highlightKey = `authoredHighlight:${highlight.id}`;
      // The /users/:id/posts response wraps raw row IDs, so compare on
      // the wrapped form.
      const articlePostId = `article-${article.id}`;
      const highlightPostId = `highlight-${highlight.id}`;

      // A non-admin viewer (coach) can see both posts before the parent
      // takedown — guarantees the test is exercising the right path.
      const { agent: coach } = await loginAs(
        (u) => u.email === "coach@kinectem.demo",
      );
      const coachBefore = await coach.get(`/api/v1/users/${samiraId}/posts`);
      expect(coachBefore.status).toBe(200);
      const coachBeforeIds = (
        coachBefore.body.data as Array<{ id: string }>
      ).map((p) => p.id);
      expect(coachBeforeIds).toContain(articlePostId);
      expect(coachBeforeIds).toContain(highlightPostId);

      // Parent removes both authored posts.
      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      for (const itemKey of [articleKey, highlightKey]) {
        const r = await lisa
          .post(`/api/v1/users/me/children/${samiraId}/notifications/decision`)
          .send({ itemKey, decision: "removed" });
        expect(r.status).toBe(200);
      }

      // Non-admin viewer no longer sees either post on the child's
      // profile feed (which feeds both the profile page and team-page
      // post lists, both of which gate on `hiddenAt`).
      const coachAfter = await coach.get(`/api/v1/users/${samiraId}/posts`);
      expect(coachAfter.status).toBe(200);
      const coachAfterIds = (
        coachAfter.body.data as Array<{ id: string }>
      ).map((p) => p.id);
      expect(coachAfterIds).not.toContain(articlePostId);
      expect(coachAfterIds).not.toContain(highlightPostId);

      // A real admin still sees both rows on the child's profile feed
      // so moderation review remains possible. The DB rows themselves
      // carry `hiddenAt` + `hiddenByUserId`, which we assert directly.
      const { agent: admin } = await loginAs((u) => u.role === "admin");
      const adminAfter = await admin.get(`/api/v1/users/${samiraId}/posts`);
      expect(adminAfter.status).toBe(200);
      const adminAfterIds = (
        adminAfter.body.data as Array<{ id: string }>
      ).map((p) => p.id);
      expect(adminAfterIds).toContain(articlePostId);
      expect(adminAfterIds).toContain(highlightPostId);
      const [hiddenArticle] = await db
        .select()
        .from(articles)
        .where(eq(articles.id, article.id));
      const [hiddenHighlight] = await db
        .select()
        .from(highlights)
        .where(eq(highlights.id, highlight.id));
      expect(hiddenArticle?.hiddenAt).toBeTruthy();
      expect(hiddenHighlight?.hiddenAt).toBeTruthy();
    });
  });

  describe("Remove on a 'tagged in' notification (post_tag) declines the tag for the child", () => {
    it("article post_tag notification: Remove flips the child's article tag to declined, drops the article off the child's profile, and leaves the tagger's profile alone", async () => {
      // Mirrors the auto-approved tag case (the common one for a child
      // whose linked guardian has set requireTagConsent=false). The
      // tag loader filters to status=pending only, so the tag itself
      // doesn't surface as its own row — the parent only sees the
      // `kind=notification` row whose underlying notifications.kind is
      // `post_tag`. Remove on that row must decline the tag.
      const samiraId = await findUserId("samira@kinectem.demo");
      const coachId = await findUserId("coach@kinectem.demo");
      const teamId = await getAnyTeamId();
      const [article] = await db
        .insert(articles)
        .values({
          teamId,
          authorId: coachId,
          title: "Auto-approved tag article",
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
      const [notif] = await db
        .insert(notifications)
        .values({
          userId: samiraId,
          actorUserId: coachId,
          kind: "post_tag",
          message: 'Coach tagged you in "Auto-approved tag article"',
          link: `/posts/article-${article.id}`,
        })
        .returning();
      const itemKey = `notification:${notif.id}`;

      // Sanity: the article shows on the child's profile feed before
      // the parent declines it. Use the coach as a non-admin viewer.
      const { agent: coach } = await loginAs(
        (u) => u.email === "coach@kinectem.demo",
      );
      const childBefore = await coach.get(`/api/v1/users/${samiraId}/posts`);
      const childBeforeIds = (
        childBefore.body.data as Array<{ id: string }>
      ).map((p) => p.id);
      expect(childBeforeIds).toContain(`article-${article.id}`);

      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const remove = await lisa
        .post(`/api/v1/users/me/children/${samiraId}/notifications/decision`)
        .send({ itemKey, decision: "removed" });
      expect(remove.status).toBe(200);

      const [tagAfter] = await db
        .select()
        .from(articleTags)
        .where(eq(articleTags.id, tag.id));
      expect(tagAfter?.status).toBe("declined");

      // The article disappears from the child's profile (because the
      // tag is now declined and the child wasn't the author)…
      const childAfter = await coach.get(`/api/v1/users/${samiraId}/posts`);
      const childAfterIds = (
        childAfter.body.data as Array<{ id: string }>
      ).map((p) => p.id);
      expect(childAfterIds).not.toContain(`article-${article.id}`);

      // …but stays on the tagger's profile (the original author owns
      // the post — un-tagging Jake doesn't take down someone else's
      // article).
      const taggerAfter = await coach.get(`/api/v1/users/${coachId}/posts`);
      const taggerAfterIds = (
        taggerAfter.body.data as Array<{ id: string }>
      ).map((p) => p.id);
      expect(taggerAfterIds).toContain(`article-${article.id}`);

      await db.delete(notifications).where(eq(notifications.id, notif.id));
    });

    it("highlight post_tag notification: Remove flips the child's highlight tag to declined and drops the clip off the child's profile", async () => {
      const samiraId = await findUserId("samira@kinectem.demo");
      const coachId = await findUserId("coach@kinectem.demo");
      const teamId = await getAnyTeamId();
      const [highlight] = await db
        .insert(highlights)
        .values({
          teamId,
          uploaderId: coachId,
          title: "Auto-approved highlight clip",
          videoUrl: "https://example.com/auto-clip.mp4",
        })
        .returning();
      const [tag] = await db
        .insert(highlightTags)
        .values({
          highlightId: highlight.id,
          userId: samiraId,
          taggerUserId: coachId,
          status: "approved",
        })
        .returning();
      const [notif] = await db
        .insert(notifications)
        .values({
          userId: samiraId,
          actorUserId: coachId,
          kind: "post_tag",
          message: 'Coach tagged you in "Auto-approved highlight clip"',
          link: `/posts/highlight-${highlight.id}`,
        })
        .returning();
      const itemKey = `notification:${notif.id}`;

      const { agent: coach } = await loginAs(
        (u) => u.email === "coach@kinectem.demo",
      );
      const childBefore = await coach.get(`/api/v1/users/${samiraId}/posts`);
      const childBeforeIds = (
        childBefore.body.data as Array<{ id: string }>
      ).map((p) => p.id);
      expect(childBeforeIds).toContain(`highlight-${highlight.id}`);

      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const remove = await lisa
        .post(`/api/v1/users/me/children/${samiraId}/notifications/decision`)
        .send({ itemKey, decision: "removed" });
      expect(remove.status).toBe(200);

      const [tagAfter] = await db
        .select()
        .from(highlightTags)
        .where(eq(highlightTags.id, tag.id));
      expect(tagAfter?.status).toBe("declined");

      const childAfter = await coach.get(`/api/v1/users/${samiraId}/posts`);
      const childAfterIds = (
        childAfter.body.data as Array<{ id: string }>
      ).map((p) => p.id);
      expect(childAfterIds).not.toContain(`highlight-${highlight.id}`);

      // Uploader's profile still shows the clip — the post itself is
      // untouched.
      const uploaderAfter = await coach.get(`/api/v1/users/${coachId}/posts`);
      const uploaderAfterIds = (
        uploaderAfter.body.data as Array<{ id: string }>
      ).map((p) => p.id);
      expect(uploaderAfterIds).toContain(`highlight-${highlight.id}`);

      await db.delete(notifications).where(eq(notifications.id, notif.id));
    });

    it("Undo on a Removed article post_tag notification restores the tag to its priorStatus (auto-approved → approved)", async () => {
      const samiraId = await findUserId("samira@kinectem.demo");
      const coachId = await findUserId("coach@kinectem.demo");
      const lisaId = await findUserId("lisa@kinectem.demo");
      const teamId = await getAnyTeamId();
      const [article] = await db
        .insert(articles)
        .values({
          teamId,
          authorId: coachId,
          title: "Undo post_tag notif",
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
      const [notif] = await db
        .insert(notifications)
        .values({
          userId: samiraId,
          actorUserId: coachId,
          kind: "post_tag",
          message: 'Coach tagged you in "Undo post_tag notif"',
          link: `/posts/article-${article.id}`,
        })
        .returning();
      const itemKey = `notification:${notif.id}`;
      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );

      const remove = await lisa
        .post(`/api/v1/users/me/children/${samiraId}/notifications/decision`)
        .send({ itemKey, decision: "removed" });
      expect(remove.status).toBe(200);
      const [declined] = await db
        .select()
        .from(articleTags)
        .where(eq(articleTags.id, tag.id));
      expect(declined?.status).toBe("declined");

      // priorStatus snapshot was captured on the parent's read row.
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
      expect(readRow?.priorStatus).toBe("approved");

      const undo = await lisa
        .post(
          `/api/v1/users/me/children/${samiraId}/notifications/unset-decision`,
        )
        .send({ itemKey });
      expect(undo.status).toBe(200);

      const [restored] = await db
        .select()
        .from(articleTags)
        .where(eq(articleTags.id, tag.id));
      // Restores to `approved` (not `pending`) because the snapshot
      // captured the auto-approved state at decision time.
      expect(restored?.status).toBe("approved");

      await db.delete(notifications).where(eq(notifications.id, notif.id));
    });

    it("Undo on a Removed highlight post_tag notification restores the tag to pending when the prior status was pending", async () => {
      const samiraId = await findUserId("samira@kinectem.demo");
      const coachId = await findUserId("coach@kinectem.demo");
      const teamId = await getAnyTeamId();
      const [highlight] = await db
        .insert(highlights)
        .values({
          teamId,
          uploaderId: coachId,
          title: "Pending highlight post_tag undo",
          videoUrl: "https://example.com/pending.mp4",
        })
        .returning();
      const [tag] = await db
        .insert(highlightTags)
        .values({
          highlightId: highlight.id,
          userId: samiraId,
          taggerUserId: coachId,
          status: "pending",
        })
        .returning();
      // Pending highlight tags ALSO surface as their own `tag:` row,
      // so when we remove via the `notification:` key the membership
      // check needs the post_tag notification to exist; we simulate
      // the "auto-approved" path being missing by addressing the
      // notification:<id> key directly. The tag is the same row.
      const [notif] = await db
        .insert(notifications)
        .values({
          userId: samiraId,
          actorUserId: coachId,
          kind: "post_tag",
          message: 'Coach tagged you in "Pending highlight post_tag undo"',
          link: `/posts/highlight-${highlight.id}`,
        })
        .returning();
      const itemKey = `notification:${notif.id}`;

      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const remove = await lisa
        .post(`/api/v1/users/me/children/${samiraId}/notifications/decision`)
        .send({ itemKey, decision: "removed" });
      expect(remove.status).toBe(200);

      const undo = await lisa
        .post(
          `/api/v1/users/me/children/${samiraId}/notifications/unset-decision`,
        )
        .send({ itemKey });
      expect(undo.status).toBe(200);

      const [restored] = await db
        .select()
        .from(highlightTags)
        .where(eq(highlightTags.id, tag.id));
      expect(restored?.status).toBe("pending");

      await db.delete(notifications).where(eq(notifications.id, notif.id));
    });

    it("non-guardian users still get 403 on the decision endpoint for a post_tag notification", async () => {
      const samiraId = await findUserId("samira@kinectem.demo");
      const coachId = await findUserId("coach@kinectem.demo");
      const teamId = await getAnyTeamId();
      const [article] = await db
        .insert(articles)
        .values({
          teamId,
          authorId: coachId,
          title: "403 post_tag",
          body: "x",
          status: "published",
        })
        .returning();
      await db.insert(articleTags).values({
        articleId: article.id,
        userId: samiraId,
        taggerUserId: coachId,
        status: "approved",
      });
      const [notif] = await db
        .insert(notifications)
        .values({
          userId: samiraId,
          actorUserId: coachId,
          kind: "post_tag",
          message: 'Coach tagged you in "403 post_tag"',
          link: `/posts/article-${article.id}`,
        })
        .returning();
      // The coach is NOT Samira's guardian, so authorizeChildAccess
      // must reject the decision endpoint with 403 — the new post_tag
      // dispatch arm doesn't loosen that guard.
      const { agent: coach } = await loginAs(
        (u) => u.email === "coach@kinectem.demo",
      );
      const res = await coach
        .post(`/api/v1/users/me/children/${samiraId}/notifications/decision`)
        .send({
          itemKey: `notification:${notif.id}`,
          decision: "removed",
        });
      expect(res.status).toBe(403);

      // And the underlying tag must remain approved — the rejected
      // call must NOT have flipped it.
      const [tagAfter] = await db
        .select()
        .from(articleTags)
        .where(
          and(
            eq(articleTags.userId, samiraId),
            eq(articleTags.articleId, article.id),
          ),
        );
      expect(tagAfter?.status).toBe("approved");

      await db.delete(notifications).where(eq(notifications.id, notif.id));
    });

    it("Approve on an article post_tag notification flips the underlying pending tag to approved so the duplicate `tag:` row stops re-surfacing (regression: child-tag double-approve bug)", async () => {
      // The family inbox surfaces the same "X tagged your child in Y"
      // event twice when the underlying tag is still pending — once as
      // the generic `notification:<id>` row (kind `post_tag`) and once
      // as the `tag:<tagId>` row sourced from `articleTags` filtered
      // to status='pending'. Approving the notification row used to
      // record the parent's verdict but leave the tag pending, so the
      // duplicate `tag:` row would re-appear and the parent had to
      // approve a second time. The fix mirrors the Remove path: when
      // the approved item is `kind=notification` whose underlying
      // notifications.kind is `post_tag`, also flip the matching
      // (child, post) tag row from pending → approved.
      const samiraId = await findUserId("samira@kinectem.demo");
      const coachId = await findUserId("coach@kinectem.demo");
      const teamId = await getAnyTeamId();
      const [article] = await db
        .insert(articles)
        .values({
          teamId,
          authorId: coachId,
          title: "Pending tag double-approve",
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
          status: "pending",
        })
        .returning();
      const [notif] = await db
        .insert(notifications)
        .values({
          userId: samiraId,
          actorUserId: coachId,
          kind: "post_tag",
          message: 'Coach tagged you in "Pending tag double-approve"',
          link: `/posts/article-${article.id}`,
        })
        .returning();

      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );

      // Sanity: before any decision, the inbox returns BOTH the
      // notification row AND the duplicate tag row.
      const before = await lisa.get(
        `/api/v1/users/me/children/${samiraId}/notifications`,
      );
      const beforeKeys = (
        before.body.data as Array<{ itemKey: string }>
      ).map((i) => i.itemKey);
      expect(beforeKeys).toContain(`notification:${notif.id}`);
      expect(beforeKeys).toContain(`tag:${tag.id}`);

      // Approve via the notification row (the bug path).
      const approve = await lisa
        .post(`/api/v1/users/me/children/${samiraId}/notifications/decision`)
        .send({
          itemKey: `notification:${notif.id}`,
          decision: "approved",
        });
      expect(approve.status).toBe(200);

      // The underlying tag row must have flipped to approved — that
      // is the fix.
      const [tagAfter] = await db
        .select()
        .from(articleTags)
        .where(eq(articleTags.id, tag.id));
      expect(tagAfter?.status).toBe("approved");

      // And the inbox must no longer surface the duplicate `tag:` row.
      // The notification row itself is still in the response (with a
      // decision badge) until the section refreshes; we only assert
      // the duplicate is gone.
      const after = await lisa.get(
        `/api/v1/users/me/children/${samiraId}/notifications`,
      );
      const afterKeys = (
        after.body.data as Array<{ itemKey: string }>
      ).map((i) => i.itemKey);
      expect(afterKeys).not.toContain(`tag:${tag.id}`);

      await db.delete(notifications).where(eq(notifications.id, notif.id));
    });

    it("Approve on a highlight post_tag notification flips the underlying pending highlight tag to approved (regression: child-tag double-approve bug, highlight variant)", async () => {
      const samiraId = await findUserId("samira@kinectem.demo");
      const coachId = await findUserId("coach@kinectem.demo");
      const teamId = await getAnyTeamId();
      const [highlight] = await db
        .insert(highlights)
        .values({
          teamId,
          uploaderId: coachId,
          title: "Pending highlight tag double-approve",
          videoUrl: "https://example.com/clip.mp4",
        })
        .returning();
      const [tag] = await db
        .insert(highlightTags)
        .values({
          highlightId: highlight.id,
          userId: samiraId,
          taggerUserId: coachId,
          status: "pending",
        })
        .returning();
      const [notif] = await db
        .insert(notifications)
        .values({
          userId: samiraId,
          actorUserId: coachId,
          kind: "post_tag",
          message: 'Coach tagged you in "Pending highlight tag double-approve"',
          link: `/posts/highlight-${highlight.id}`,
        })
        .returning();

      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const approve = await lisa
        .post(`/api/v1/users/me/children/${samiraId}/notifications/decision`)
        .send({
          itemKey: `notification:${notif.id}`,
          decision: "approved",
        });
      expect(approve.status).toBe(200);

      const [tagAfter] = await db
        .select()
        .from(highlightTags)
        .where(eq(highlightTags.id, tag.id));
      expect(tagAfter?.status).toBe("approved");

      await db.delete(notifications).where(eq(notifications.id, notif.id));
    });

    it("Approve on an article post_tag notification leaves a previously-declined tag declined (does not silently revive parent-declined or child-declined tags)", async () => {
      // Conservative idempotency check: the approve flip is gated to
      // pending → approved. A tag that the child or another parent
      // has already declined must NOT be silently revived just
      // because the notification row is approved later.
      const samiraId = await findUserId("samira@kinectem.demo");
      const coachId = await findUserId("coach@kinectem.demo");
      const teamId = await getAnyTeamId();
      const [article] = await db
        .insert(articles)
        .values({
          teamId,
          authorId: coachId,
          title: "Already-declined tag",
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
          status: "declined",
        })
        .returning();
      const [notif] = await db
        .insert(notifications)
        .values({
          userId: samiraId,
          actorUserId: coachId,
          kind: "post_tag",
          message: 'Coach tagged you in "Already-declined tag"',
          link: `/posts/article-${article.id}`,
        })
        .returning();

      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const approve = await lisa
        .post(`/api/v1/users/me/children/${samiraId}/notifications/decision`)
        .send({
          itemKey: `notification:${notif.id}`,
          decision: "approved",
        });
      expect(approve.status).toBe(200);

      const [tagAfter] = await db
        .select()
        .from(articleTags)
        .where(eq(articleTags.id, tag.id));
      expect(tagAfter?.status).toBe("declined");

      await db.delete(notifications).where(eq(notifications.id, notif.id));
    });

    it("Remove on a comment notification does not take down the underlying post (regression: per-notification fidelity, no escalation)", async () => {
      // Comment items surface as `kind=comment`, NOT `kind=notification`.
      // Removing one must hide ONLY the comment, leaving the post the
      // child authored visible on their profile feed. This guards
      // against a regression where the new post_tag handler might
      // be over-applied to other notification kinds.
      const samiraId = await findUserId("samira@kinectem.demo");
      const coachId = await findUserId("coach@kinectem.demo");
      const teamId = await getAnyTeamId();
      const [article] = await db
        .insert(articles)
        .values({
          teamId,
          authorId: samiraId,
          title: "Child-authored, comment removed",
          body: "child body",
          status: "published",
        })
        .returning();
      const [comment] = await db
        .insert(postComments)
        .values({
          postKind: "article",
          postRefId: article.id,
          authorId: coachId,
          body: "Nice job!",
        })
        .returning();
      const itemKey = `comment:${comment.id}`;

      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const remove = await lisa
        .post(`/api/v1/users/me/children/${samiraId}/notifications/decision`)
        .send({ itemKey, decision: "removed" });
      expect(remove.status).toBe(200);

      const [hiddenComment] = await db
        .select()
        .from(postComments)
        .where(eq(postComments.id, comment.id));
      expect(hiddenComment?.hiddenAt).toBeTruthy();

      // The child's authored article must still be visible.
      const [stillVisible] = await db
        .select()
        .from(articles)
        .where(eq(articles.id, article.id));
      expect(stillVisible?.hiddenAt).toBeNull();

      // And it still shows up on the child's profile feed for a
      // non-admin viewer.
      const { agent: coach } = await loginAs(
        (u) => u.email === "coach@kinectem.demo",
      );
      const profile = await coach.get(`/api/v1/users/${samiraId}/posts`);
      const ids = (profile.body.data as Array<{ id: string }>).map(
        (p) => p.id,
      );
      expect(ids).toContain(`article-${article.id}`);
    });
  });
});
