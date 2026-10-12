import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { sql, eq } from "drizzle-orm";
import { db, articles, teams, organizations, rosterEntries, users, assets, albumPhotos, organizationAdmins } from "@workspace/db";
import { ACHIEVEMENT_CATALOG, earnedTier } from "../src/lib/achievement-catalog";
import { ACHIEVEMENT_MIGRATION } from "../src/lib/achievement-migration";
import { previousSeasonError } from "../src/lib/previous-season";
import { app, loginAs, request } from "./helpers";

const q = async (query: ReturnType<typeof sql>) => (await db.execute(query)).rows as Record<string, any>[];
async function fixture() {
  const { agent, user } = await loginAs("coach@kinectem.demo");
  const [org] = await db.insert(organizations).values({ name: `Achievements ${randomUUID()}` }).returning();
  await db.insert(organizationAdmins).values({ organizationId: org.id, userId: user.id, role: "owner" });
  const [team] = await db.insert(teams).values({ name: "Outside league team", organizationId: org.id }).returning();
  await db.insert(rosterEntries).values({ teamId: team.id, userId: user.id, role: "coach", status: "accepted" });
  return { agent, user, org, team };
}
async function recap(teamId: string, authorId: string, extra: Partial<typeof articles.$inferInsert> = {}) {
  return (await db.insert(articles).values({
    teamId, authorId, title: "Legitimate distinct story", body: "Same text is still a separate persisted recap.",
    gameDate: new Date("2026-09-01"), status: "published", publishedAt: new Date(), ...extra,
  }).returning())[0];
}
beforeEach(async () => {
  await db.execute(sql.raw(ACHIEVEMENT_MIGRATION.sql));
  await db.execute(sql`TRUNCATE achievement_contributions,achievement_awards,achievement_settings,achievement_streaks,achievement_streak_events`);
});

describe("community achievements", () => {
  it("defines all twelve catalogs and exact named-tier thresholds", () => {
    expect(ACHIEVEMENT_CATALOG).toHaveLength(12);
    for (const item of ACHIEVEMENT_CATALOG) {
      item.thresholds.forEach((n, index) => {
        expect(earnedTier(item.thresholds, n)).toBe(index + 1);
        expect(earnedTier(item.thresholds, n - 1)).toBe(index);
      });
    }
  });

  it("unlocks every volume, photo, streak and organization tier without schedules", async () => {
    const { user, org, team } = await fixture();
    await db.insert(articles).values(Array.from({ length: 250 }, (_, i) => ({
      teamId: team.id, authorId: user.id, title: `Distinct ${i}`, body: "A legitimate separate contribution.",
      gameDate: new Date("2026-09-01"), status: "published" as const,
      photoUrls: i < 25 ? ["https://example.test/photo.jpg"] : null,
    })));
    await db.insert(articles).values(Array.from({ length: 50 }, (_, i) => ({
      teamId: team.id, authorId: user.id, title: `Retro ${i}`, body: "An original previous-season story.",
      gameDate: new Date("2025-03-01"), previousSeason: { season: "2024–25", gamePlayedDate: "2025-03-01", attested: true },
      status: "published" as const,
    })));
    await db.insert(articles).values(Array.from({ length: 30 }, (_, i) => ({
      teamId: team.id, authorId: user.id, title: `Private plan ${i}`, body: "Sensitive drills",
      articleKind: "practice_plan" as const, status: "published" as const,
    })));
    const [second] = await db.insert(teams).values({ name: "Second team", organizationId: org.id }).returning();
    await recap(second.id, user.id);
    await db.execute(sql`DELETE FROM achievement_streaks WHERE team_id=${team.id}::uuid`);
    for (let d = 1; d <= 12; d++) {
      await db.execute(sql`SELECT achievement_advance(${team.id}::uuid,${user.id},${`2026-08-${String(d).padStart(2,"0")}T12:00:00Z`}::timestamptz),
        achievement_advance(${team.id}::uuid,'team',${`2026-08-${String(d).padStart(2,"0")}T12:00:00Z`}::timestamptz)`);
    }
    for (const [subject, id] of [["user", user.id], ["team", team.id], ["organization", org.id]]) {
      await db.execute(sql`SELECT achievement_evaluate(${subject},${id}::uuid)`);
      const awards = await q(sql`SELECT key,max(tier)::int AS tier FROM achievement_awards WHERE subject=${subject} AND subject_id=${id}::uuid GROUP BY key`);
      for (const item of ACHIEVEMENT_CATALOG.filter((c) => c.subject === subject)) {
        expect(awards.find((a) => a.key === item.key)?.tier, item.key).toBe(item.thresholds.length);
      }
    }
  }, 60000);

  it("counts primary authors once, keeps permanent awards and ignores drafts, pending, clippings and minor authors", async () => {
    const { user, team } = await fixture();
    const draft = await recap(team.id, user.id, { status: "draft" });
    await recap(team.id, user.id, { status: "pending_approval" });
    await recap(team.id, user.id, { recapKind: "historical" });
    expect((await q(sql`SELECT * FROM achievement_contributions WHERE team_id=${team.id}::uuid`))).toHaveLength(0);
    await db.update(articles).set({ status: "published" }).where(eq(articles.id, draft.id));
    const { user: publisher } = await loginAs("sam@kinectem.demo");
    await db.update(articles).set({ body: "Edited again", publishedById: publisher.id }).where(eq(articles.id, draft.id));
    expect(await q(sql`SELECT * FROM achievement_contributions WHERE team_id=${team.id}::uuid`)).toHaveLength(1);
    await db.delete(articles).where(eq(articles.id, draft.id));
    const progress = await q(sql`SELECT * FROM achievement_metrics('user',${user.id}::uuid) WHERE metric='current'`);
    expect(progress[0].value).toBe(0);
    expect(await q(sql`SELECT * FROM achievement_awards WHERE subject_id=${user.id}::uuid AND key='first-story'`)).toHaveLength(1);
    const [child] = await db.insert(users).values({ name: "Child", role: "athlete", isMinor: true }).returning();
    await recap(team.id, child.id);
    expect(await q(sql`SELECT * FROM achievement_awards WHERE subject='user' AND subject_id=${child.id}::uuid`)).toHaveLength(0);
    expect((await request(app).get(`/api/v1/achievements/user/${child.id}`)).status).toBe(404);
  });

  it("captures affiliation at eligibility, not team creation or later moves", async () => {
    const { user, org, team } = await fixture();
    const [other] = await db.insert(organizations).values({ name: "Future organization" }).returning();
    await recap(team.id, user.id);
    await db.update(teams).set({ organizationId: other.id }).where(eq(teams.id, team.id));
    const r = await recap(team.id, user.id);
    await db.update(articles).set({ title: "Edited after move" }).where(eq(articles.id, r.id));
    const ledger = await q(sql`SELECT organization_id FROM achievement_contributions WHERE team_id=${team.id}::uuid ORDER BY eligible_at`);
    expect(ledger.map((c) => c.organization_id)).toEqual([org.id, other.id]);
    expect((await q(sql`SELECT value FROM achievement_metrics('organization',${other.id}::uuid) WHERE metric='current'`))[0].value).toBe(1);
  });

  it("deduplicates concurrent publication retries but not legitimate same-text recaps or same-day volume", async () => {
    const { user, team } = await fixture();
    const r = await recap(team.id, user.id, { status: "draft" });
    await Promise.all(Array.from({ length: 6 }, () => db.update(articles).set({ status: "published" }).where(eq(articles.id, r.id))));
    await Promise.all(Array.from({ length: 9 }, () => recap(team.id, user.id)));
    expect((await q(sql`SELECT value FROM achievement_metrics('team',${team.id}::uuid) WHERE metric='current'`))[0].value).toBe(10);
    const streaks = await q(sql`SELECT current_count FROM achievement_streaks WHERE team_id=${team.id}::uuid`);
    expect(streaks.every((s) => s.current_count === 1)).toBe(true);
    expect(await q(sql`SELECT * FROM achievement_awards WHERE subject='team' AND subject_id=${team.id}::uuid AND key='team-storytellers'`)).toHaveLength(1);
  });

  it("uses the exact 30/90-day public participation denominator without transferring past credit", async () => {
    const { agent, user, org, team } = await fixture();
    const otherTeams = await db.insert(teams).values(Array.from({ length: 4 }, (_, i) => ({ name: `Participant ${i}`, organizationId: org.id }))).returning();
    await recap(team.id, user.id);
    const recent = await recap(otherTeams[0].id, user.id, { gameDate: null }); // public team update
    for (const t of otherTeams.slice(1,3)) {
      const old = await recap(t.id, user.id);
      await db.execute(sql`UPDATE achievement_contributions SET eligible_at=now()-interval '60 days' WHERE ref_id=${old.id}::uuid`);
    }
    await recap(otherTeams[3].id, user.id, { articleKind: "practice_plan" }); // never eligible
    expect((await q(sql`SELECT value FROM achievement_metrics('organization',${org.id}::uuid) WHERE metric='participation'`))[0].value).toBe(50);
    const read = await agent.get(`/api/v1/achievements/organization/${org.id}`);
    expect(read.body.participation).toHaveLength(4);
    expect(read.body.participation.filter((t: any) => t.participating)).toHaveLength(2);
    await db.update(teams).set({ archivedAt: new Date() }).where(eq(teams.id, otherTeams[0].id));
    expect((await q(sql`SELECT value FROM achievement_metrics('organization',${org.id}::uuid) WHERE metric='participation'`))[0].value).toBe(0);
    const [future] = await db.insert(organizations).values({ name: "New affiliation" }).returning();
    await db.update(teams).set({ organizationId: future.id, archivedAt: null }).where(eq(teams.id, team.id));
    await db.update(teams).set({ organizationId: future.id, archivedAt: null }).where(eq(teams.id, otherTeams[0].id));
    expect((await q(sql`SELECT value FROM achievement_metrics('organization',${future.id}::uuid) WHERE metric='participation'`))[0].value).toBe(0);
    await db.update(articles).set({ title: "Editing doesn't transfer affiliation" }).where(eq(articles.id, recent.id));
    expect((await q(sql`SELECT value FROM achievement_metrics('organization',${future.id}::uuid) WHERE metric='participation'`))[0].value).toBe(0);
  });

  it("handles UTC day boundaries, ten-day deadlines, best-run preservation and independent team runs", async () => {
    const { user, team } = await fixture();
    await db.execute(sql`SELECT achievement_advance(${team.id}::uuid,${user.id},'2026-01-01T00:00:00Z')`);
    await db.execute(sql`SELECT achievement_advance(${team.id}::uuid,${user.id},'2026-01-01T23:59:59Z')`);
    expect((await q(sql`SELECT current_count FROM achievement_streaks WHERE team_id=${team.id}::uuid`))[0].current_count).toBe(1);
    await db.execute(sql`SELECT achievement_advance(${team.id}::uuid,${user.id},'2026-01-11T23:59:59.999999Z')`);
    expect((await q(sql`SELECT current_count FROM achievement_streaks WHERE team_id=${team.id}::uuid`))[0].current_count).toBe(2);
    await db.execute(sql`SELECT achievement_advance(${team.id}::uuid,${user.id},'2026-01-22T00:00:00Z')`);
    const reset = (await q(sql`SELECT * FROM achievement_streaks WHERE team_id=${team.id}::uuid`))[0];
    expect(reset.current_count).toBe(1); expect(reset.best).toBe(2);
    const [other] = await db.insert(teams).values({ name: "Independent" }).returning();
    await db.execute(sql`SELECT achievement_advance(${other.id}::uuid,${user.id},'2026-01-22T00:00:00Z')`);
    expect((await q(sql`SELECT current_count FROM achievement_streaks WHERE team_id=${other.id}::uuid`))[0].current_count).toBe(1);
  });

  it("pauses only active exact-team runs indefinitely and resumes without crediting nonauthors", async () => {
    const { agent, user, team } = await fixture();
    await recap(team.id, user.id);
    const [writer] = await db.insert(users).values({ name: "Assistant", role: "coach" }).returning();
    await db.insert(rosterEntries).values({ teamId: team.id, userId: writer.id, role: "coach" });
    await recap(team.id, writer.id);
    expect((await agent.post(`/api/v1/achievements/team/${team.id}/pause`).send({ confirmed: true })).status).toBe(200);
    await db.execute(sql`UPDATE achievement_streaks SET last_day='2025-01-01',deadline='2025-01-11' WHERE team_id=${team.id}::uuid`);
    await recap(team.id, writer.id);
    const runs = await q(sql`SELECT * FROM achievement_streaks WHERE team_id=${team.id}::uuid`);
    expect(runs.find((s) => s.contributor_id === user.id)?.current_count).toBe(1);
    expect(runs.find((s) => s.contributor_id === writer.id)?.current_count).toBe(2);
    expect(runs.find((s) => s.contributor_id === "team")?.current_count).toBe(2);
    expect(runs.every((s) => !s.paused && new Date(s.deadline) > new Date())).toBe(true);
    await db.execute(sql`UPDATE achievement_streaks SET deadline=now()-interval '1 second' WHERE team_id=${team.id}::uuid`);
    expect((await agent.post(`/api/v1/achievements/team/${team.id}/pause`).send({ confirmed: true })).status).toBe(409);
    expect((await request(app).post(`/api/v1/achievements/team/${team.id}/pause`).send({ confirmed: true })).status).toBe(401);
  });

  it("counts inline and album images once per recap, excluding videos and private plans", async () => {
    const { user, team } = await fixture();
    const r = await recap(team.id, user.id, { photoUrls: ["https://example.test/p.jpg"] });
    const [asset] = await db.insert(assets).values({ ownerId: user.id, fileName: "image", fileType: "image/png", status: "confirmed" }).returning();
    await db.insert(albumPhotos).values({ postKind: "article", postRefId: r.id, uploaderUserId: user.id, uploaderName: "Coach", assetId: asset.id });
    const videoOnly = await recap(team.id, user.id);
    const [video] = await db.insert(assets).values({ ownerId: user.id, fileName: "clip", fileType: "video/mp4", status: "confirmed" }).returning();
    await db.insert(albumPhotos).values({ postKind: "article", postRefId: videoOnly.id, uploaderUserId: user.id, uploaderName: "Coach", assetId: video.id });
    await recap(team.id, user.id, { articleKind: "practice_plan", photoUrls: ["https://example.test/private.jpg"] });
    const retro = await recap(team.id, user.id, { previousSeason: { season: "2025", gamePlayedDate: "2025-02-01", attested: true } });
    await db.insert(albumPhotos).values({ postKind: "article", postRefId: retro.id, uploaderUserId: user.id, uploaderName: "Coach", assetId: asset.id });
    expect((await q(sql`SELECT value FROM achievement_metrics('team',${team.id}::uuid) WHERE metric='photos'`))[0].value).toBe(2);
  });

  it("enforces achievement privacy on both profile and org listings, with private progress never shared", async () => {
    const { agent, user, org, team } = await fixture();
    await recap(team.id, user.id);
    const url = `/api/v1/achievements/user/${user.id}`;
    expect((await request(app).get(url)).status).toBe(404);
    expect((await agent.get(url)).body.progress["first-story"]).toBe(1);
    expect((await agent.put(url).send({ visibility: "public", featured: ["first-story"] })).status).toBe(200);
    const visible = await request(app).get(url);
    expect(visible.status).toBe(200); expect(visible.body.progress).toBeUndefined(); expect(visible.body.streaks).toBeUndefined();
    expect(visible.body.awards[0].celebrated).toBeUndefined();
    const listing = await request(app).get(`/api/v1/organizations/${org.id}/contributors`);
    expect(listing.body.data.find((p: any) => p.id === user.id).awards).toHaveLength(1);
    expect((await agent.put(url).send({ visibility: "private" })).status).toBe(200);
    expect((await request(app).get(url)).status).toBe(404);
    expect((await request(app).get(`/api/v1/organizations/${org.id}/contributors`)).body.data.find((p: any) => p.id === user.id).awards).toEqual([]);
    expect((await agent.put(url).send({ featured: ["unearned"] })).status).toBe(400);
    await db.update(users).set({ profileVisibility: "private" }).where(eq(users.id, user.id));
    await agent.put(url).send({ visibility: "public" });
    expect((await request(app).get(url)).status).toBe(404);
    expect((await request(app).get(`/api/v1/organizations/${org.id}/contributors`)).body.data).toEqual([]);
  });

  it("preserves dated retro metadata through draft edits and publish; never creates current streak credit", async () => {
    const { agent, user, team } = await fixture();
    const metadata = { season: "Fall 2025", gamePlayedDate: "2025-09-12", attested: false };
    const r = await recap(team.id, user.id, { status: "draft", previousSeason: metadata });
    const url = `/api/v1/posts/article-${r.id}`;
    expect((await agent.patch(url).send({ title: "Untouched metadata" })).body.previousSeason).toEqual(metadata);
    expect((await agent.post(`${url}/publish`).send({})).status).toBe(400);
    expect((await agent.patch(url).send({ previousSeason: { ...metadata, attested: true } })).status).toBe(200);
    expect((await agent.post(`${url}/publish`).send({})).status).toBe(200);
    expect((await q(sql`SELECT value FROM achievement_metrics('user',${user.id}::uuid) WHERE metric='retro'`))[0].value).toBe(1);
    expect(await q(sql`SELECT * FROM achievement_streaks WHERE team_id=${team.id}::uuid`)).toHaveLength(0);
    expect((await agent.patch(url).send({ previousSeason: null })).body.previousSeason).toBeNull();
    expect(previousSeasonError({ ...metadata, attested: true, gamePlayedDate: "2025-02-30" }, true)).toBeTruthy();
    expect(previousSeasonError({ ...metadata, attested: true }, true)).toBeNull();
  });

  it("initializes missing achievement schema and backfill idempotently without unlock floods or historical affiliation", async () => {
    const { user, team } = await fixture();
    await db.execute(sql.raw(`DROP TRIGGER achievement_capture ON articles;
      DROP TRIGGER achievement_capture ON org_posts; DROP TRIGGER achievement_album_capture ON album_photos;
      DROP VIEW achievement_live_contributions CASCADE;
      DROP TABLE achievement_contributions,achievement_awards,achievement_settings,achievement_streaks,achievement_streak_events,achievement_rollout,achievement_pauses CASCADE;`));
    const r = await recap(team.id, user.id, { createdAt: new Date("2025-01-01"), publishedAt: new Date("2025-01-01") });
    await db.execute(sql.raw(ACHIEVEMENT_MIGRATION.sql));
    await db.execute(sql.raw(ACHIEVEMENT_MIGRATION.sql));
    const ledger = await q(sql`SELECT * FROM achievement_contributions WHERE ref_id=${r.id}::uuid`);
    expect(ledger).toHaveLength(1); expect(ledger[0].organization_id).toBeNull();
    expect(await q(sql`SELECT * FROM achievement_streaks`)).toHaveLength(0);
    expect((await q(sql`SELECT * FROM achievement_awards WHERE subject_id=${user.id}::uuid`)).every((a) => a.celebrated)).toBe(true);
  });
});
