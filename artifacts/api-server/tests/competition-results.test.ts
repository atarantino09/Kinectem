import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, tournaments, competitionBrackets, tournamentParticipants, teams, articles, users, competitionRecapPlacements, competitionTournamentRecaps, takedownRequests, competitionAdmins } from "@workspace/db";
import { app, loginAs, request } from "./helpers";
const ai = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("../src/lib/ai", async importOriginal => ({ ...await importOriginal<typeof import("../src/lib/ai")>(), generateTournamentRecapText: ai.generate }));
import { AiNotConfiguredError } from "../src/lib/ai";
import { renderTournamentDraft } from "../src/lib/tournament-recap-drafting";

const csv = "Bracket,Gender,Age,Home Team,Away Team,Home Score,Away Score,Date,Group\nGold,Boys,U12,Rovers,United,2,1,2026-10-01,Final";
async function fixture() {
  const owner = await loginAs("coach@kinectem.demo"), stranger = await loginAs("daniela@kinectem.demo");
  const [competition] = await db.insert(tournaments).values({ name: "Results Cup", slug: `results-${randomUUID()}`, startDate: "2026-10-01", endDate: "2026-10-03", ownerUserId: owner.user.id, createdById: owner.user.id, brandColor: "#123456" }).returning();
  const [bracket] = await db.insert(competitionBrackets).values({ tournamentId: competition.id, label: "Gold", labelKey: "gold", gender: "Boys" }).returning();
  const [team] = await db.insert(teams).values({ name: "Rovers", createdById: owner.user.id }).returning();
  const [slot] = await db.insert(tournamentParticipants).values({ tournamentId: competition.id, name: "Rovers", nameKey: "rovers", gender: "Boys", age: "U12", bracketId: bracket.id, teamId: team.id }).returning();
  const [girls] = await db.insert(tournamentParticipants).values({ tournamentId: competition.id, name: "Rovers", nameKey: "rovers", gender: "Girls", age: "U12" }).returning();
  const root = `/api/v1/competitions/${competition.id}`;
  const imported = await owner.agent.post(`${root}/results-import`).send({ kind: "csv", text: csv, clientId: randomUUID() });
  expect(imported.status).toBe(200);
  const group = { ...imported.body.groups[0], bracketId: bracket.id };
  group.games[0].homeParticipantId = slot.id;
  return { owner, stranger, competition, bracket, team, slot, girls, root, imported: imported.body, group };
}
async function confirmed(f: Awaited<ReturnType<typeof fixture>>) {
  const result = await f.owner.agent.patch(`${f.root}/results-import/${f.imported.id}`).send({ groups: [f.group], resultsAsOf: "2026-10-03T12:00:00.000Z", confirmed: true });
  expect(result.status).toBe(200);
  return result.body;
}
async function manual(f: Awaited<ReturnType<typeof fixture>>) {
  await confirmed(f);
  const result = await f.owner.agent.post(`${f.root}/tournament-recaps`).send({ importId: f.imported.id, groupKey: f.group.key, title: "Gold roundup", body: "Rovers won 2–1. Partial results." });
  expect(result.status).toBe(201);
  return result.body;
}
async function published(f: Awaited<ReturnType<typeof fixture>>) {
  const recap = await manual(f);
  const result = await f.owner.agent.post(`${f.root}/tournament-recaps/${recap.id}/publish`).send({ expectedRevision: recap.revision });
  expect(result.status).toBe(200);
  return result.body;
}
beforeEach(() => { ai.generate.mockReset().mockResolvedValue("Reviewed partial results: Rovers defeated United, 2–1."); });

describe("competition-owned results drafts, publications and placements", () => {
  it("prepares incomplete results automatically and idempotently without confirming matches", async () => {
    const f = await fixture();
    const csvMissing = "Bracket,Gender,Age,Home Team,Away Team,Home Score,Away Score\nGold,Boys,U12,Rovers,United,,\nGold,Girls,U12,Rovers,United,1,\nSilver,Boys,U13,Unknown A,Unknown B,,";
    const imported = await f.owner.agent.post(`${f.root}/results-import`).send({ kind: "csv", text: csvMissing, clientId: randomUUID() });
    const path = `${f.root}/results-import/${imported.body.id}/prepare`;
    const responses = await Promise.all([f.owner.agent.post(path).send({}), f.owner.agent.post(path).send({})]);
    for (const prepared of responses) {
      expect(prepared.status).toBe(200);
      expect(prepared.body.confirmed).toBe(true);
      expect(prepared.body.groups).toHaveLength(3);
      expect(new Set(prepared.body.groups.map((g: any) => g.bracketId)).size).toBe(3);
      expect(prepared.body.groups[0].games[0].homeParticipantId).toBe(f.slot.id);
      expect(prepared.body.groups[1].games[0].homeParticipantId).toBe(f.girls.id);
      expect(prepared.body.groups[2].games[0].homeParticipantId).toBeNull();
      expect(prepared.body.groups[0].games[0].homeScore).toBeNull();
      expect(prepared.body.groups.every((g: any) => !g.complete)).toBe(true);
    }
    const next = await f.owner.agent.post(`${f.root}/results-import`).send({ kind: "csv", text: csvMissing.replaceAll("Gold", "GOLD"), clientId: randomUUID() });
    const repeated = await f.owner.agent.post(`${f.root}/results-import/${next.body.id}/prepare`).send({});
    expect(repeated.body.groups.map((g: any) => g.bracketId)).toEqual(responses[0].body.groups.map((g: any) => g.bracketId));
    expect((await request(app).get(`${f.root}/tournament-recaps`)).body.data).toEqual([]);
  });
  it("generates a whole partial source with no score entry, keeps successes, and retries only missing drafts", async () => {
    const f = await fixture();
    const imported = await f.owner.agent.post(`${f.root}/results-import`).send({
      kind: "paste", clientId: randomUUID(),
      text: "Results Cup\nGold Boys U12\nHome Team\tAway Team\tScore\nRovers\tUnited\t\n\nSilver Boys U12\nHome Team\tAway Team\tScore\nOther A\tOther B\t",
    });
    const prepared = await f.owner.agent.post(`${f.root}/results-import/${imported.body.id}/prepare`).send({});
    expect(prepared.status).toBe(200);
    const render = (input: any) => renderTournamentDraft(input.group, {
      gameIds: input.group.games.map((g: any) => g.id), standingTeams: input.group.standings.map((s: any) => s.team), style: "results_roundup",
    });
    ai.generate.mockImplementation(async (input: any) => {
      if (input.group.label.startsWith("Silver")) throw new Error("Provider temporarily unavailable");
      return render(input);
    });
    const payload = { importId: imported.body.id, groupKeys: prepared.body.groups.map((g: any) => g.key),
      includeCoverage: false, requestId: randomUUID(), expectedRevisions: {}, preserveExisting: true };
    const first = await f.owner.agent.post(`${f.root}/tournament-recaps/generate`).send(payload);
    expect(first.status).toBe(200);
    expect(first.body.data).toHaveLength(1);
    expect(first.body.errors).toHaveLength(1);
    expect(first.body.data[0].draft.body).toContain("complete score was not available");
    expect(first.body.data[0].draft.body).not.toContain("0–0");
    expect(first.body.data[0].published).toBeNull();
    ai.generate.mockImplementation(async (input: any) => render(input));
    const retry = await f.owner.agent.post(`${f.root}/tournament-recaps/generate`).send(payload);
    expect(retry.body.errors).toEqual([]);
    expect(retry.body.data).toHaveLength(2);
    expect(ai.generate).toHaveBeenCalledTimes(3);
    expect(retry.body.data.find((r: any) => r.id === first.body.data[0].id).revision).toBe(first.body.data[0].revision);
    expect((await request(app).get(`${f.root}/tournament-recaps`)).body.data).toEqual([]);
    const publish = await f.owner.agent.post(`${f.root}/tournament-recaps/publish-batch`).send({
      recaps: retry.body.data.map((r: any) => ({ id: r.id, expectedRevision: r.revision })),
    });
    expect(publish.body.errors).toEqual([]);
    expect(publish.body.data).toHaveLength(2);
    expect((await request(app).get(`${f.root}/tournament-recaps`)).body.data).toHaveLength(2);
  });
  it("preserves existing live and edited recaps and batch publishing is revision-safe and retry-safe", async () => {
    const f = await fixture(), recap = await published(f);
    const edited = await f.owner.agent.patch(`${f.root}/tournament-recaps/${recap.id}`).send({ title: "Edited title", body: "Preserve this edit", expectedRevision: recap.revision });
    const kept = await f.owner.agent.post(`${f.root}/tournament-recaps/generate`).send({
      importId: f.imported.id, groupKeys: [f.group.key], includeCoverage: false, requestId: randomUUID(),
      expectedRevisions: {}, preserveExisting: true,
    });
    expect(kept.body.data[0].draft.body).toBe("Preserve this edit");
    expect(kept.body.data[0].published.body).toBe(recap.published.body);
    expect(ai.generate).not.toHaveBeenCalled();
    const stale = await f.owner.agent.post(`${f.root}/tournament-recaps/publish-batch`).send({
      recaps: [{ id: recap.id, expectedRevision: recap.revision }, { id: randomUUID(), expectedRevision: 0 }],
    });
    expect(stale.body.errors.map((e: any) => e.code)).toEqual(["RECAP_STALE", "NOT_FOUND"]);
    expect((await request(app).get(`/api/v1/competition-stories/${recap.id}`)).body.body).toBe(recap.published.body);
    const payload = { recaps: [{ id: recap.id, expectedRevision: edited.body.revision }] };
    const first = await f.owner.agent.post(`${f.root}/tournament-recaps/publish-batch`).send(payload);
    const retry = await f.owner.agent.post(`${f.root}/tournament-recaps/publish-batch`).send(payload);
    expect(first.body.errors).toEqual([]);
    expect(retry.body.errors).toEqual([]);
    expect(retry.body.data[0].revision).toBe(first.body.data[0].revision);
  });
  it("authorizes all organizer writes and keeps draft/import data private", async () => {
    const f = await fixture(), recap = await manual(f);
    const paths = [
      ["post", `${f.root}/results-import`], ["patch", `${f.root}/results-import/${f.imported.id}`],
      ["post", `${f.root}/results-import/${f.imported.id}/prepare`], ["post", `${f.root}/tournament-recaps/publish-batch`],
      ["post", `${f.root}/tournament-recaps`], ["post", `${f.root}/tournament-recaps/generate`],
      ["patch", `${f.root}/tournament-recaps/${recap.id}`], ["post", `${f.root}/tournament-recaps/${recap.id}/publish`],
      ["post", `${f.root}/tournament-recaps/${recap.id}/unpublish`], ["delete", `${f.root}/tournament-recaps/${recap.id}`],
    ] as const;
    for (const [method, path] of paths) {
      expect((await request(app)[method](path).send({})).status).toBe(401);
      expect((await f.stranger.agent[method](path).send({})).status).toBe(403);
    }
    expect((await f.stranger.agent.get(`${f.root}/results-workspace`)).status).toBe(403);
    expect((await request(app).get(`/api/v1/competition-stories/${recap.id}`)).status).toBe(404);
    expect((await request(app).get(`${f.root}/tournament-recaps`)).body.data).toEqual([]);
    expect(ai.generate).not.toHaveBeenCalled();
  });
  it("imports idempotently without changing the schedule or creating fake articles", async () => {
    const f = await fixture();
    const retry = await f.owner.agent.post(`${f.root}/results-import`).send({ kind: "csv", text: csv, clientId: f.imported.clientId });
    expect(retry.body.id).toBe(f.imported.id);
    const ws = await f.owner.agent.get(`${f.root}/results-workspace`);
    expect(ws.body.imports).toHaveLength(1);
    expect(ws.body.participants.filter((x: {name: string}) => x.name === "Rovers")).toHaveLength(2);
    const blocked = await f.owner.agent.post(`${f.root}/results-import`).send({ kind: "url", url: "http://127.0.0.1", clientId: randomUUID() });
    expect(blocked.status).toBe(400);
    const unsupported = await f.owner.agent.post(`${f.root}/results-import`).send({ kind: "paste", text: "Name,Notes\nRovers,No scores", clientId: randomUUID() });
    expect(unsupported.body.status).toBe("unsupported");
    expect((await f.owner.agent.patch(`${f.root}/results-import/${unsupported.body.id}`).send({ groups: [f.group], resultsAsOf: "2026-10-01T00:00:00.000Z", confirmed: true })).status).toBe(400);
  });
  it("requires reviewed mappings, rejects foreign identities, and preserves immutable confirmed provenance", async () => {
    const f = await fixture();
    const before = await f.owner.agent.post(`${f.root}/tournament-recaps`).send({ importId: f.imported.id, groupKey: f.group.key, title: "T", body: "B" });
    expect(before.status).toBe(400);
    const wrong = structuredClone(f.group);
    wrong.games[0].homeParticipantId = randomUUID();
    const payload = { groups: [wrong], resultsAsOf: "2026-10-03T12:00:00.000Z", confirmed: true };
    expect((await f.owner.agent.patch(`${f.root}/results-import/${f.imported.id}`).send(payload)).status).toBe(400);
    const reviewed = await confirmed(f);
    expect(reviewed.groups[0].games[0].homeParticipantId).toBe(f.slot.id);
    expect(reviewed.groups[0].games[0].homeParticipantId).not.toBe(f.girls.id);
    expect((await f.owner.agent.patch(`${f.root}/results-import/${f.imported.id}`).send({ ...payload, groups: [f.group] })).status).toBe(409);
  });
  it("rejects completion with missing scores and duplicate mappings to the same bracket", async () => {
    const f = await fixture();
    const group = structuredClone(f.group);
    group.complete = true; group.games[0].homeScore = null;
    const path = `${f.root}/results-import/${f.imported.id}`;
    expect((await f.owner.agent.patch(path).send({ groups: [group], confirmed: true, resultsAsOf: "2026-10-01T00:00:00.000Z" })).status).toBe(400);
    expect((await f.owner.agent.patch(path).send({ groups: [f.group, {...f.group, key: "different"}], confirmed: true, resultsAsOf: "2026-10-01T00:00:00.000Z" })).status).toBe(400);
  });
  it("keeps draft edits separate from live content and publishes explicit updates to all placements", async () => {
    const f = await fixture(), recap = await published(f);
    const place = `/api/v1/competition-stories/${recap.id}/placements/${f.team.id}`;
    expect((await f.owner.agent.put(place).send({})).status).toBe(200);
    const edit = await f.owner.agent.patch(`${f.root}/tournament-recaps/${recap.id}`).send({ title: "Updated title", body: "Reviewed new draft", expectedRevision: recap.revision });
    expect(edit.status).toBe(200);
    const live = await request(app).get(`/api/v1/competition-stories/${recap.id}`);
    expect(live.body.title).toBe("Gold roundup");
    expect(live.body).not.toHaveProperty("draft");
    expect(live.body.sourceUrl).toBeNull();
    expect(live.body.resultsAsOf).toBe("2026-10-03T12:00:00.000Z");
    expect(live.body.partial).toBe(true);
    expect((await f.owner.agent.patch(`${f.root}/tournament-recaps/${recap.id}`).send({ title: "stale", body: "stale", expectedRevision: recap.revision })).status).toBe(409);
    const update = await f.owner.agent.post(`${f.root}/tournament-recaps/${recap.id}/publish`).send({ expectedRevision: edit.body.revision });
    expect(update.status).toBe(200);
    expect((await request(app).get(`/api/v1/teams/${f.team.id}/tournament-recaps`)).body.data[0].title).toBe("Updated title");
    expect((await f.owner.agent.post(`${f.root}/tournament-recaps`).send({importId: f.imported.id, groupKey: f.group.key, title: "duplicate", body: "duplicate"})).status).toBe(409);
  });
  it("limits team placement to managed explicitly linked teams, is idempotent, and removal cannot delete the story", async () => {
    const f = await fixture(), recap = await published(f);
    const path = `/api/v1/competition-stories/${recap.id}/placements/${f.team.id}`;
    expect((await f.stranger.agent.put(path).send({})).status).toBe(403);
    expect((await request(app).put(path).send({})).status).toBe(401);
    expect((await f.stranger.agent.get(`/api/v1/competition-stories/${recap.id}/placement-options`)).body.data).toEqual([]);
    const [unlinked] = await db.insert(teams).values({ name: "Unlinked", createdById: f.owner.user.id }).returning();
    expect((await f.owner.agent.put(`/api/v1/competition-stories/${recap.id}/placements/${unlinked.id}`).send({})).status).toBe(403);
    await f.owner.agent.put(path).send({}); await f.owner.agent.put(path).send({});
    const placed = await db.select().from(competitionRecapPlacements).where(eq(competitionRecapPlacements.recapId, recap.id));
    expect(placed).toHaveLength(1);
    expect((await f.owner.agent.get(`/api/v1/competition-stories/${recap.id}/placement-options`)).body.data).toEqual([{teamId: f.team.id, teamName: "Rovers", placed: true}]);
    await f.owner.agent.delete(path); await f.owner.agent.delete(path);
    expect((await request(app).get(`/api/v1/competition-stories/${recap.id}`)).status).toBe(200);
    expect((await request(app).get(`/api/v1/teams/${f.team.id}/tournament-recaps`)).body.data).toEqual([]);
  });
  it("unpublishes atomically, drops placements, and republishing does not silently opt teams back in", async () => {
    const f = await fixture(), recap = await published(f);
    await f.owner.agent.put(`/api/v1/competition-stories/${recap.id}/placements/${f.team.id}`).send({});
    const removed = await f.owner.agent.post(`${f.root}/tournament-recaps/${recap.id}/unpublish`).send({ expectedRevision: recap.revision });
    expect(removed.status).toBe(200);
    expect((await request(app).get(`/api/v1/competition-stories/${recap.id}`)).status).toBe(404);
    expect((await request(app).get(`/api/v1/teams/${f.team.id}/tournament-recaps`)).body.data).toEqual([]);
    await f.owner.agent.post(`${f.root}/tournament-recaps/${recap.id}/publish`).send({ expectedRevision: removed.body.revision });
    expect((await request(app).get(`/api/v1/teams/${f.team.id}/tournament-recaps`)).body.data).toEqual([]);
  });
  it("team deletion cannot delete a canonical story, competition deletion cleans it up but preserves team-authored game recaps", async () => {
    const f = await fixture(), recap = await published(f);
    await f.owner.agent.put(`/api/v1/competition-stories/${recap.id}/placements/${f.team.id}`).send({});
    const [other] = await db.insert(teams).values({name: "Other", createdById: f.owner.user.id}).returning();
    const [article] = await db.insert(articles).values({teamId: other.id, authorId: f.owner.user.id, title: "Original game recap", body: "Game coverage", competitionId: f.competition.id, bracketId: f.bracket.id}).returning();
    await db.delete(teams).where(eq(teams.id, f.team.id));
    expect((await request(app).get(`/api/v1/competition-stories/${recap.id}`)).status).toBe(200);
    expect(await db.select().from(competitionRecapPlacements).where(eq(competitionRecapPlacements.recapId, recap.id))).toHaveLength(0);
    const bracketDelete = await f.owner.agent.delete(`${f.root}/brackets/${f.bracket.id}`);
    expect(bracketDelete.status).toBe(409);
    await db.delete(tournaments).where(eq(tournaments.id, f.competition.id));
    expect(await db.select().from(competitionTournamentRecaps).where(eq(competitionTournamentRecaps.id, recap.id))).toHaveLength(0);
    const [survives] = await db.select().from(articles).where(eq(articles.id, article.id));
    expect(survives.title).toBe("Original game recap");
    expect(survives.competitionId).toBeNull();
  });
  it("re-fetches eligible public coverage regardless of featured state and excludes practice plans, pending, hidden, private and takedown content", async () => {
    const f = await fixture(), recap = await published(f);
    const values = { teamId: f.team.id, authorId: f.owner.user.id, title: "Team game recap", body: "Public account", competitionId: f.competition.id, bracketId: f.bracket.id };
    const [valid] = await db.insert(articles).values({...values, summary: "Team-written game account", featured: false}).returning();
    await db.insert(articles).values([
      {...values, title: "practice secret", articleKind: "practice_plan", featured: true},
      {...values, title: "pending secret", status: "pending_approval"},
      {...values, title: "draft secret", status: "draft"},
      {...values, title: "hidden secret", hiddenAt: new Date()},
      {...values, title: "private secret", authorId: f.stranger.user.id},
      {...values, title: "combined recap", recapKind: "combined"},
    ]);
    await db.update(users).set({profileVisibility: "private"}).where(eq(users.id, f.stranger.user.id));
    const [taken] = await db.insert(articles).values({...values, title: "takedown secret"}).returning();
    await db.insert(takedownRequests).values({ postKind: "article", postRefId: taken.id, childUserId: f.stranger.user.id, requestedByGuardianId: f.owner.user.id, status: "pending", reason: "Fixture" });
    const [loose] = await db.insert(articles).values({...values, title: "Unattributed", bracketId: null}).returning();
    const publicResult = await request(app).get(`${f.root}/tournament-recaps`);
    expect(publicResult.body.data[0].coverage.map((c: {id: string}) => c.id)).toEqual([`article-${valid.id}`]);
    expect(publicResult.body.unattributedCoverage.map((c: {id: string}) => c.id)).toEqual([`article-${loose.id}`]);
    // Existing curation remains separate, but cannot override privacy.
    const publicPage = await request(app).get(`/api/v1/competitions/${f.competition.slug}`);
    expect(publicPage.status).toBe(200);
    expect(publicPage.body.featuredRecaps).toEqual([]);
    const gen = await f.owner.agent.post(`${f.root}/tournament-recaps/generate`).send({importId: f.imported.id, groupKeys: [f.group.key], includeCoverage: true, requestId: randomUUID(), expectedRevisions: {[f.bracket.id]: recap.revision}});
    expect(gen.status).toBe(200);
    expect(ai.generate.mock.calls[0][0].coverage).toEqual([{title: "Team game recap", teamName: "Rovers", summary: "Team-written game account"}]);
    await db.update(articles).set({hiddenAt: new Date()}).where(eq(articles.id, valid.id));
    expect((await request(app).get(`/api/v1/competition-stories/${recap.id}`)).body.coverage).toEqual([]);
  });
  it("generation is draft-only, retry-safe and cannot clobber edits or a live publication", async () => {
    const f = await fixture(), recap = await published(f);
    const payload = {importId: f.imported.id, groupKeys: [f.group.key], includeCoverage: false, requestId: randomUUID(), expectedRevisions: {[f.bracket.id]: recap.revision}};
    const first = await f.owner.agent.post(`${f.root}/tournament-recaps/generate`).send(payload);
    expect(first.body.errors).toEqual([]);
    expect(first.body.data[0].draft.body).toContain("Reviewed");
    expect((await request(app).get(`/api/v1/competition-stories/${recap.id}`)).body.body).toBe("Rovers won 2–1. Partial results.");
    const retry = await f.owner.agent.post(`${f.root}/tournament-recaps/generate`).send(payload);
    expect(retry.body.data[0].id).toBe(first.body.data[0].id);
    expect(ai.generate).toHaveBeenCalledTimes(1);
    const stale = await f.owner.agent.post(`${f.root}/tournament-recaps/generate`).send({...payload, requestId: randomUUID()});
    expect(stale.body.errors[0].code).toBe("RECAP_STALE");
    expect(ai.generate).toHaveBeenCalledTimes(1);
  });
  it("saves successful brackets in a partial run and rejects a concurrent edit made during provider generation", async () => {
    const f = await fixture();
    const recap = await manual(f);
    const payload = {importId: f.imported.id, groupKeys: [f.group.key, "missing-group"], includeCoverage: false, requestId: randomUUID(), expectedRevisions: {[f.bracket.id]: recap.revision}};
    const partial = await f.owner.agent.post(`${f.root}/tournament-recaps/generate`).send(payload);
    expect(partial.body.data).toHaveLength(1);
    expect(partial.body.errors).toHaveLength(1);
    expect(partial.body.errors[0].groupKey).toBe("missing-group");
    const revision = partial.body.data[0].revision;
    ai.generate.mockImplementationOnce(async () => {
      await db.update(competitionTournamentRecaps).set({
        draft: {...recap.draft, body: "Concurrent operator's preserved edit"}, revision: revision + 1,
      }).where(eq(competitionTournamentRecaps.id, recap.id));
      return "A newly generated draft that must not overwrite the concurrent edit.";
    });
    const race = await f.owner.agent.post(`${f.root}/tournament-recaps/generate`).send({
      ...payload, requestId: randomUUID(), groupKeys: [f.group.key], expectedRevisions: {[f.bracket.id]: revision},
    });
    expect(race.body.data).toEqual([]);
    expect(race.body.errors[0].code).toBe("RECAP_STALE");
    const [saved] = await db.select().from(competitionTournamentRecaps).where(eq(competitionTournamentRecaps.id, recap.id));
    expect(saved.draft.body).toBe("Concurrent operator's preserved edit");
  });
  it("handles missing/failing provider and partial generation without losing existing drafts, and blocks minors even when operator-authorized", async () => {
    const f = await fixture(), recap = await manual(f);
    const payload = {importId: f.imported.id, groupKeys: [f.group.key], includeCoverage: false, requestId: randomUUID(), expectedRevisions: {[f.bracket.id]: recap.revision}};
    ai.generate.mockRejectedValueOnce(new AiNotConfiguredError());
    const missing = await f.owner.agent.post(`${f.root}/tournament-recaps/generate`).send(payload);
    expect(missing.body.errors[0].code).toBe("AI_NOT_CONFIGURED");
    ai.generate.mockRejectedValueOnce(new Error("provider failed"));
    const failure = await f.owner.agent.post(`${f.root}/tournament-recaps/generate`).send({...payload, requestId: randomUUID()});
    expect(failure.body.errors[0].code).toBe("AI_REQUEST_FAILED");
    const [saved] = await db.select().from(competitionTournamentRecaps).where(eq(competitionTournamentRecaps.id, recap.id));
    expect(saved.draft.body).toBe(recap.draft.body);
    await db.insert(competitionAdmins).values({ competitionId: f.competition.id, userId: f.stranger.user.id });
    await db.update(users).set({isMinor: true}).where(eq(users.id, f.stranger.user.id));
    expect((await f.stranger.agent.post(`${f.root}/tournament-recaps/generate`).send(payload)).status).toBe(403);
    expect(ai.generate).toHaveBeenCalledTimes(2);
  });
});
