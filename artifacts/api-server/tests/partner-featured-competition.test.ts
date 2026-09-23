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

    const secondCreate = await agent.post("/api/v1/competitions").send({
      name: `Second Cup ${suffix}`,
      type: "league",
      startDate: "2026-11-01",
      endDate: "2026-11-30",
      location: "North Fields",
    });
    expect(secondCreate.status, JSON.stringify(secondCreate.body)).toBe(201);
    createdCompetitionIds.push(secondCreate.body.id);
    const secondAttach = await agent
      .put(`/api/v1/admin/partner-pages/${pageId}/competition`)
      .send({ competitionId: secondCreate.body.id });
    expect(secondAttach.status).toBe(200);
    expect(secondAttach.body.competitions.map((item: { id: string }) => item.id)).toEqual([
      firstCreate.body.id,
      secondCreate.body.id,
    ]);
    const anonymousCompetitionPartners = await request(app).get(
      `/api/v1/admin/competitions/${firstCreate.body.id}/partner-pages`,
    );
    expect(anonymousCompetitionPartners.status).toBe(401);
    const { agent: nonAdmin } = await loginAs(
      (user) => user.role === "coach",
    );
    const forbiddenCompetitionPartners = await nonAdmin.get(
      `/api/v1/admin/competitions/${firstCreate.body.id}/partner-pages`,
    );
    expect(forbiddenCompetitionPartners.status).toBe(403);
    const competitionPartners = await agent.get(
      `/api/v1/admin/competitions/${firstCreate.body.id}/partner-pages`,
    );
    expect(competitionPartners.status).toBe(200);
    expect(
      competitionPartners.body.data.find(
        (page: { id: string }) => page.id === pageId,
      ),
    ).toMatchObject({
      id: pageId,
      published: false,
      linked: true,
    });
    const inverseDisconnect = await agent.delete(
      `/api/v1/admin/competitions/${firstCreate.body.id}/partner-pages/${pageId}`,
    );
    expect(inverseDisconnect.status).toBe(200);
    expect(inverseDisconnect.body.data).toEqual({ id: pageId, linked: false });
    const [afterInverseDisconnect] = await db
      .select()
      .from(partnerLandingPages)
      .where(eq(partnerLandingPages.id, pageId))
      .limit(1);
    expect(afterInverseDisconnect.competitionId).toBe(secondCreate.body.id);
    expect(afterInverseDisconnect.competitionIds).toEqual([secondCreate.body.id]);
    const inverseReconnect = await agent.put(
      `/api/v1/admin/competitions/${firstCreate.body.id}/partner-pages/${pageId}`,
    );
    expect(inverseReconnect.status).toBe(200);
    const [afterInverseReconnect] = await db
      .select()
      .from(partnerLandingPages)
      .where(eq(partnerLandingPages.id, pageId))
      .limit(1);
    expect(afterInverseReconnect.competitionIds).toEqual([
      secondCreate.body.id,
      firstCreate.body.id,
    ]);
    const linkedSearch = await agent.get(
      `/api/v1/admin/partner-pages/${pageId}/competition-search?q=Second`,
    );
    expect(linkedSearch.status).toBe(200);
    expect(linkedSearch.body.data[0]).toMatchObject({
      id: secondCreate.body.id,
      linkedToPage: true,
    });

    const publish = await agent
      .patch(`/api/v1/admin/partner-pages/${pageId}`)
      .send({ published: true });
    expect(publish.status).toBe(200);
    const publicPage = await request(app).get(
      `/api/v1/partner-pages/competition-partner-${suffix}`,
    );
    expect(publicPage.status).toBe(200);
    expect(publicPage.body.data.competition).toEqual({
      id: secondCreate.body.id,
      slug: secondCreate.body.slug,
      name: `Second Cup ${suffix}`,
      type: "league",
      startDate: "2026-11-01",
      endDate: "2026-11-30",
      location: "North Fields",
    });
    expect(
      publicPage.body.data.competitions.map((item: { id: string }) => item.id),
    ).toEqual([secondCreate.body.id, firstCreate.body.id]);
    const publicCompetition = await request(app).get(
      `/api/v1/competitions/${firstCreate.body.slug}`,
    );
    expect(publicCompetition.status).toBe(200);
    expect(publicCompetition.body.competition.partnerPages).toEqual([
      {
        slug: `competition-partner-${suffix}`,
        officialName: `Competition Partner ${suffix}`,
        associationLabel: "League",
        logoUrl: null,
        primaryColor: "#155EEF",
        secondaryColor: "#06B6D4",
      },
    ]);
    await db
      .update(partnerLandingPages)
      .set({ competitionId: firstCreate.body.id, competitionIds: [] })
      .where(eq(partnerLandingPages.id, pageId));
    const legacySingularCompetition = await request(app).get(
      `/api/v1/competitions/${firstCreate.body.slug}`,
    );
    expect(legacySingularCompetition.body.competition.partnerPages).toHaveLength(1);

    await db
      .update(partnerLandingPages)
      .set({ competitionId: null, competitionIds: [firstCreate.body.id] })
      .where(eq(partnerLandingPages.id, pageId));
    const arrayCompetition = await request(app).get(
      `/api/v1/competitions/${firstCreate.body.slug}`,
    );
    expect(arrayCompetition.body.competition.partnerPages).toHaveLength(1);
    await db
      .update(partnerLandingPages)
      .set({
        competitionId: firstCreate.body.id,
        competitionIds: [firstCreate.body.id, secondCreate.body.id],
      })
      .where(eq(partnerLandingPages.id, pageId));

    const unpublish = await agent
      .patch(`/api/v1/admin/partner-pages/${pageId}`)
      .send({ published: false });
    expect(unpublish.status).toBe(200);
    const competitionWithoutUnpublishedPartner = await request(app).get(
      `/api/v1/competitions/${firstCreate.body.slug}`,
    );
    expect(
      competitionWithoutUnpublishedPartner.body.competition.partnerPages,
    ).toEqual([]);
    await agent
      .patch(`/api/v1/admin/partner-pages/${pageId}`)
      .send({ published: true });

    const removeSecond = await agent.delete(
      `/api/v1/admin/partner-pages/${pageId}/competition/${secondCreate.body.id}`,
    );
    expect(removeSecond.status).toBe(200);
    expect(
      removeSecond.body.competitions.map((item: { id: string }) => item.id),
    ).toEqual([firstCreate.body.id]);

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

    const deleteLinkedCompetition = await agent
      .delete(`/api/v1/competitions/${linkedCreate.body.competition.id}`)
      .send({ confirm: `Partner League ${suffix}` });
    expect(
      deleteLinkedCompetition.status,
      JSON.stringify(deleteLinkedCompetition.body),
    ).toBe(200);
    const [afterDelete] = await db
      .select()
      .from(partnerLandingPages)
      .where(eq(partnerLandingPages.id, pageId))
      .limit(1);
    expect(afterDelete.competitionId).toBeNull();
    expect(afterDelete.competitionIds).toEqual([]);
  });
});