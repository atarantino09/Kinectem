import { afterAll, describe, expect, it } from "vitest";
import {
  db,
  notifications,
  organizationAdmins,
  organizationJoinRequests,
  partnerLandingPages,
  partnerOrganizationMemberships,
  users,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { app, loginAs, request } from "./helpers";

const createdPageIds: string[] = [];

afterAll(async () => {
  if (createdPageIds.length) {
    await db
      .delete(partnerLandingPages)
      .where(inArray(partnerLandingPages.id, createdPageIds));
  }
});

describe("claimed partner organization administrator requests", () => {
  it("shows a safe owner identity and completes the request and approval flow", async () => {
    const { agent: ownerAgent, user: owner } = await loginAs(
      (candidate) => candidate.role === "parent",
    );
    const { agent: requesterAgent, user: requester } = await loginAs(
      (candidate) => candidate.role === "coach",
    );
    const createdOrg = await ownerAgent.post("/api/v1/organizations").send({
      name: "Partner Access Test Club",
      city: "Westfield",
      state: "NJ",
      zipCode: "07090",
    });
    expect(createdOrg.status, JSON.stringify(createdOrg.body)).toBe(201);
    const organizationId = createdOrg.body.id as string;
    const suffix = Date.now().toString(36);
    const [page] = await db
      .insert(partnerLandingPages)
      .values({
        slug: `partner-access-${suffix}`,
        officialName: "Partner Access League",
        associationLabel: "League",
        published: true,
      })
      .returning();
    createdPageIds.push(page.id);
    await db.insert(partnerOrganizationMemberships).values({
      partnerPageId: page.id,
      organizationId,
      visible: true,
    });
    const [ownerRow] = await db
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, owner.id))
      .limit(1);

    const publicPage = await request(app).get(
      `/api/v1/partner-pages/${page.slug}`,
    );
    expect(publicPage.status).toBe(200);
    const publicOrg = publicPage.body.data.organizations.find(
      (item: { id: string }) => item.id === organizationId,
    );
    expect(publicOrg).toMatchObject({
      canRequestClaim: false,
      owner: {
        userId: owner.id,
        displayName: ownerRow.name,
      },
    });
    expect(JSON.stringify(publicOrg.owner)).not.toContain(ownerRow.email);

    const anonymous = await request(app).post(
      `/api/v1/partner-pages/${page.slug}/organizations/${organizationId}/admin-requests`,
    );
    expect(anonymous.status).toBe(401);

    const createdRequest = await requesterAgent.post(
      `/api/v1/partner-pages/${page.slug}/organizations/${organizationId}/admin-requests`,
    );
    expect(createdRequest.status, JSON.stringify(createdRequest.body)).toBe(201);
    expect(createdRequest.body.data).toMatchObject({
      status: "pending",
      requestedRole: "admin",
    });
    const duplicateRequest = await requesterAgent.post(
      `/api/v1/partner-pages/${page.slug}/organizations/${organizationId}/admin-requests`,
    );
    expect(duplicateRequest.status).toBe(200);
    expect(duplicateRequest.body.data.id).toBe(createdRequest.body.data.id);

    const [storedRequest] = await db
      .select()
      .from(organizationJoinRequests)
      .where(eq(organizationJoinRequests.id, createdRequest.body.data.id))
      .limit(1);
    expect(storedRequest).toMatchObject({
      organizationId,
      userId: requester.id,
      requestedRole: "admin",
      sourcePartnerPageId: page.id,
      status: "pending",
    });
    const ownerNotices = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, owner.id),
          eq(notifications.kind, "org_admin_access_request"),
        ),
      );
    expect(ownerNotices).toHaveLength(1);

    const approve = await ownerAgent
      .post(
        `/api/v1/organizations/${organizationId}/join-requests/${storedRequest.id}/approve`,
      )
      .send({});
    expect(approve.status, JSON.stringify(approve.body)).toBe(200);
    const [newAdmin] = await db
      .select()
      .from(organizationAdmins)
      .where(
        and(
          eq(organizationAdmins.organizationId, organizationId),
          eq(organizationAdmins.userId, requester.id),
        ),
      )
      .limit(1);
    expect(newAdmin.role).toBe("admin");
    const [requesterNotice] = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, requester.id),
          eq(notifications.kind, "org_admin_access_approved"),
        ),
      )
      .limit(1);
    expect(requesterNotice.link).toBe(`/organizations/${organizationId}`);

    await db.update(users).set({ isMinor: true }).where(eq(users.id, owner.id));
    const maskedPage = await request(app).get(
      `/api/v1/partner-pages/${page.slug}`,
    );
    const maskedOrg = maskedPage.body.data.organizations.find(
      (item: { id: string }) => item.id === organizationId,
    );
    expect(maskedOrg.owner).toEqual({
      userId: null,
      displayName: "Organization owner",
      avatarUrl: null,
    });
  });
});