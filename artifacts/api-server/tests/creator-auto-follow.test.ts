// Creating a hub or a competition auto-follows the creator, so their own
// events show up in their feed/sidebar without a manual follow step.
import { afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  db,
  tournaments,
  competitionOrganizers,
  organizerFollowers,
  competitionFollowers,
} from "@workspace/db";
import { loginAs } from "./helpers";

let n = 0;
function uniq(prefix: string): string {
  n += 1;
  return `${prefix} AutoFollow ${Date.now()}-${n}`;
}

const createdHubs: string[] = [];
const createdComps: string[] = [];

afterEach(async () => {
  for (const id of createdComps.splice(0)) {
    await db.delete(tournaments).where(eq(tournaments.id, id));
  }
  for (const id of createdHubs.splice(0)) {
    await db
      .delete(competitionOrganizers)
      .where(eq(competitionOrganizers.id, id));
  }
});

describe("creator auto-follow", () => {
  it("creating a hub follows it for the creator", async () => {
    const { agent, user } = await loginAs("coach@kinectem.demo");
    const res = await agent
      .post("/api/v1/organizers")
      .send({ name: uniq("Hub") });
    expect(res.status).toBe(201);
    createdHubs.push(res.body.id);

    const rows = await db
      .select()
      .from(organizerFollowers)
      .where(
        and(
          eq(organizerFollowers.organizerId, res.body.id),
          eq(organizerFollowers.userId, user.id),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it("creating a competition follows it for the creator", async () => {
    const { agent, user } = await loginAs("daniela@kinectem.demo");
    const res = await agent.post("/api/v1/competitions").send({
      name: uniq("Comp"),
      type: "tournament",
      startDate: "2026-08-10",
      endDate: "2026-08-12",
    });
    expect(res.status).toBe(201);
    createdComps.push(res.body.id);

    const rows = await db
      .select()
      .from(competitionFollowers)
      .where(
        and(
          eq(competitionFollowers.competitionId, res.body.id),
          eq(competitionFollowers.userId, user.id),
        ),
      );
    expect(rows).toHaveLength(1);
  });
});
