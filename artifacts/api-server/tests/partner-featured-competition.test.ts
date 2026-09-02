import { afterAll, describe, expect, it } from "vitest";
import {
  db,
  partnerLandingPages,
  tournaments,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { loginAs, request, app } from "./helpers";

const ADMIN_EMAIL = "andrew@kinectem.com";
const createdPageIds: string[] = [];
const createdCompetitionIds: string[] = [];

afterAll(async () => {
  if (createdPageIds.length) {
    await db
      .delete(partnerLandingPages)
      .where(inArray(partnerLandingPages.id, createdPageIds));
  }
  if (createdCompetitionIds.length) {
    await db
      .delete(tournaments)
      .where(inArray(tournaments.id, createdCompetitionIds));
  }
});

describe("partner featured competition", () => {
  it("supports attach, idempotent replace, remove, create-and-link, and public metadata", async () => {
    const { agent } = await loginAs((user) => user.email === ADMIN_EMAIL);
    const suffix = Date.now().toString(36);
    const pageCreate = await agent.post("/api/v1/admin/partner-pages").send({
      officialName: `Competition Partner ${suffix}`,
      associationLabel: "League",
      slug: `competition-partner-${suffix}`,
    });
    expect(pageCreate.status, JSON.stringify(pageCreate.body)).toBe(201);
    const pageId = pageCreate.body.data.id as string;
    createdPageIds.push(pageId);

    const firstCreate = await agent.post("/api/v1/competitions").send({
      name: `Existing Cup ${suffix}`,
      type: "tournament",
      startDate: "2026-10-03",
      endDate: "2026-10-04",
      location: "Riverside",
    });
    expect(firstCreate.status, JSON.stringify(firstCreate.body)).toBe(201);
    createdCompetitionIds.push(firstCreate.body.id);

    const anonymousAttach = await request(app)
      .put(`/api/v1/admin/partner-pages/${pageId}/competition`)
      .send({ competitionId: firstCreate.body.id });
    expect(anonymousAttach.status).toBe(401);

    for (let attempt = 0; attempt < 2; attempt++) {
      const attach = await agent
        .put(`/api/v1/admin/partner-pages/${pageId}/competition`)
        .send({ competitionId: firstCreate.body.id });
      expect(attach.status).toBe(200);
      expect(attach.body.competition).toMatchObject({
        id: firstCreate.body.id,
        name: `Existing Cup ${suffix}`,
      });
    }

    const publish = await agent
      .patch(`/api/v1/admin/partner-pages/${pageId}`)
      .send({ published: true });
    expect(publish.status).toBe(200);
    const publicPage = await request(app).get(
      `/api/v1/partner-pages/competition-partner-${suffix}`,
    );
    expect(publicPage.status).toBe(200);
    expect(publicPage.body.data.competition).toEqual({
      id: firstCreate.body.id,
      slug: firstCreate.body.slug,
      name: `Existing Cup ${suffix}`,
      type: "tournament",
      startDate: "2026-10-03",
      endDate: "2026-10-04",
      location: "Riverside",
    });

    const remove = await agent.delete(
      `/api/v1/admin/partner-pages/${pageId}/competition`,
    );
    expect(remove.status).toBe(200);
    const publicWithoutCompetition = await request(app).get(
      `/api/v1/partner-pages/competition-partner-${suffix}`,
    );
    expect(publicWithoutCompetition.body.data.competition).toBeNull();

    const invalidCreate = await agent
      .post(`/api/v1/admin/partner-pages/${pageId}/competition`)
      .send({
        name: "Invalid dates",
        type: "league",
        startDate: "2026-11-10",
        endDate: "2026-11-01",
      });
    expect(invalidCreate.status).toBe(400);

    const linkedCreate = await agent
      .post(`/api/v1/admin/partner-pages/${pageId}/competition`)
      .send({
        name: `Partner League ${suffix}`,
        type: "league",
        startDate: "2026-11-01",
        endDate: "2027-02-01",
        location: "Metro Fields",
      });
    expect(linkedCreate.status, JSON.stringify(linkedCreate.body)).toBe(201);
    createdCompetitionIds.push(linkedCreate.body.competition.id);
    expect(linkedCreate.body.consolePath).toBe(
      `/competitions/${linkedCreate.body.competition.id}`,
    );

    const [storedPage] = await db
      .select()
      .from(partnerLandingPages)
      .where(eq(partnerLandingPages.id, pageId))
      .limit(1);
    expect(storedPage.competitionId).toBe(linkedCreate.body.competition.id);

    await db
      .delete(tournaments)
      .where(eq(tournaments.id, linkedCreate.body.competition.id));
    const [afterDelete] = await db
      .select()
      .from(partnerLandingPages)
      .where(eq(partnerLandingPages.id, pageId))
      .limit(1);
    expect(afterDelete.competitionId).toBeNull();
  });
});