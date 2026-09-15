import { afterEach, describe, expect, it } from "vitest";
import {
  db,
  organizationAdmins,
  organizations,
  partnerDuplicateSwapRequests,
  partnerLandingPages,
  partnerOrganizationMemberships,
  notifications,
} from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { app, loginAs } from "./helpers";
import request, { type Agent } from "supertest";

type Scenario = {
  adminAgent: Agent;
  requesterAgent: Agent;
  requesterId: string;
  pageId: string;
  sourceMembershipId: string;
  sourceOrganizationId: string;
  targetOrganizationId: string;
  organizationIds: string[];
};

const scenarios: Scenario[] = [];

async function createScenario(options: { requesterOwnsTarget?: boolean } = {}) {
  const { agent: adminAgent, user: platformAdmin } = await loginAs(
    (user) => user.role === "admin",
  );
  const { agent: requesterAgent, user: requester } = await loginAs(
    (user) => user.role === "coach",
  );
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const name = `Duplicate Swap Club ${suffix}`;
  const [page] = await db.insert(partnerLandingPages).values({
    slug: `duplicate-swap-${suffix}`,
    officialName: `Duplicate Swap Partner ${suffix}`,
    associationLabel: "Association",
    published: true,
  }).returning();
  const [target] = await db.insert(organizations).values({ name }).returning();
  const targetOwnerId = options.requesterOwnsTarget ? requester.id : platformAdmin.id;
  await db.insert(organizationAdmins).values({
    organizationId: target.id,
    userId: targetOwnerId,
    role: "owner",
  });
  const imported = await adminAgent.post(`/api/v1/admin/partner-pages/${page.id}/import`).send({
    idempotencyKey: `duplicate-swap-import-${suffix}`,
    organizations: [{ name, action: "keep_distinct" }],
  });
  expect(imported.status, imported.text).toBe(201);
  const [sourceMembership] = await db.select().from(partnerOrganizationMemberships)
    .where(eq(partnerOrganizationMemberships.partnerPageId, page.id));
  const scenario = {
    adminAgent,
    requesterAgent,
    requesterId: requester.id,
    pageId: page.id,
    sourceMembershipId: sourceMembership.id,
    sourceOrganizationId: sourceMembership.organizationId,
    targetOrganizationId: target.id,
    organizationIds: [sourceMembership.organizationId, target.id],
  };
  scenarios.push(scenario);
  return scenario;
}

afterEach(async () => {
  const pending = scenarios.splice(0);
  for (const scenario of pending) {
    await db.delete(partnerLandingPages).where(eq(partnerLandingPages.id, scenario.pageId));
    await db.delete(organizations).where(inArray(organizations.id, scenario.organizationIds));
  }
});

describe("partner duplicate swap requests", () => {
  it("requires the requester to administer the established target organization", async () => {
    const scenario = await createScenario();
    const [page] = await db.select({ slug: partnerLandingPages.slug })
      .from(partnerLandingPages).where(eq(partnerLandingPages.id, scenario.pageId));
    const authorizedResponse = await scenario.requesterAgent
      .post(`/api/v1/partner-pages/${page.slug}/duplicate-swap-requests`)
      .send({
        sourceMembershipId: scenario.sourceMembershipId,
        targetOrganizationId: scenario.targetOrganizationId,
      });
    expect(authorizedResponse.status).toBe(409);
    expect(authorizedResponse.body.error).toMatch(/owner or admin/i);
  });

  it("rejects duplicate swap requests from masqueraded sessions", async () => {
    const scenario = await createScenario({ requesterOwnsTarget: true });
    const started = await scenario.adminAgent
      .post(`/api/v1/admin/masquerade/${scenario.requesterId}/start`);
    expect(started.status).toBe(200);
    const [page] = await db.select({ slug: partnerLandingPages.slug })
      .from(partnerLandingPages).where(eq(partnerLandingPages.id, scenario.pageId));
    const response = await scenario.adminAgent
      .post(`/api/v1/partner-pages/${page.slug}/duplicate-swap-requests`)
      .send({
        sourceMembershipId: scenario.sourceMembershipId,
        targetOrganizationId: scenario.targetOrganizationId,
      });
    expect(response.status).toBe(403);
    await scenario.adminAgent.post("/api/v1/admin/masquerade/stop");
  });

  it("requires matching partner-import provenance for the displayed source", async () => {
    const scenario = await createScenario({ requesterOwnsTarget: true });
    await db.update(partnerOrganizationMemberships)
      .set({ importOperationId: null })
      .where(eq(partnerOrganizationMemberships.id, scenario.sourceMembershipId));
    const [page] = await db.select({ slug: partnerLandingPages.slug })
      .from(partnerLandingPages).where(eq(partnerLandingPages.id, scenario.pageId));
    const response = await scenario.requesterAgent
      .post(`/api/v1/partner-pages/${page.slug}/duplicate-swap-requests`)
      .send({
        sourceMembershipId: scenario.sourceMembershipId,
        targetOrganizationId: scenario.targetOrganizationId,
      });
    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/staging duplicate/i);
  });

  it("is idempotent for duplicate pending requests and does not swap immediately", async () => {
    const scenario = await createScenario({ requesterOwnsTarget: true });
    const [page] = await db.select({ slug: partnerLandingPages.slug })
      .from(partnerLandingPages).where(eq(partnerLandingPages.id, scenario.pageId));
    const body = {
      sourceMembershipId: scenario.sourceMembershipId,
      targetOrganizationId: scenario.targetOrganizationId,
      idempotencyKey: `same-request-${scenario.pageId}`,
    };
    const first = await scenario.requesterAgent
      .post(`/api/v1/partner-pages/${page.slug}/duplicate-swap-requests`).send(body);
    const replay = await scenario.requesterAgent
      .post(`/api/v1/partner-pages/${page.slug}/duplicate-swap-requests`).send(body);
    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.body.data.id).toBe(first.body.data.id);
    const [membership] = await db.select().from(partnerOrganizationMemberships)
      .where(eq(partnerOrganizationMemberships.id, scenario.sourceMembershipId));
    expect(membership.organizationId).toBe(scenario.sourceOrganizationId);
    const requests = await db.select().from(partnerDuplicateSwapRequests)
      .where(and(
        eq(partnerDuplicateSwapRequests.sourceMembershipId, scenario.sourceMembershipId),
        eq(partnerDuplicateSwapRequests.targetOrganizationId, scenario.targetOrganizationId),
      ));
    expect(requests).toHaveLength(1);
    expect(requests[0].status).toBe("pending");
  });

  it("replays an exact request after approval and rejects idempotency payload reuse", async () => {
    const scenario = await createScenario({ requesterOwnsTarget: true });
    const [page] = await db.select({ slug: partnerLandingPages.slug })
      .from(partnerLandingPages).where(eq(partnerLandingPages.id, scenario.pageId));
    const body = {
      sourceMembershipId: scenario.sourceMembershipId,
      targetOrganizationId: scenario.targetOrganizationId,
      idempotencyKey: `post-approval-replay-${scenario.pageId}`,
    };
    const created = await scenario.requesterAgent
      .post(`/api/v1/partner-pages/${page.slug}/duplicate-swap-requests`).send(body);
    const approved = await scenario.adminAgent
      .post(`/api/v1/admin/partner-duplicate-swap-requests/${created.body.data.id}/approve`).send();
    expect(approved.status).toBe(200);
    const replay = await scenario.requesterAgent
      .post(`/api/v1/partner-pages/${page.slug}/duplicate-swap-requests`).send(body);
    expect(replay.status).toBe(200);
    expect(replay.body.data.id).toBe(created.body.data.id);
    const mismatch = await scenario.requesterAgent
      .post(`/api/v1/partner-pages/${page.slug}/duplicate-swap-requests`)
      .send({ ...body, targetOrganizationId: scenario.sourceOrganizationId });
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.error).toMatch(/idempotency key/i);
  });

  it("allows only one pending request per directory slot across target organizations", async () => {
    const scenario = await createScenario({ requesterOwnsTarget: true });
    const [secondTarget] = await db.insert(organizations).values({
      name: `Duplicate Swap Club ${scenario.pageId.slice(0, 8)}`,
    }).returning();
    await db.insert(organizationAdmins).values({
      organizationId: secondTarget.id,
      userId: scenario.requesterId,
      role: "owner",
    });
    scenario.organizationIds.push(secondTarget.id);
    const [page] = await db.select({ slug: partnerLandingPages.slug })
      .from(partnerLandingPages).where(eq(partnerLandingPages.id, scenario.pageId));
    const first = await scenario.requesterAgent
      .post(`/api/v1/partner-pages/${page.slug}/duplicate-swap-requests`)
      .send({
        sourceMembershipId: scenario.sourceMembershipId,
        targetOrganizationId: scenario.targetOrganizationId,
        idempotencyKey: "slot-first",
      });
    const second = await scenario.requesterAgent
      .post(`/api/v1/partner-pages/${page.slug}/duplicate-swap-requests`)
      .send({
        sourceMembershipId: scenario.sourceMembershipId,
        targetOrganizationId: secondTarget.id,
        idempotencyKey: "slot-second",
      });
    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(second.body.pendingRequest.id).toBe(first.body.data.id);
    expect(second.body.pendingRequest.targetOrganizationId).toBe(scenario.targetOrganizationId);
  });

  it("denial leaves the partner membership unchanged", async () => {
    const scenario = await createScenario({ requesterOwnsTarget: true });
    const [page] = await db.select({ slug: partnerLandingPages.slug })
      .from(partnerLandingPages).where(eq(partnerLandingPages.id, scenario.pageId));
    const created = await scenario.requesterAgent
      .post(`/api/v1/partner-pages/${page.slug}/duplicate-swap-requests`)
      .send({
        sourceMembershipId: scenario.sourceMembershipId,
        targetOrganizationId: scenario.targetOrganizationId,
      });
    const denied = await scenario.adminAgent
      .post(`/api/v1/admin/partner-duplicate-swap-requests/${created.body.data.id}/deny`)
      .send();
    expect(denied.status).toBe(200);
    const [membership] = await db.select().from(partnerOrganizationMemberships)
      .where(eq(partnerOrganizationMemberships.id, scenario.sourceMembershipId));
    expect(membership.organizationId).toBe(scenario.sourceOrganizationId);
    const [stored] = await db.select().from(partnerDuplicateSwapRequests)
      .where(eq(partnerDuplicateSwapRequests.id, created.body.data.id));
    expect(stored.status).toBe("denied");
    expect(stored.decidedByUserId).toBeTruthy();
  });

  it("approves only the directory membership and safely replays approval", async () => {
    const scenario = await createScenario({ requesterOwnsTarget: true });
    const [page] = await db.select({ slug: partnerLandingPages.slug })
      .from(partnerLandingPages).where(eq(partnerLandingPages.id, scenario.pageId));
    const created = await scenario.requesterAgent
      .post(`/api/v1/partner-pages/${page.slug}/duplicate-swap-requests`)
      .send({
        sourceMembershipId: scenario.sourceMembershipId,
        targetOrganizationId: scenario.targetOrganizationId,
      });
    const approved = await scenario.adminAgent
      .post(`/api/v1/admin/partner-duplicate-swap-requests/${created.body.data.id}/approve`)
      .send();
    const replay = await scenario.adminAgent
      .post(`/api/v1/admin/partner-duplicate-swap-requests/${created.body.data.id}/approve`)
      .send();
    expect(approved.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.body.data.status).toBe("approved");
    const [membership] = await db.select().from(partnerOrganizationMemberships)
      .where(eq(partnerOrganizationMemberships.id, scenario.sourceMembershipId));
    expect(membership.organizationId).toBe(scenario.targetOrganizationId);
    expect(membership.visible).toBe(true);
    const [target] = await db.select().from(organizations)
      .where(eq(organizations.id, scenario.targetOrganizationId));
    expect(target?.name).toMatch(/Duplicate Swap Club/);
    const [stored] = await db.select().from(partnerDuplicateSwapRequests)
      .where(eq(partnerDuplicateSwapRequests.id, created.body.data.id));
    expect(stored.status).toBe("approved");
    expect(stored.decidedByUserId).toBeTruthy();
  });

  it("rejects conflicting decisions and requester authority loss before approval", async () => {
    const scenario = await createScenario({ requesterOwnsTarget: true });
    const [page] = await db.select({ slug: partnerLandingPages.slug })
      .from(partnerLandingPages).where(eq(partnerLandingPages.id, scenario.pageId));
    const created = await scenario.requesterAgent
      .post(`/api/v1/partner-pages/${page.slug}/duplicate-swap-requests`)
      .send({
        sourceMembershipId: scenario.sourceMembershipId,
        targetOrganizationId: scenario.targetOrganizationId,
      });
    const [authority] = await db.select({ userId: organizationAdmins.userId })
      .from(organizationAdmins)
      .where(and(
        eq(organizationAdmins.organizationId, scenario.targetOrganizationId),
        eq(organizationAdmins.role, "owner"),
      ));
    expect(authority).toBeTruthy();
    if (!authority) return;
    await db.delete(organizationAdmins).where(and(
      eq(organizationAdmins.organizationId, scenario.targetOrganizationId),
      eq(organizationAdmins.userId, authority.userId),
    ));
    const lostAuthority = await scenario.adminAgent
      .post(`/api/v1/admin/partner-duplicate-swap-requests/${created.body.data.id}/approve`).send();
    expect(lostAuthority.status).toBe(409);
    const [membership] = await db.select().from(partnerOrganizationMemberships)
      .where(eq(partnerOrganizationMemberships.id, scenario.sourceMembershipId));
    expect(membership.organizationId).toBe(scenario.sourceOrganizationId);

    // The original request is still pending after the failed approval. Deny
    // it through the platform queue, then an approve replay must conflict.
    const decision = await scenario.adminAgent
      .post(`/api/v1/admin/partner-duplicate-swap-requests/${created.body.data.id}/deny`).send();
    expect(decision.status).toBe(200);
    const conflicting = await scenario.adminAgent
      .post(`/api/v1/admin/partner-duplicate-swap-requests/${created.body.data.id}/approve`).send();
    expect(conflicting.status).toBe(409);
  });

  it("uses the public partner page in requester outcome notifications", async () => {
    const scenario = await createScenario({ requesterOwnsTarget: true });
    const [page] = await db.select({ slug: partnerLandingPages.slug })
      .from(partnerLandingPages).where(eq(partnerLandingPages.id, scenario.pageId));
    const created = await scenario.requesterAgent
      .post(`/api/v1/partner-pages/${page.slug}/duplicate-swap-requests`)
      .send({
        sourceMembershipId: scenario.sourceMembershipId,
        targetOrganizationId: scenario.targetOrganizationId,
      });
    await scenario.adminAgent
      .post(`/api/v1/admin/partner-duplicate-swap-requests/${created.body.data.id}/deny`).send();
    const [notification] = await db.select().from(notifications)
      .where(and(
        eq(notifications.userId, scenario.requesterId),
        eq(notifications.kind, "partner_duplicate_swap_decision"),
      )).orderBy(desc(notifications.createdAt)).limit(1);
    expect(notification?.link).toBe(`/partners/${page.slug}`);
  });
});