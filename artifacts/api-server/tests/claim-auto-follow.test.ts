// Claiming a competition team slot auto-follows the competition, and
// competitions your teams are entered in surface in /posts/follow-suggestions.
import { afterEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  teams,
  tournaments,
  tournamentParticipants,
  competitionFollowers,
} from "@workspace/db";
import { loginAs } from "./helpers";

let n = 0;
function uniq(prefix: string): string {
  n += 1;
  return `${prefix} ClaimFollow ${Date.now()}-${n}`;
}

const createdComps: string[] = [];
const createdTeams: string[] = [];

afterEach(async () => {
  if (createdComps.length) {
    await db
      .delete(tournaments)
      .where(inArray(tournaments.id, createdComps.splice(0)));
  }
  if (createdTeams.length) {
    await db.delete(teams).where(inArray(teams.id, createdTeams.splice(0)));
  }
});

async function makeCompetitionWithSlot(agentOwner: {
  post: (url: string) => any;
}): Promise<{ compId: string; slug: string; participantId: string }> {
  const res = await (agentOwner as any)
    .post("/api/v1/competitions")
    .send({
      name: uniq("Cup"),
      type: "tournament",
      startDate: "2026-09-01",
      endDate: "2026-09-02",
    });
  expect(res.status).toBe(201);
  createdComps.push(res.body.id);
  const [slot] = await db
    .insert(tournamentParticipants)
    .values({
      tournamentId: res.body.id,
      name: uniq("Slot Team"),
      nameKey: uniq("slot team").toLowerCase(),
    })
    .returning();
  return { compId: res.body.id, slug: res.body.slug, participantId: slot.id };
}

describe("claim auto-follow", () => {
  it("solo-team claim follows the competition for the claimer", async () => {
    const owner = await loginAs("coach@kinectem.demo");
    const claimer = await loginAs("marcus@kinectem.demo");
    const { compId, slug, participantId } = await makeCompetitionWithSlot(
      owner.agent,
    );

    const res = await claimer.agent
      .post(`/api/v1/competitions/${slug}/claim`)
      .send({ participantId, teamName: uniq("Solo") });
    expect(res.status).toBe(201);
    createdTeams.push(res.body.teamId);

    const rows = await db
      .select()
      .from(competitionFollowers)
      .where(
        and(
          eq(competitionFollowers.competitionId, compId),
          eq(competitionFollowers.userId, claimer.user.id),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it("claimed competition shows in the claimer's suggestions only until followed", async () => {
    const owner = await loginAs("coach@kinectem.demo");
    const claimer = await loginAs("daniela@kinectem.demo");
    const { compId, slug, participantId } = await makeCompetitionWithSlot(
      owner.agent,
    );

    const res = await claimer.agent
      .post(`/api/v1/competitions/${slug}/claim`)
      .send({ participantId, teamName: uniq("Solo") });
    expect(res.status).toBe(201);
    createdTeams.push(res.body.teamId);

    // The claimer is rostered on the solo team AND already follows the
    // competition (auto-follow), so it must NOT be suggested to them.
    const sugg = await claimer.agent.get("/api/v1/follow-suggestions");
    expect(sugg.status).toBe(200);
    const ids = (sugg.body.competitions ?? []).map((c: any) => c.id);
    expect(ids).not.toContain(compId);

    // If they unfollow, the competition (their team is entered) is suggested.
    await db
      .delete(competitionFollowers)
      .where(
        and(
          eq(competitionFollowers.competitionId, compId),
          eq(competitionFollowers.userId, claimer.user.id),
        ),
      );
    const sugg2 = await claimer.agent.get("/api/v1/follow-suggestions");
    expect(sugg2.status).toBe(200);
    const ids2 = (sugg2.body.competitions ?? []).map((c: any) => c.id);
    expect(ids2).toContain(compId);
  });
});
