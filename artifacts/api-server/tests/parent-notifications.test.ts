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
  conversations,
  conversationParticipants,
  messages,
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
