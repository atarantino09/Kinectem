import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, articles, teams, organizations, organizationAdmins, rosterEntries, notifications } from "@workspace/db";
import * as tagging from "../src/lib/article-tagging";
import { loginAs } from "./helpers";

afterEach(() => vi.restoreAllMocks());

async function fixture() {
  const { agent, user } = await loginAs("coach@kinectem.demo");
  const [org] = await db.insert(organizations).values({ name: `Recap retry club ${randomUUID()}` }).returning();
  await db.insert(organizationAdmins).values({ organizationId: org.id, userId: user.id, role: "owner" });
  const [team] = await db.insert(teams).values({ name: "Retry test team", organizationId: org.id }).returning();
  await db.insert(rosterEntries).values({ teamId: team.id, userId: user.id, role: "coach", status: "accepted" });
  const body = { postType: "long", context: { type: "team", id: team.id },
    title: `Retry recap ${randomUUID()}`, body: "Tournament review." };
  return { agent, user, team, body };
}

describe("recap request idempotency", () => {
  it.each([undefined, "combined"])("persists one article and team/feed item for concurrent requests and lost-response retries (%s)", async (recapKind) => {
    const { agent, body, team } = await fixture();
    const key = randomUUID();
    const payload = { ...body, ...(recapKind ? { recapKind } : {}) };
    const send = () => agent.post("/api/v1/posts").set("Idempotency-Key", key).send(payload);
    const replies = await Promise.all([send(), send(), send()]);
    expect(replies.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(new Set(replies.map((r) => r.body.id)).size).toBe(1);
    // Simulate losing the first successful response by ignoring it and retrying.
    const retry = await send();
    expect(retry.body.id).toBe(replies[0].body.id);
    const persisted = await db.select().from(articles).where(eq(articles.title, body.title));
    expect(persisted).toHaveLength(1);
    const listing = await agent.get(`/api/v1/teams/${team.id}/posts`);
    expect(listing.status).toBe(200);
    expect(listing.body.data.filter((p: { id: string }) => p.id === retry.body.id)).toHaveLength(1);
    await agent.post(`/api/v1/teams/${team.id}/follow`).send();
    const feed = await agent.get("/api/v1/feed");
    expect(feed.status).toBe(200);
    expect(feed.body.data.filter((p: { id: string }) => p.id === retry.body.id)).toHaveLength(1);
  });

  it("allows distinct keys with identical content and isolates keys by actor", async () => {
    const { agent, body } = await fixture();
    const key = randomUUID();
    const first = await agent.post("/api/v1/posts").set("Idempotency-Key", key).send(body);
    const second = await agent.post("/api/v1/posts").set("Idempotency-Key", randomUUID()).send(body);
    const { agent: other } = await loginAs("sam@kinectem.demo");
    const third = await other.post("/api/v1/posts").set("Idempotency-Key", key).send(body);
    expect([first.status, second.status, third.status]).toEqual([201, 201, 201]);
    expect(new Set([first.body.id, second.body.id, third.body.id]).size).toBe(3);
    const conflict = await agent.post("/api/v1/posts").set("Idempotency-Key", key)
      .send({ ...body, title: "Another operation" });
    expect(conflict.status).toBe(409);
    expect(conflict.body.id).toBeUndefined();
    expect(await db.select().from(articles).where(eq(articles.title, body.title))).toHaveLength(3);
  });

  it("returns committed success when post-insert tagging fails and retries do not insert again", async () => {
    const { agent, body } = await fixture();
    const fanout = vi.spyOn(tagging, "applyArticleTagFanout").mockRejectedValueOnce(new Error("injected post-insert failure"));
    const key = randomUUID();
    const first = await agent.post("/api/v1/posts").set("Idempotency-Key", key).send(body);
    expect(first.status).toBe(201);
    expect(first.body.warnings).toHaveLength(1);
    const retry = await agent.post("/api/v1/posts").set("Idempotency-Key", key).send(body);
    expect(retry.status).toBe(201);
    expect(retry.body.id).toBe(first.body.id);
    expect(fanout).toHaveBeenCalledTimes(1);
    expect(await db.select().from(articles).where(eq(articles.title, body.title))).toHaveLength(1);
  });

  it("claims publication once, preserving timestamps and transition side effects on repeats", async () => {
    const { agent, body } = await fixture();
    const draft = await agent.post("/api/v1/posts").set("Idempotency-Key", randomUUID())
      .send({ ...body, status: "draft", gameDate: "2026-10-10T12:00:00.000Z" });
    expect(draft.status).toBe(201);
    const fanout = vi.spyOn(tagging, "applyArticleTagFanout");
    const publish = () => agent.post(`/api/v1/posts/${draft.body.id}/publish`).send();
    const replies = await Promise.all([publish(), publish(), publish()]);
    expect(replies.map((r) => r.status)).toEqual([200, 200, 200]);
    const id = draft.body.id.replace("article-", "");
    const [first] = await db.select().from(articles).where(eq(articles.id, id));
    const bells = await db.select().from(notifications).where(eq(notifications.link, `/posts/${draft.body.id}`));
    await publish();
    const [after] = await db.select().from(articles).where(eq(articles.id, id));
    expect(after.publishedAt).toEqual(first.publishedAt);
    expect(after.publishedById).toBe(first.publishedById);
    expect(fanout).toHaveBeenCalledTimes(1);
    expect(await db.select().from(notifications).where(eq(notifications.link, `/posts/${draft.body.id}`))).toHaveLength(bells.length);
  });

  it("returns canonical publication after a committed follow-up failure", async () => {
    const { agent, body } = await fixture();
    const draft = await agent.post("/api/v1/posts").send({ ...body, status: "draft" });
    vi.spyOn(tagging, "applyMentionTags").mockRejectedValueOnce(new Error("publish follow-up unavailable"));
    const first = await agent.post(`/api/v1/posts/${draft.body.id}/publish`).send();
    expect(first.status).toBe(200);
    expect(first.body.warnings).toHaveLength(1);
    const retry = await agent.post(`/api/v1/posts/${draft.body.id}/publish`).send();
    expect(retry.status).toBe(200);
    expect(retry.body.id).toBe(draft.body.id);
  });

  it("keeps approval opt-in intact and repeats do not requeue an approved recap", async () => {
    const { agent, body, team, user } = await fixture();
    const [row] = await db.select().from(teams).where(eq(teams.id, team.id));
    await db.update(organizations).set({ requireRecapApproval: true }).where(eq(organizations.id, row.organizationId!));
    await db.delete(organizationAdmins).where(and(eq(organizationAdmins.organizationId, row.organizationId!), eq(organizationAdmins.userId, user.id)));
    const draft = await agent.post("/api/v1/posts").set("Idempotency-Key", randomUUID()).send({ ...body, status: "draft" });
    const first = await agent.post(`/api/v1/posts/${draft.body.id}/publish`).send();
    expect(first.status).toBe(200);
    expect(first.body.requiresApproval).toBe(true);
    const id = draft.body.id.replace("article-", "");
    const [pending] = await db.select().from(articles).where(eq(articles.id, id));
    expect(pending.status).toBe("pending_approval");
    const publishedAt = new Date();
    await db.update(articles).set({ status: "published", publishedAt }).where(eq(articles.id, id));
    const repeat = await agent.post(`/api/v1/posts/${draft.body.id}/publish`).send();
    expect(repeat.body.requiresApproval).toBe(false);
    const [after] = await db.select().from(articles).where(eq(articles.id, id));
    expect(after.publishedAt).toEqual(publishedAt);
    expect(after.status).toBe("published");
  });

  it("does not resurrect a deleted canonical recap and rejects malformed keys", async () => {
    const { agent, body } = await fixture();
    const key = randomUUID();
    const first = await agent.post("/api/v1/posts").set("Idempotency-Key", key).send(body);
    await db.delete(articles).where(eq(articles.id, first.body.id.replace("article-", "")));
    expect((await agent.post("/api/v1/posts").set("Idempotency-Key", key).send(body)).status).toBe(409);
    expect((await agent.post("/api/v1/posts").set("Idempotency-Key", "bad").send(body)).status).toBe(400);
    expect(await db.select().from(articles).where(eq(articles.title, body.title))).toHaveLength(0);
  });
});
