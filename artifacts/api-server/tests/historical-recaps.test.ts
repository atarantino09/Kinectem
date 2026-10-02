import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { db, articles, assets, articleTags, orgPosts, organizations, organizationAdmins, organizationFollowers, scheduleEvents, teams, aiProviderKeys, userFollowers, takedownRequests } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { app, request, loginAs } from "./helpers";
import { applyArticleTagFanout } from "../src/lib/article-tagging";
import { HISTORICAL_TRANSCRIPTION_INSTRUCTION } from "../src/lib/ai";
import { HistoricalMetadata, validateHistoricalImage } from "../src/lib/historical-recaps";
import { encryptSecret } from "../src/lib/secret-crypto";

const mocks = vi.hoisted(() => ({
  transcribe: vi.fn(), save: vi.fn(), serve: vi.fn(), message: vi.fn(),
}));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class { messages = { create: mocks.message }; },
}));
vi.mock("../src/lib/ai", async (original) => ({
  ...await original<typeof import("../src/lib/ai")>(),
  transcribeHistoricalClipping: mocks.transcribe,
}));
vi.mock("../src/lib/historical-clipping-storage", () => ({
  saveHistoricalClipping: mocks.save, serveHistoricalClipping: mocks.serve,
}));

const historical = {
  gameDate: null, year: 1974, newspaper: "The School Gazette", byline: "Original Reporter",
  publicationDate: "1974-10-12", rightsConfirmed: true, reviewed: false,
};
async function fixture() {
  const [team] = await db.select().from(teams).where(eq(teams.name, "Varsity Football")).limit(1);
  if (!team?.organizationId) throw new Error("Expected seeded school team.");
  return { team, organizationId: team.organizationId, ...(await loginAs("coach@kinectem.demo")) };
}
async function clipping(ownerId: string) {
  const id = randomUUID();
  const url = `/api/v1/historical-clippings/${id}`;
  await db.insert(assets).values({ id, ownerId, fileName: "clipping", fileType: "image/png",
    fileSize: 100, status: "confirmed", url });
  return url;
}
async function draft(kind: "team" | "org" = "team") {
  const f = await fixture();
  const coverImageUrl = await clipping(f.user.id);
  const created = await f.agent.post("/api/v1/historical-recaps").send({
    ...(kind === "team" ? { teamId: f.team.id } : { organizationId: f.organizationId }),
    title: "Tigers win the final", body: "Original first paragraph.\n\nOriginal second paragraph.",
    coverImageUrl, historical,
  });
  expect(created.status).toBe(201);
  return { ...f, id: created.body.id as string, coverImageUrl };
}
async function png() {
  return `data:image/png;base64,${(await sharp({ create: { width: 20, height: 20, channels: 3, background: "white" } }).png().toBuffer()).toString("base64")}`;
}

describe("historical recap safety and lifecycle", () => {
  beforeEach(() => {
    mocks.transcribe.mockReset().mockResolvedValue("Original wording.\n\n[unreadable]");
    mocks.save.mockReset().mockResolvedValue(undefined);
    mocks.serve.mockReset().mockImplementation((_id, type, res) => res.type(type).send("clipping"));
  });

  it("checks authentication, author capability and exact destination before provider calls", async () => {
    const f = await fixture();
    const { agent: athlete } = await loginAs("marcus@kinectem.demo");
    const body = { teamId: f.team.id, imageDataUrl: await png(), rightsConfirmed: true, providerConsent: true };
    expect((await request(app).post("/api/v1/ai/transcribe").send(body)).status).toBe(401);
    expect((await athlete.post("/api/v1/ai/transcribe").send(body)).status).toBe(403);
    await db.delete(organizationAdmins).where(eq(organizationAdmins.userId, f.user.id));
    const [elsewhere] = await db.insert(organizations).values({ name: "Different school" }).returning();
    expect((await f.agent.post("/api/v1/ai/transcribe").send({
      ...body, teamId: undefined, organizationId: elsewhere.id,
    })).status).toBe(403);
    expect(mocks.transcribe).not.toHaveBeenCalled();
    expect((await f.agent.post("/api/v1/ai/transcribe").send(body)).status).toBe(200);
    expect(mocks.transcribe).toHaveBeenCalledOnce();
  });

  it.each(["team", "org"] as const)("keeps a %s draft clipping private despite copied ordinary covers and media references", async (kind) => {
    const f = await draft(kind);
    const { agent: outsider, user } = await loginAs("daniela@kinectem.demo");
    const [school] = await db.insert(organizations).values({ name: "Unrelated school" }).returning();
    await db.insert(organizationAdmins).values({ organizationId: school.id, userId: user.id, role: "owner" });
    const [team] = await db.insert(teams).values({ name: "Unrelated team", organizationId: school.id }).returning();
    // Establish that this is a real authorized author in another destination.
    expect((await outsider.post(`/api/v1/organizations/${school.id}/posts`).send({
      title: "Ordinary update", body: "School news",
    })).status).toBe(201);
    const clipUrls = [f.coverImageUrl, `https://school.example${f.coverImageUrl}?copy=1`,
      f.coverImageUrl.replace("historical-clippings", "%68istorical-clippings")];
    for (const url of clipUrls) {
      expect((await outsider.post("/api/v1/posts").send({
        postType: "long", teamId: team.id, title: "Copied cover", body: "Ordinary recap", coverImageUrl: url,
      })).status).toBe(400);
      expect((await outsider.post(`/api/v1/organizations/${school.id}/posts`).send({
        title: "Copied image", body: "Ordinary update", photoUrls: [url],
      })).status).toBe(400);
    }
    // Also protect legacy references already in the database: raw matching
    // ordinary covers cannot authorize the private clipping-serving route.
    const [legacy] = await db.insert(articles).values({
      teamId: team.id, authorId: user.id, title: "Legacy ordinary reference",
      body: "Not historical", status: "published", coverImageUrl: f.coverImageUrl,
    }).returning();
    await db.insert(orgPosts).values({
      organizationId: school.id, authorId: user.id, title: "Legacy Update",
      body: "Not historical", status: "published", coverImageUrl: f.coverImageUrl,
    });
    expect((await outsider.patch(`/api/v1/posts/article-${legacy.id}`).send({ photoUrls: [f.coverImageUrl] })).status).toBe(400);
    expect((await outsider.post(`/api/v1/posts/article-${legacy.id}/album`).send({
      assetId: f.coverImageUrl.split("/").pop(),
    })).status).toBe(400);
    expect((await outsider.post("/api/v1/historical-recaps").send({
      organizationId: school.id, title: "Stolen history", body: "Copied", historical, coverImageUrl: f.coverImageUrl,
    })).status).toBe(400);
    expect((await request(app).get(f.coverImageUrl)).status).toBe(404);
    expect((await outsider.get(f.coverImageUrl)).status).toBe(404);
    expect((await f.agent.get(f.coverImageUrl)).status).toBe(200);
  });

  it.each(["team", "org"] as const)("cannot revive a moderated %s clipping through ordinary or secondary historical references", async (kind) => {
    const f = await draft(kind);
    expect((await f.agent.post(`/api/v1/posts/${f.id}/publish`).send({ historicalReviewed: true })).status).toBe(200);
    expect((await request(app).get(f.coverImageUrl)).status).toBe(200);
    const refId = f.id.slice(f.id.indexOf("-") + 1);
    if (kind === "team") await db.update(articles).set({ hiddenAt: new Date() }).where(eq(articles.id, refId));
    else await db.insert(takedownRequests).values({ childUserId: f.user.id, postKind: "org_post", postRefId: refId, status: "pending" });
    const { user: outsider, agent } = await loginAs("daniela@kinectem.demo");
    const [school] = await db.insert(organizations).values({ name: "Other school" }).returning();
    await db.insert(organizationAdmins).values({ organizationId: school.id, userId: outsider.id, role: "owner" });
    expect((await agent.post(`/api/v1/organizations/${school.id}/posts`).send({
      title: "Revive image", body: "Ordinary update", photoUrls: [f.coverImageUrl],
    })).status).toBe(400);
    await db.insert(orgPosts).values({ organizationId: school.id, authorId: outsider.id,
      title: "Legacy ordinary copy", body: "Copy", coverImageUrl: f.coverImageUrl, status: "published" });
    // The original uploader cannot reuse a moderated asset in a new recap.
    expect((await f.agent.post("/api/v1/historical-recaps").send({
      organizationId: f.organizationId, title: "Reuse moderated image", body: "Copy", historical, coverImageUrl: f.coverImageUrl,
    })).status).toBe(400);
    // Even a pre-existing second validated historical reference must not
    // override an active moderation/takedown decision for the same clipping.
    await db.insert(orgPosts).values({ organizationId: f.organizationId, authorId: f.user.id,
      title: "Secondary history", body: "Copy", recapKind: "historical", historical: { ...historical, reviewed: true },
      coverImageUrl: f.coverImageUrl, status: "published" });
    expect((await request(app).get(f.coverImageUrl)).status).toBe(404);
    expect((await agent.get(f.coverImageUrl)).status).toBe(404);
    expect(mocks.serve).toHaveBeenCalledTimes(1);
  });

  it("requires both disclosures, validates actual content and caps bytes/dimensions before egress", async () => {
    const f = await fixture();
    const body = { teamId: f.team.id, imageDataUrl: await png(), rightsConfirmed: true, providerConsent: true };
    expect((await f.agent.post("/api/v1/ai/transcribe").send({ ...body, providerConsent: false })).status).toBe(400);
    expect((await f.agent.post("/api/v1/ai/transcribe").send({ ...body, rightsConfirmed: false })).status).toBe(400);
    expect((await f.agent.post("/api/v1/ai/transcribe").send({
      ...body, imageDataUrl: "data:image/png;base64,PGh0bWw+",
    })).status).toBe(400);
    const oversized = `data:image/png;base64,${Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64")}`;
    expect((await f.agent.post("/api/v1/ai/transcribe").send({ ...body, imageDataUrl: oversized })).status).toBe(413);
    const wide = (await sharp({ create: { width: 8001, height: 1, channels: 3, background: "white" } }).png().toBuffer()).toString("base64");
    expect((await f.agent.post("/api/v1/ai/transcribe").send({ ...body, imageDataUrl: `data:image/png;base64,${wide}` })).status).toBe(400);
    expect(mocks.transcribe).not.toHaveBeenCalled();
    expect(HISTORICAL_TRANSCRIPTION_INSTRUCTION).toMatch(/original wording/);
    expect(HISTORICAL_TRANSCRIPTION_INSTRUCTION).toMatch(/\[unreadable\]/);
    expect(HISTORICAL_TRANSCRIPTION_INSTRUCTION).toMatch(/untrusted/);
    expect(HISTORICAL_TRANSCRIPTION_INSTRUCTION).toMatch(/Do not rewrite, summarize, modernize/);
  });

  it("preserves paragraphs and unreadable markers and keeps drafts unchanged on provider failure", async () => {
    const f = await draft();
    mocks.transcribe.mockRejectedValue(new Error("provider unavailable"));
    const failed = await f.agent.post("/api/v1/ai/transcribe").send({
      teamId: f.team.id, imageDataUrl: await png(), rightsConfirmed: true, providerConsent: true,
    });
    expect(failed.status).toBe(502);
    const kept = await f.agent.get(`/api/v1/posts/${f.id}`);
    expect(kept.body.body).toBe("Original first paragraph.\n\nOriginal second paragraph.");
    expect(kept.body.assets[0].url).toBe(f.coverImageUrl);
    mocks.transcribe.mockResolvedValue("Original wording.\n\n[unreadable]");
    const extracted = await f.agent.post("/api/v1/ai/transcribe").send({
      teamId: f.team.id, imageDataUrl: await png(), rightsConfirmed: true, providerConsent: true,
    });
    expect(extracted.body.text).toBe("Original wording.\n\n[unreadable]");
    expect((await f.agent.get(`/api/v1/posts/${f.id}`)).body.articleStatus).toBe("draft");
  });

  it("uploads untouched bytes to App Storage and only persists a serving path", async () => {
    const f = await fixture();
    const imageDataUrl = await png();
    const uploaded = await f.agent.post("/api/v1/historical-recaps/clipping").send({ teamId: f.team.id, imageDataUrl });
    expect(uploaded.status).toBe(201);
    expect(mocks.save.mock.calls[0][1].toString("base64")).toBe(imageDataUrl.split(",")[1]);
    const [asset] = await db.select().from(assets).where(eq(assets.url, uploaded.body.url));
    expect(asset.url).toMatch(/^\/api\/v1\/historical-clippings\//);
    expect((await request(app).get(asset.url!)).status).toBe(404);
    expect((await f.agent.get(asset.url!)).status).toBe(200);
  });

  it("autosaves, reopens and publishes year-only history without current-game effects", async () => {
    const f = await draft();
    expect((await f.agent.get("/api/v1/drafts")).body.data.filter((p: { id: string }) => p.id === f.id)).toHaveLength(1);
    expect((await request(app).get(`/api/v1/posts/${f.id}`)).status).toBe(404);
    expect((await request(app).get(f.coverImageUrl)).status).toBe(404);
    expect((await f.agent.patch(`/api/v1/historical-recaps/${f.id}`).send({ title: "Updated headline" })).status).toBe(200);
    const reopened = await f.agent.get(`/api/v1/posts/${f.id}`);
    expect(reopened.body.historical).toEqual(historical);
    expect(reopened.body.gameDate).toBeNull();
    expect((await f.agent.post(`/api/v1/posts/${f.id}/publish`).send({})).status).toBe(400);
    const published = await f.agent.post(`/api/v1/posts/${f.id}/publish`).send({ historicalReviewed: true });
    expect(published.status).toBe(200);
    expect(published.body.articleStatus).toBe("published");
    expect(published.body.historical.year).toBe(1974);
    expect(published.body.historical.reviewed).toBe(true);
    const articleId = f.id.replace("article-", "");
    await applyArticleTagFanout({ articleId, teamId: f.team.id, taggerUserId: f.user.id,
      explicitUserIds: [], gameDate: new Date(), recapKind: "combined" });
    expect(await db.select().from(articleTags).where(eq(articleTags.articleId, articleId))).toHaveLength(0);
    const [stored] = await db.select().from(articles).where(eq(articles.id, articleId));
    expect(stored.competitionId).toBeNull();
    expect(stored.competitionGameId).toBeNull();
    expect((await f.agent.patch(`/api/v1/posts/${f.id}`).send({ gameDate: "2026-10-01", competitionId: randomUUID() })).status).toBe(400);
    const [event] = await db.insert(scheduleEvents).values({
      teamId: f.team.id, organizationId: f.organizationId, title: "Current game", eventType: "game", startAt: new Date(),
      createdById: f.user.id,
    }).returning();
    expect((await f.agent.post(`/api/v1/teams/${f.team.id}/schedule/${event.id}/link-recap`).send({ recapId: articleId })).status).toBe(404);
    const teamList = await request(app).get(`/api/v1/teams/${f.team.id}/posts`);
    const orgList = await request(app).get(`/api/v1/organizations/${f.organizationId}/posts`);
    expect(teamList.body.data.filter((p: { id: string }) => p.id === f.id)).toHaveLength(1);
    expect(orgList.body.data.filter((p: { id: string }) => p.id === f.id)).toHaveLength(1);
  });

  it("keeps direct org drafts private and publishes a single org-context card to followers", async () => {
    const f = await draft("org");
    const { agent: follower, user } = await loginAs("daniela@kinectem.demo");
    await db.insert(organizationFollowers).values({ organizationId: f.organizationId, userId: user.id }).onConflictDoNothing();
    expect((await follower.get(`/api/v1/posts/${f.id}`)).status).toBe(404);
    expect((await follower.get("/api/v1/drafts")).body.data.some((p: { id: string }) => p.id === f.id)).toBe(false);
    expect((await follower.get(`/api/v1/posts/${f.id}/comments`)).status).toBe(404);
    expect((await follower.patch(`/api/v1/historical-recaps/${f.id}`).send({ title: "No" })).status).toBe(403);
    const ownList = await f.agent.get("/api/v1/drafts");
    expect(ownList.body.data.find((p: { id: string }) => p.id === f.id).organizationId).toBe(f.organizationId);
    const published = await f.agent.post(`/api/v1/posts/${f.id}/publish`).send({ historicalReviewed: true });
    expect(published.status).toBe(200);
    expect(published.body.context.type).toBe("organization");
    const feed = await follower.get("/api/v1/feed");
    expect(feed.body.data.filter((p: { id: string }) => p.id === f.id)).toHaveLength(1);
    expect((await request(app).get(`/api/v1/teams/${f.team.id}/posts`)).body.data.some((p: { id: string }) => p.id === f.id)).toBe(false);
    expect((await request(app).get(`/api/v1/organizations/${f.organizationId}/posts`)).body.data.filter((p: { id: string }) => p.id === f.id)).toHaveLength(1);
    expect((await request(app).get(f.coverImageUrl)).status).toBe(200);
    const update = await f.agent.patch(`/api/v1/historical-recaps/${f.id}`).send({
      body: "Manually corrected original transcript.", historical: { ...historical, reviewed: true },
    });
    expect(update.status).toBe(200);
    expect(update.body.historical.newspaper).toBe(historical.newspaper);
    expect((await f.agent.patch(`/api/v1/historical-recaps/${f.id}`).send({ body: "Unreviewed replacement" })).status).toBe(400);
    const [stored] = await db.select().from(orgPosts).where(eq(orgPosts.id, f.id.replace("orgpost-", "")));
    expect(stored.body).toBe("Manually corrected original transcript.");
  });

  it("retains opt-in team approval with no roster tagging on approval", async () => {
    const f = await fixture();
    await db.update(organizations).set({ requireRecapApproval: true }).where(eq(organizations.id, f.organizationId));
    await db.delete(organizationAdmins).where(eq(organizationAdmins.userId, f.user.id));
    const created = await f.agent.post("/api/v1/historical-recaps").send({
      teamId: f.team.id, title: "1974 final", body: "Original account.",
      coverImageUrl: await clipping(f.user.id), historical: { ...historical, year: null, gameDate: "1974-10-10" },
    });
    expect(created.status).toBe(201);
    const id = created.body.id;
    const submitted = await f.agent.post(`/api/v1/posts/${id}/publish`).send({ historicalReviewed: true });
    expect(submitted.body.articleStatus).toBe("pending_approval");
    const { agent: admin } = await loginAs("sam@kinectem.demo");
    const approved = await admin.post(`/api/v1/organizations/${f.organizationId}/post-approvals/${id}/approve`);
    expect(approved.status).toBe(200);
    expect((await f.agent.get(`/api/v1/posts/${id}`)).body.historical.gameDate).toBe("1974-10-10");
    expect(await db.select().from(articleTags).where(eq(articleTags.articleId, id.replace("article-", "")))).toHaveLength(0);
  });

  it("keeps likes, comments and re-shares working for both historical scopes without opening ordinary Updates to re-shares", async () => {
    const team = await draft("team");
    const school = await draft("org");
    const { agent: fan, user: sharer } = await loginAs("daniela@kinectem.demo");
    const { agent: follower, user } = await loginAs("sam@kinectem.demo");
    await db.insert(userFollowers).values({ followerUserId: user.id, followingUserId: sharer.id, status: "approved" });
    await db.insert(organizationFollowers).values({ organizationId: school.organizationId, userId: user.id }).onConflictDoNothing();
    for (const f of [team, school]) {
      expect((await f.agent.post(`/api/v1/posts/${f.id}/publish`).send({ historicalReviewed: true })).status).toBe(200);
      expect((await fan.put(`/api/v1/posts/${f.id}/reactions`).send({ reactionType: "like" })).status).toBe(204);
      expect((await fan.post(`/api/v1/posts/${f.id}/comments`).send({ body: "Thanks for sharing this piece of school history." })).status).toBe(201);
      expect((await fan.post(`/api/v1/posts/${f.id}/share`)).status).toBe(204);
      expect((await fan.get(`/api/v1/posts/${f.id}`)).body.shareCount).toBe(1);
    }
    const feed = await follower.get("/api/v1/feed");
    expect(feed.body.data.filter((p: { id: string }) => p.id === school.id)).toHaveLength(1);
    const profile = await follower.get(`/api/v1/users/${sharer.id}/posts`);
    expect(profile.body.data.filter((p: { id: string }) => p.id === school.id)).toHaveLength(1);
    expect((await school.agent.get(`/api/v1/organizations/${school.organizationId}/posts`)).body.data.find((p: { id: string }) => p.id === school.id).shareCount).toBe(1);
    expect((await fan.delete(`/api/v1/posts/${school.id}/share`)).status).toBe(204);
    expect((await fan.get(`/api/v1/posts/${school.id}`)).body.shareCount).toBe(0);
    const [ordinary] = await db.insert(orgPosts).values({
      organizationId: school.organizationId, authorId: school.user.id,
      title: "Ordinary update", body: "News today", status: "published",
    }).returning();
    expect((await fan.post(`/api/v1/posts/orgpost-${ordinary.id}/share`)).status).toBe(400);
  });

  it("validates metadata without guessing dates or allowing subtype upgrades", async () => {
    expect(HistoricalMetadata.safeParse({ ...historical, gameDate: "1974-02-30", year: null }).success).toBe(false);
    expect(HistoricalMetadata.safeParse({ ...historical, gameDate: "1974-10-10" }).success).toBe(false);
    expect(HistoricalMetadata.safeParse({ ...historical, year: 999 }).success).toBe(false);
    expect(HistoricalMetadata.parse({}).gameDate).toBeNull();
    await expect(validateHistoricalImage("data:image/jpeg;base64,aGVsbG8=")).rejects.toThrow();
    const f = await fixture();
    expect((await f.agent.post("/api/v1/posts").send({
      postType: "long", teamId: f.team.id, title: "Forged", recapKind: "historical", historical,
    })).status).toBe(400);
    expect((await f.agent.post(`/api/v1/organizations/${f.organizationId}/posts`).send({
      title: "Forged", recapKind: "historical", historical,
    })).status).toBe(400);
  });

  it("uses the configured model but ignores writing personality and rejects truncated output", async () => {
    const realAi = await vi.importActual<typeof import("../src/lib/ai")>("../src/lib/ai");
    await db.insert(aiProviderKeys).values({
      provider: "anthropic", keyCiphertext: encryptSecret("test-not-real-key"),
      keyLast4: "-key", model: "test-configured-model",
      systemContext: "Rewrite everything as a dramatic modern summary.",
    });
    mocks.message.mockResolvedValue({
      content: [{ type: "text", text: "Original sentence.\n\n[unreadable]" }], stop_reason: "end_turn",
    });
    const image = await validateHistoricalImage(await png());
    expect(await realAi.transcribeHistoricalClipping(image)).toBe("Original sentence.\n\n[unreadable]");
    const input = mocks.message.mock.calls[0][0];
    expect(input.model).toBe("test-configured-model");
    expect(input.system).toBe(HISTORICAL_TRANSCRIPTION_INSTRUCTION);
    expect(input.system).not.toContain("dramatic");
    expect(input.max_tokens).toBe(8192);
    mocks.message.mockResolvedValue({ content: [{ type: "text", text: "Partial text" }], stop_reason: "max_tokens" });
    await expect(realAi.transcribeHistoricalClipping(image)).rejects.toThrow(/output limit/);
  });
});