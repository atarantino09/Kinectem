import { describe, expect, it } from "vitest";
import {
  db,
  articles,
  notifications,
  scheduleEvents,
  users,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { app, loginAs, request } from "./helpers";

async function getOrgAndTeam(name = "Varsity Football") {
  const orgs = await request(app).get("/api/v1/organizations");
  const org = orgs.body.data[0];
  const teamsRes = await request(app).get(
    `/api/v1/organizations/${org.id}/teams`,
  );
  const team = teamsRes.body.data.find(
    (t: { name: string }) => t.name === name,
  );
  if (!team) throw new Error(`team ${name} not in seed`);
  return { org, team };
}

async function createRecap(
  agent: ReturnType<typeof request.agent>,
  orgId: string,
  title: string,
): Promise<string> {
  const res = await agent.post("/api/v1/posts").send({
    postType: "long",
    organizationId: orgId,
    title,
    description: "cleanup test",
    body: "Body",
  });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

describe("deleted recap cleanup (task 761)", () => {
  it("clears schedule game_recap_id and stamps the reminder when a recap is deleted", async () => {
    const { agent } = await loginAs((u) => u.email === "coach@kinectem.demo");
    const { org, team } = await getOrgAndTeam();
    const postId = await createRecap(agent, org.id, "Recap to delete");
    const articleId = postId.replace(/^article-/, "");

    const [event] = await db
      .insert(scheduleEvents)
      .values({
        teamId: team.id,
        organizationId: org.id,
        eventType: "game",
        opponent: "Cleanup Test FC",
        startAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
        status: "completed",
        gameRecapId: articleId,
      })
      .returning({ id: scheduleEvents.id });

    const del = await agent.delete(`/api/v1/posts/${postId}`);
    expect(del.status).toBe(204);

    const [after] = await db
      .select({
        gameRecapId: scheduleEvents.gameRecapId,
        recapReminderSentAt: scheduleEvents.recapReminderSentAt,
      })
      .from(scheduleEvents)
      .where(eq(scheduleEvents.id, event.id));
    expect(after.gameRecapId).toBeNull();
    expect(after.recapReminderSentAt).not.toBeNull();

    await db.delete(scheduleEvents).where(eq(scheduleEvents.id, event.id));
  });

  it("annotates hidden posts with hidden:true on the profile feed for platform admins only", async () => {
    const coach = await loginAs((u) => u.email === "coach@kinectem.demo");
    const { org } = await getOrgAndTeam();
    const postId = await createRecap(
      coach.agent,
      org.id,
      "Recap hidden badge test",
    );

    const del = await coach.agent.delete(`/api/v1/posts/${postId}`);
    expect(del.status).toBe(204);

    // Author (non-admin) no longer sees the post at all.
    const own = await coach.agent.get(
      `/api/v1/users/${coach.user.id}/posts`,
    );
    expect(own.status).toBe(200);
    expect(
      own.body.data.find((p: { id: string }) => p.id === postId),
    ).toBeUndefined();

    // Platform admin sees it, flagged hidden.
    const [adminRow] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.role, "admin"))
      .limit(1);
    const admin = await loginAs((u) => u.email === adminRow.email);
    const adminView = await admin.agent.get(
      `/api/v1/users/${coach.user.id}/posts`,
    );
    expect(adminView.status).toBe(200);
    const found = adminView.body.data.find(
      (p: { id: string }) => p.id === postId,
    );
    expect(found).toBeDefined();
    expect(found.hidden).toBe(true);
  });

  it("filters notifications pointing at deleted posts from the list and unread count", async () => {
    const coach = await loginAs((u) => u.email === "coach@kinectem.demo");
    const { org } = await getOrgAndTeam();
    const postId = await createRecap(
      coach.agent,
      org.id,
      "Recap notification cleanup",
    );
    const articleId = postId.replace(/^article-/, "");

    // Manually insert a notification pointing at the post for the coach.
    const [notif] = await db
      .insert(notifications)
      .values({
        userId: coach.user.id,
        kind: "post",
        message: "cleanup test notification",
        link: `/posts/${postId}`,
        read: false,
      })
      .returning({ id: notifications.id });

    const before = await coach.agent.get("/api/v1/notifications");
    expect(before.status).toBe(200);
    expect(
      before.body.data.find((n: { id: string }) => n.id === notif.id),
    ).toBeDefined();
    const beforeCount = await coach.agent.get(
      "/api/v1/notifications/unread-count",
    );
    expect(beforeCount.body.unreadCount).toBeGreaterThan(0);

    const del = await coach.agent.delete(`/api/v1/posts/${postId}`);
    expect(del.status).toBe(204);
    const [row] = await db
      .select({ hiddenAt: articles.hiddenAt })
      .from(articles)
      .where(eq(articles.id, articleId));
    expect(row.hiddenAt).not.toBeNull();

    const after = await coach.agent.get("/api/v1/notifications");
    expect(after.status).toBe(200);
    expect(
      after.body.data.find((n: { id: string }) => n.id === notif.id),
    ).toBeUndefined();

    const afterCount = await coach.agent.get(
      "/api/v1/notifications/unread-count",
    );
    expect(afterCount.status).toBe(200);
    expect(afterCount.body.unreadCount).toBe(
      beforeCount.body.unreadCount - 1,
    );

    await db.delete(notifications).where(eq(notifications.id, notif.id));
  });
});
