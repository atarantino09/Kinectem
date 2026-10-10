import { afterEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  articles, competitionAdmins, competitionOrganizers, competitionRecapMail,
  competitionRecapPublications, db, guardianLinks, notificationPreferences,
  notifications, organizationAdmins, organizations, organizerAdmins, rosterEntries,
  teams, tournamentParticipants, tournaments, users,
} from "@workspace/db";
import {
  buildRecapMail, COMPETITION_RECAP_MIGRATION, deliverCompetitionRecaps, recapWindowStart,
} from "@workspace/competition-recap-alerts";
import { applyUnsubscribe, getOrCreatePreferences, updatePreferences } from "../src/lib/notification-prefs";
import { app, DEMO_PASSWORD, loginAs, request } from "./helpers";

vi.mock("../src/lib/competition-recap-scheduler", () => ({ sweepCompetitionRecapMail: vi.fn(async () => {}) }));
vi.mock("../src/lib/notification-email", async importOriginal => ({
  ...await importOriginal<typeof import("../src/lib/notification-email")>(),
  dispatchNotificationEmail: vi.fn(async () => {}),
  dispatchNotificationEmailToMany: vi.fn(async () => {}),
}));

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const remove of cleanup.splice(0).reverse()) await remove();
});

async function fixture() {
  const author = await loginAs("coach@kinectem.demo");
  const [seed] = await db.select().from(users).where(eq(users.id, author.user.id));
  async function adult(label: string, extra: Partial<typeof users.$inferInsert> = {}) {
    const [user] = await db.insert(users).values({
      name: label, email: `${label.toLowerCase()}-${crypto.randomUUID()}@example.test`,
      passwordHash: seed.passwordHash, role: "fan", ...extra,
    }).returning();
    cleanup.push(() => db.delete(users).where(eq(users.id, user.id)));
    const agent = request.agent(app);
    await agent.post("/api/v1/auth/login").send({ email: user.email, password: DEMO_PASSWORD }).expect(200);
    return { user, agent };
  }
  const owner = await adult("Owner");
  const direct = await adult("Direct");
  const hub = await adult("Hub");
  const hubOwner = await adult("HubOwner");
  const stranger = await adult("Stranger");
  const [organizer] = await db.insert(competitionOrganizers).values({
    ownerUserId: hubOwner.user.id, name: "Review organizer", slug: `review-hub-${crypto.randomUUID()}`,
  }).returning();
  cleanup.push(() => db.delete(competitionOrganizers).where(eq(competitionOrganizers.id, organizer.id)));
  await db.insert(organizerAdmins).values({ organizerId: organizer.id, userId: hub.user.id });
  const [competition] = await db.insert(tournaments).values({
    ownerUserId: owner.user.id, createdById: owner.user.id,
    organizerId: organizer.id, name: "Review Cup", slug: `review-${crypto.randomUUID()}`,
    startDate: "2026-10-01", endDate: "2026-10-30",
  }).returning();
  cleanup.push(() => db.delete(tournaments).where(eq(tournaments.id, competition.id)));
  await db.insert(competitionAdmins).values([
    { competitionId: competition.id, userId: direct.user.id },
    { competitionId: competition.id, userId: hub.user.id }, // overlapping role
  ]);
  const [org] = await db.insert(organizations).values({ name: "Review club" }).returning();
  cleanup.push(() => db.delete(organizations).where(eq(organizations.id, org.id)));
  await db.insert(organizationAdmins).values({ organizationId: org.id, userId: owner.user.id, role: "owner" });
  const [team] = await db.insert(teams).values({ organizationId: org.id, name: "Review team" }).returning();
  cleanup.push(() => db.delete(teams).where(eq(teams.id, team.id)));
  await db.insert(rosterEntries).values({ teamId: team.id, userId: author.user.id, role: "coach", status: "accepted" });
  await db.insert(tournamentParticipants).values({
    tournamentId: competition.id, teamId: team.id, name: team.name, nameKey: team.name.toLowerCase(),
    claimedByUserId: author.user.id, claimedAt: new Date(),
  });
  async function recap(extra: Partial<typeof articles.$inferInsert> = {}) {
    const [article] = await db.insert(articles).values({
      title: "A hard-fought win", body: "The complete recap text.", teamId: team.id,
      authorId: author.user.id, competitionId: competition.id,
      gameDate: new Date("2026-10-10T12:00:00Z"), ...extra,
    }).returning();
    return article;
  }
  const payload = {
    postType: "long", teamId: team.id, title: "Coach publication", body: "Full game story.",
    competitionId: competition.id, gameDate: "2026-10-10T12:00:00Z",
  };
  return { author, owner, direct, hub, hubOwner, stranger, organizer, competition, org, team, adult, recap, payload };
}

describe("competition recap review", () => {
  it("shows two pending only to operators; typed View works for direct and inherited non-team administrators", async () => {
    const f = await fixture();
    const empty = await f.owner.agent.get(`/api/v1/competitions/${f.competition.id}/recaps`).expect(200);
    expect(empty.body).toMatchObject({ pendingCount: 0, reviewedCount: 0, featuredCount: 0, data: [] });
    const a = await f.recap();
    await f.recap({ title: "Second recap" });
    const path = `/api/v1/competitions/${f.competition.id}/recaps`;
    for (const operator of [f.owner, f.direct, f.hub, f.hubOwner]) {
      const queue = await operator.agent.get(path).expect(200);
      expect(queue.body.pendingCount).toBe(2);
      expect(queue.body).toMatchObject({ reviewedCount: 0, featuredCount: 0 });
      expect(queue.body.data[0].postId).toMatch(/^article-/);
      await operator.agent.get(`/api/v1/posts/article-${a.id}`).expect(200)
        .expect(res => expect(res.body.body).toBe("The complete recap text."));
      await operator.agent.get(`/api/v1/posts/${a.id}`).expect(404);
      const publicPage = await operator.agent.get(`/api/v1/competitions/${f.competition.slug}`).expect(200);
      expect(publicPage.body.pendingRecapCount).toBe(2);
    }
    await f.stranger.agent.get(path).expect(403);
    const visitor = await request(app).get(`/api/v1/competitions/${f.competition.slug}`).expect(200);
    expect(visitor.body).not.toHaveProperty("pendingRecapCount");
    const ordinary = await f.stranger.agent.get(`/api/v1/competitions/${f.competition.slug}`).expect(200);
    expect(ordinary.body).not.toHaveProperty("pendingRecapCount");
  });

  it("acknowledges without featuring, then features and removes without returning to pending or unpublishing", async () => {
    const f = await fixture();
    const a = await f.recap();
    const base = `/api/v1/competitions/${f.competition.id}/recaps`;
    await f.stranger.agent.post(`${base}/${a.id}/feature`).send({ featured: true }).expect(403);
    await f.direct.agent.post(`${base}/${a.id}/feature`).send({ featured: false }).expect(200);
    let queue = await f.direct.agent.get(`${base}?review=reviewed`).expect(200);
    expect(queue.body).toMatchObject({ pendingCount: 0, reviewedCount: 1, featuredCount: 0, data: [expect.objectContaining({ id: a.id, reviewState: "reviewed", featured: false })] });
    const [ack] = await db.select().from(articles).where(eq(articles.id, a.id));
    expect(ack.status).toBe("published");
    expect(ack.competitionReviewedBy).toBe(f.direct.user.id);
    await f.hub.agent.post(`${base}/${a.id}/feature`).send({ featured: true }).expect(200);
    queue = await f.owner.agent.get(`${base}?review=featured`).expect(200);
    expect(queue.body.data[0].reviewState).toBe("featured");
    expect(queue.body).toMatchObject({ pendingCount: 0, reviewedCount: 0, featuredCount: 1 });
    await f.owner.agent.post(`${base}/${a.id}/feature`).send({ featured: false }).expect(200);
    const [removed] = await db.select().from(articles).where(eq(articles.id, a.id));
    expect(removed.competitionReviewedAt).toEqual(ack.competitionReviewedAt);
    expect(removed.competitionReviewedBy).toBe(f.direct.user.id);
    expect((await f.owner.agent.get(`${base}?review=pending`)).body).toMatchObject({
      pendingCount: 0, reviewedCount: 1, featuredCount: 0, data: [],
    });
  });

  it("counts and pages queues over 100 and excludes drafts, private plans, historical/combined, archived and takedown content", async () => {
    const f = await fixture();
    await db.insert(articles).values(Array.from({ length: 103 }, (_, n) => ({
      teamId: f.team.id, authorId: f.author.user.id, competitionId: f.competition.id,
      title: `Older recap ${n}`, body: "Game recap", gameDate: new Date("2026-10-10"),
    })));
    await db.insert(articles).values(Array.from({ length: 207 }, (_, n) => ({
      teamId: f.team.id, authorId: f.author.user.id, competitionId: f.competition.id,
      title: `Reviewed recap ${n}`, body: "Game recap", gameDate: new Date("2026-10-10"),
      competitionReviewedAt: new Date(), featured: n >= 105,
    })));
    const excluded = [
      await f.recap({ status: "draft" }), await f.recap({ articleKind: "practice_plan" }),
      await f.recap({ recapKind: "combined" }), await f.recap({ recapKind: "historical" }),
      await f.recap({ hiddenAt: new Date(), featured: true }),
      await f.recap({ status: "draft", competitionReviewedAt: new Date() }),
      await f.recap({ competitionId: null, featured: true }),
    ];
    const base = `/api/v1/competitions/${f.competition.id}/recaps`;
    const page = await f.owner.agent.get(`${base}?review=pending`).expect(200);
    expect(page.body.pendingCount).toBe(103);
    expect(page.body).toMatchObject({ reviewedCount: 105, featuredCount: 102 });
    expect(page.body.data).toHaveLength(100);
    const older = await f.owner.agent.get(`${base}?review=pending&offset=${page.body.nextOffset}`).expect(200);
    expect(older.body.data).toHaveLength(3);
    expect(older.body.nextOffset).toBeNull();
    expect(older.body).toMatchObject({ pendingCount: 103, reviewedCount: 105, featuredCount: 102 });
    for (const [view, total] of [["reviewed", 105], ["featured", 102]] as const) {
      const first = await f.owner.agent.get(`${base}?review=${view}`).expect(200);
      const next = await f.owner.agent.get(`${base}?review=${view}&offset=${first.body.nextOffset}`).expect(200);
      expect(first.body.data).toHaveLength(100);
      expect(next.body.data).toHaveLength(total - 100);
      for (const response of [first, next]) {
        expect(response.body).toMatchObject({ pendingCount: 103, reviewedCount: 105, featuredCount: 102 });
      }
    }
    for (const a of excluded) {
      await f.owner.agent.post(`${base}/${a.id}/feature`).send({ featured: true }).expect(404);
      if (a.status === "draft" || a.articleKind === "practice_plan" || a.hiddenAt) {
        await f.hub.agent.get(`/api/v1/posts/article-${a.id}`).expect(404);
      }
    }
    await db.execute(sql`INSERT INTO takedown_requests(child_user_id,post_kind,post_ref_id,status) VALUES(${f.author.user.id},'article',${page.body.data[0].id},'pending')`);
    expect((await f.owner.agent.get(base)).body.pendingCount).toBe(102);
    await f.owner.agent.post(`${base}/${page.body.data[0].id}/feature`).send({ featured: true }).expect(404);
    await db.update(teams).set({ archivedAt: new Date() }).where(eq(teams.id, f.team.id));
    expect((await f.owner.agent.get(base)).body).toMatchObject({ pendingCount: 0, reviewedCount: 0, featuredCount: 0 });
  });

  it("backfills legacy featured acknowledgement without mail and never repeats on a later boot", async () => {
    const f = await fixture();
    const featured = await f.recap({ featured: true });
    const pending = await f.recap();
    await db.execute(sql`DELETE FROM competition_recap_mail`);
    await db.execute(sql`DELETE FROM competition_recap_publications`);
    await db.execute(sql`DELETE FROM competition_recap_migration_marker`);
    await db.execute(sql.raw(COMPETITION_RECAP_MIGRATION.sql));
    expect(await db.select().from(competitionRecapMail)).toEqual([]);
    const [stored] = await db.select().from(articles).where(eq(articles.id, featured.id));
    expect(stored.competitionReviewedAt).not.toBeNull();
    const newer = await f.recap();
    await db.execute(sql.raw(COMPETITION_RECAP_MIGRATION.sql));
    const queue = await f.owner.agent.get(`/api/v1/competitions/${f.competition.id}/recaps?review=pending`);
    expect(queue.body.data.map((a: { id: string }) => a.id)).toEqual(expect.arrayContaining([pending.id, newer.id]));
    expect(queue.body.pendingCount).toBe(2);
  });

  it("keeps support-created ownerless competitions from alerting unrelated platform admins, and decides reviews atomically", async () => {
    const f = await fixture();
    const support = await f.adult("Support", { role: "admin" });
    await db.update(tournaments).set({ ownerUserId: null, createdById: support.user.id }).where(eq(tournaments.id, f.competition.id));
    const a = await f.recap();
    expect((await db.select().from(notifications).where(eq(notifications.userId, support.user.id))).filter(n => n.kind === "competition_recap_pending")).toEqual([]);
    const base = `/api/v1/competitions/${f.competition.id}/recaps`;
    await Promise.all([
      f.direct.agent.post(`${base}/${a.id}/feature`).send({ featured: true }).expect(200),
      f.hub.agent.post(`${base}/${a.id}/feature`).send({ featured: false }).expect(200),
    ]);
    const [stored] = await db.select().from(articles).where(eq(articles.id, a.id));
    expect(stored.competitionReviewedAt).not.toBeNull();
    expect(stored.status).toBe("published");
    expect((await f.hub.agent.get(base)).body.pendingCount).toBe(0);
  });

  it("captures direct create, draft publication and approval once; reading bells leaves reviews pending", async () => {
    const f = await fixture();
    const direct = await f.author.agent.post("/api/v1/posts").send(f.payload).expect(201);
    const draft = await f.author.agent.post("/api/v1/posts").send({ ...f.payload, status: "draft" }).expect(201);
    await f.author.agent.post(`/api/v1/posts/${draft.body.id}/publish`).expect(200);
    await f.author.agent.post(`/api/v1/posts/${draft.body.id}/publish`).expect(200);
    await f.author.agent.patch(`/api/v1/posts/${direct.body.id}`).send({ title: "Edited title" }).expect(200);
    await db.update(organizations).set({ requireRecapApproval: true }).where(eq(organizations.id, f.org.id));
    await db.insert(competitionAdmins).values({ competitionId: f.competition.id, userId: f.author.user.id });
    const pending = await f.author.agent.post("/api/v1/posts").send(f.payload).expect(201);
    expect((await db.select().from(competitionRecapPublications))).toHaveLength(2);
    const pendingId = pending.body.id.replace(/^article-/, "");
    await f.owner.agent.post(`/api/v1/organizations/${f.org.id}/post-approvals/${pending.body.id}/approve`).expect(200);
    expect((await db.select().from(competitionRecapPublications))).toHaveLength(3);
    const bells = await db.select().from(notifications).where(eq(notifications.kind, "competition_recap_pending"));
    expect(bells.filter(b => b.userId === f.hub.user.id)).toHaveLength(3);
    expect(bells.filter(b => b.userId === f.owner.user.id)).toHaveLength(2); // approver is actor
    expect(bells.some(b => b.userId === f.stranger.user.id || b.userId === f.author.user.id)).toBe(false);
    expect(bells[0].link).toBe(`/competitions/${f.competition.id}?recaps=pending#recaps`);
    await db.update(notifications).set({ read: true }).where(eq(notifications.userId, f.hub.user.id));
    expect((await f.hub.agent.get(`/api/v1/competitions/${f.competition.id}/recaps`)).body.pendingCount).toBe(3);
    expect(pendingId).toMatch(/^[0-9a-f-]+$/);
  });
});

describe("durable competition recap email", () => {
  async function onlyOwner(f: Awaited<ReturnType<typeof fixture>>, mode: "digest" | "immediate" = "digest") {
    for (const admin of [f.direct, f.hub, f.hubOwner]) await updatePreferences(admin.user.id, { competitionRecapMode: "off" });
    await updatePreferences(f.owner.user.id, { competitionRecapMode: mode });
  }
  function worker(send = vi.fn(async (_: unknown) => {}), now = new Date(Date.now() + 3 * 60 * 60 * 1000)) {
    return { send, now, baseUrl: "https://example.test" };
  }
  it("has exact disjoint UTC boundaries and branded-builder HTML/plaintext links", () => {
    expect(recapWindowStart(new Date("2026-10-10T01:59:59.999Z")).toISOString()).toBe("2026-10-10T00:00:00.000Z");
    expect(recapWindowStart(new Date("2026-10-10T02:00:00.000Z")).toISOString()).toBe("2026-10-10T02:00:00.000Z");
    const email = buildRecapMail({ to: "test@example.test", name: "Admin", token: "test-token", baseUrl: "https://example.test",
      immediate: false, items: [{ title: "<script>win</script>", team: "Team", competition: "Cup", competitionId: "cup-id", slug: "cup" }] });
    expect(email.html).toContain("&lt;script&gt;");
    for (const content of [email.text, email.html]) {
      expect(content).toContain("/app/competitions/cup-id?recaps=pending#recaps");
      expect(content).toContain("/app/settings");
      expect(content).toContain("cat=competition_recap");
    }
  });

  it("saves personal modes/default, rejects invalid values, honors unsubscribe and never changes another admin", async () => {
    const f = await fixture();
    expect((await f.owner.agent.get("/api/v1/notifications/preferences")).body.competitionRecapMode).toBe("digest");
    await f.owner.agent.put("/api/v1/notifications/preferences").send({ competitionRecapMode: "immediate" }).expect(200);
    expect((await f.owner.agent.get("/api/v1/notifications/preferences")).body.competitionRecapMode).toBe("immediate");
    expect((await f.direct.agent.get("/api/v1/notifications/preferences")).body.competitionRecapMode).toBe("digest");
    await f.owner.agent.put("/api/v1/notifications/preferences").send({ competitionRecapMode: "daily" }).expect(400);
    const prefs = await getOrCreatePreferences(f.owner.user.id);
    expect(await applyUnsubscribe(prefs.unsubscribeToken, "competition_recap")).toBe(true);
    expect((await getOrCreatePreferences(f.owner.user.id)).competitionRecapMode).toBe("off");
  });

  it("groups several competitions into one nonempty recipient/window email, never sends current/empty windows or resends after restart", async () => {
    const f = await fixture();
    await onlyOwner(f);
    await f.recap({ title: "First team recap" });
    const [other] = await db.insert(tournaments).values({
      name: "Second Cup", slug: `second-${crypto.randomUUID()}`, ownerUserId: f.owner.user.id,
      startDate: "2026-10-01", endDate: "2026-10-30",
    }).returning();
    cleanup.push(() => db.delete(tournaments).where(eq(tournaments.id, other.id)));
    await f.recap({ competitionId: other.id, title: "Second competition recap" });
    const options = worker();
    expect(await deliverCompetitionRecaps({ ...options, now: new Date() })).toMatchObject({ sent: 0 });
    expect(await deliverCompetitionRecaps(options)).toMatchObject({ sent: 1, failed: 0 });
    const email = options.send.mock.calls[0]?.[0] as { text: string };
    expect(email.text).toContain("Review Cup");
    expect(email.text).toContain("Second Cup");
    expect(email.text).toContain("Review team: First team recap");
    expect(await deliverCompetitionRecaps(options)).toMatchObject({ sent: 0, failed: 0 });
    expect(options.send).toHaveBeenCalledTimes(1);
  });

  it("sends immediately, dedupes overlapping recipients, and Off/Pause suppress only email", async () => {
    const f = await fixture();
    await onlyOwner(f, "immediate");
    await f.recap();
    const options = worker(undefined, new Date());
    expect(await deliverCompetitionRecaps(options)).toMatchObject({ sent: 1 });
    await updatePreferences(f.owner.user.id, { pauseAll: true });
    await f.recap();
    expect(await deliverCompetitionRecaps(worker())).toMatchObject({ sent: 0 });
    expect((await f.owner.agent.get(`/api/v1/competitions/${f.competition.id}/recaps`)).body.pendingCount).toBe(2);
    expect((await db.select().from(notifications).where(eq(notifications.userId, f.owner.user.id))).filter(n => n.kind === "competition_recap_pending")).toHaveLength(2);
  });

  it("delivers two closed UTC windows separately and defers a window with an uncommitted publication", async () => {
    const f = await fixture();
    await onlyOwner(f);
    const first = await f.recap();
    const second = await f.recap();
    await db.update(competitionRecapMail).set({ windowStart: new Date("2026-10-10T00:00:00Z") }).where(eq(competitionRecapMail.articleId, first.id));
    await db.update(competitionRecapMail).set({ windowStart: new Date("2026-10-10T02:00:00Z") }).where(eq(competitionRecapMail.articleId, second.id));
    const options = worker(undefined, new Date("2099-01-01"));
    await db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(hashtextextended('competition-recap-window:2026-10-10 00:00:00',0))`);
      expect((await deliverCompetitionRecaps(options)).sent).toBe(1);
    });
    expect((await deliverCompetitionRecaps(options)).sent).toBe(1);
    expect(options.send).toHaveBeenCalledTimes(2);
  });

  it("retries transient failures after backoff and prevents concurrent workers from sending the same window", async () => {
    const f = await fixture();
    await onlyOwner(f);
    await f.recap();
    const options = worker(vi.fn(async () => { throw new Error("Transient failure"); }));
    expect(await deliverCompetitionRecaps(options)).toMatchObject({ failed: 1, sent: 0 });
    const retry = worker(undefined, options.now);
    await deliverCompetitionRecaps(retry);
    expect(retry.send).not.toHaveBeenCalled();
    const later = worker(undefined, new Date(options.now.getTime() + 60_001));
    await Promise.all([deliverCompetitionRecaps(later), deliverCompetitionRecaps(later)]);
    expect(later.send).toHaveBeenCalledTimes(1);
  });

  it("discards old mode backlog and rechecks removed rights, hidden/deleted/unlinked recaps and preferences before sending", async () => {
    const f = await fixture();
    await onlyOwner(f);
    await f.recap();
    await updatePreferences(f.owner.user.id, { competitionRecapMode: "off" });
    await updatePreferences(f.owner.user.id, { competitionRecapMode: "digest" });
    expect((await deliverCompetitionRecaps(worker())).sent).toBe(0);
    const hidden = await f.recap();
    const removed = await f.recap();
    const deleted = await f.recap();
    await db.update(articles).set({ hiddenAt: new Date() }).where(eq(articles.id, hidden.id));
    await db.update(articles).set({ competitionId: null }).where(eq(articles.id, removed.id));
    await db.delete(articles).where(eq(articles.id, deleted.id));
    expect((await deliverCompetitionRecaps(worker())).sent).toBe(0);
    await f.recap();
    await db.update(tournaments).set({ ownerUserId: f.stranger.user.id, createdById: f.stranger.user.id }).where(eq(tournaments.id, f.competition.id));
    expect((await deliverCompetitionRecaps(worker())).sent).toBe(0);
  });

  it("routes minor admins to adult guardians, dedupes guardian/direct roles and excludes resolved actor recipients", async () => {
    const f = await fixture();
    await onlyOwner(f);
    const [minor] = await db.insert(users).values({ name: "Minor administrator", role: "athlete", isMinor: true, accountStatus: "active" }).returning();
    cleanup.push(() => db.delete(users).where(eq(users.id, minor.id)));
    await db.insert(competitionAdmins).values({ competitionId: f.competition.id, userId: minor.id });
    await db.insert(guardianLinks).values({ childId: minor.id, guardianId: f.owner.user.id, status: "active" });
    await f.recap();
    const queued = await db.select().from(competitionRecapMail);
    expect(queued).toHaveLength(1);
    expect(queued[0].recipientId).toBe(f.owner.user.id);
    expect(queued[0].targetIds).toEqual(expect.arrayContaining([f.owner.user.id, minor.id]));
    const options = worker();
    expect((await deliverCompetitionRecaps(options)).sent).toBe(1);
    await f.recap({ publishedById: f.owner.user.id });
    const later = worker();
    expect((await deliverCompetitionRecaps(later)).sent).toBe(0);
    const minorBells = await db.select().from(notifications).where(eq(notifications.userId, minor.id));
    expect(minorBells.filter(n => n.kind === "competition_recap_pending")).toHaveLength(2);
  });
});
