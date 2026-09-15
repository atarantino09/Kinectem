import { Router, type IRouter } from "express";
import {
  db,
  organizations,
  organizationAdmins,
  organizationClaimRequests,
  organizationJoinRequests,
  notifications,
  orgAdminLists,
  partnerImportOperations,
  partnerImportRows,
  partnerImportCandidates,
  partnerImportDecisions,
  partnerImportSuggestions,
  partnerReplacementOperations,
  partnerDuplicateSwapRequests,
  partnerLandingPages,
  partnerOrganizationMemberships,
  organizationFollowers,
  rosterEntries,
  rosterInvites,
  scheduleEvents,
  scheduleRecurrences,
  teamFollowers,
  tournaments,
  teams,
  users,
} from "@workspace/db";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "../lib/auth";
import { asyncHandler } from "../lib/async-handler";
import { appBaseUrl, sendEmail } from "../lib/email";
import { dispatchNotificationEmail } from "../lib/notification-email";
import { generateToken } from "../lib/passwords";
import { apiError, MAX_IMAGE_DATA_URL_LENGTH } from "../lib/spec-helpers";

const router: IRouter = Router();
const HEX = /^#[0-9a-fA-F]{6}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function p(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function dedupeTeamNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value
    .map((entry) => cleanText(entry, 200))
    .filter((name) => {
      const key = normalizedOrganizationName(name);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 100);
}

function normalizedOrganizationName(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function credibleOrganizationCollision(sourceName: string, candidateName: string): boolean {
  const source = normalizedOrganizationName(sourceName);
  const candidate = normalizedOrganizationName(candidateName);
  if (!source || !candidate) return false;
  if (source === candidate) return true;
  const sourceTokens = new Set(source.split(" ").filter(Boolean));
  const candidateTokens = new Set(candidate.split(" ").filter(Boolean));
  const overlap = [...sourceTokens].filter((token) => candidateTokens.has(token));
  return editDistance(source, candidate) <= Math.max(2, Math.floor(source.length * 0.28)) ||
    (overlap.length > 0 && overlap.length >= Math.min(sourceTokens.size, candidateTokens.size));
}

function editDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0]!;
    previous[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = previous[j]!;
      previous[j] = Math.min(
        previous[j]! + 1,
        previous[j - 1]! + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[b.length]!;
}

type ImportCandidate = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  location: string | null;
  rank: number;
  matchKind: "exact" | "normalized" | "close";
  matchType: "exact" | "normalized" | "close";
  evidence: Record<string, unknown>;
  teamCount: number;
  pageMember: boolean;
  status: "claimed" | "ownerless";
  matchStatus: "candidate";
};

class PartnerImportCollisionError extends Error {}

async function rankedImportCandidates(pageId: string, sourceName: string) {
  const exactName = sourceName.trim().toLocaleLowerCase("en-US");
  const normalizedName = normalizedOrganizationName(sourceName);
  if (!normalizedName) return [] as ImportCandidate[];
  const sourceTokens = new Set(normalizedName.split(" ").filter(Boolean));
  const rows = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      city: organizations.city,
      state: organizations.state,
      location: organizations.location,
      pageMember: sql<boolean>`EXISTS (
        SELECT 1 FROM partner_organization_memberships pm
        WHERE pm.partner_page_id = ${pageId} AND pm.organization_id = ${organizations.id}
      )`,
      ownerCount: sql<number>`(
        SELECT count(*)::int FROM organization_admins oa
        WHERE oa.organization_id = ${organizations.id} AND oa.role = 'owner'
      )`,
    })
    .from(organizations)
    .orderBy(asc(organizations.name))
    .limit(10000);
  const teamCounts = await db
    .select({
      organizationId: teams.organizationId,
      teamCount: sql<number>`count(*)::int`,
    })
    .from(teams)
    .groupBy(teams.organizationId);
  const teamCountByOrganization = new Map(
    teamCounts.map((row) => [row.organizationId, Number(row.teamCount)]),
  );
  const candidates = rows.flatMap((row) => {
    const candidateExact = row.name.trim().toLocaleLowerCase("en-US");
    const candidateNormalized = normalizedOrganizationName(row.name);
    const distance = editDistance(normalizedName, candidateNormalized);
    const candidateTokens = new Set(candidateNormalized.split(" ").filter(Boolean));
    const overlap = [...sourceTokens].filter((token) => candidateTokens.has(token));
    let matchKind: ImportCandidate["matchKind"] | null = null;
    if (candidateExact === exactName) matchKind = "exact";
    else if (candidateNormalized === normalizedName) matchKind = "normalized";
    else if (
      distance <= Math.max(2, Math.floor(normalizedName.length * 0.28)) ||
      (overlap.length > 0 && overlap.length >= Math.min(sourceTokens.size, candidateTokens.size))
    ) matchKind = "close";
    if (!matchKind) return [];
    const evidence: Record<string, unknown> = {
      sourceName,
      candidateName: row.name,
      exactName: matchKind === "exact",
      normalizedName: matchKind !== "close",
      editDistance: distance,
      sharedTokens: overlap,
    };
    return [{
      id: row.id,
      name: row.name,
      city: row.city,
      state: row.state,
      location: row.location,
      rank: 0,
      matchKind,
      matchType: matchKind,
      evidence,
      teamCount: teamCountByOrganization.get(row.id) ?? 0,
      pageMember: row.pageMember,
      status: Number(row.ownerCount) > 0 ? ("claimed" as const) : ("ownerless" as const),
      matchStatus: "candidate" as const,
    }];
  });
  return candidates
    .sort((a, b) => {
      const kindRank = { exact: 0, normalized: 1, close: 2 };
      return kindRank[a.matchKind] - kindRank[b.matchKind] ||
        Number(a.evidence.editDistance) - Number(b.evidence.editDistance) ||
        a.name.localeCompare(b.name);
    })
    .slice(0, 10)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}

function validateImage(value: unknown): string | null | undefined {
  if (value === null || value === "") return null;
  if (value === undefined) return undefined;
  if (typeof value !== "string")
    throw new Error("Image must be a URL or uploaded image");
  if (value.startsWith("data:") && value.length > MAX_IMAGE_DATA_URL_LENGTH) {
    throw new Error("That image is too large");
  }
  if (!value.startsWith("data:image/") && !/^https?:\/\//i.test(value)) {
    throw new Error("Image must be an image upload or http(s) URL");
  }
  return value;
}

async function findPage(id: string) {
  const [page] = await db
    .select()
    .from(partnerLandingPages)
    .where(eq(partnerLandingPages.id, id))
    .limit(1);
  return page;
}

type CompetitionMetadata = {
  id: string;
  slug: string;
  name: string;
  type: string;
  startDate: string;
  endDate: string;
  location: string | null;
};

function competitionMetadata(
  row: typeof tournaments.$inferSelect,
): CompetitionMetadata {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    type: row.type,
    startDate: row.startDate,
    endDate: row.endDate,
    location: row.location,
  };
}

async function featuredCompetition(pageId: string) {
  return (await featuredCompetitions(pageId))[0] ?? null;
}

async function featuredCompetitions(pageId: string) {
  const [page] = await db
    .select({
      competitionIds: partnerLandingPages.competitionIds,
      competitionId: partnerLandingPages.competitionId,
    })
    .from(partnerLandingPages)
    .where(eq(partnerLandingPages.id, pageId))
    .limit(1);
  if (!page) return [];
  const ids = page.competitionIds.length
    ? page.competitionIds
    : page.competitionId
      ? [page.competitionId]
      : [];
  if (!ids.length) return [];
  const rows = await db
    .select()
    .from(tournaments)
    .where(inArray(tournaments.id, ids));
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [competitionMetadata(row)] : [];
  });
}

const PartnerCompetitionBody = z.object({
  competitionId: z.string().uuid(),
});

const PartnerCompetitionCreateBody = z.object({
  name: z.string().trim().min(1, "Competition name is required").max(200),
  type: z.enum(["tournament", "league"]).default("tournament"),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must be YYYY-MM-DD"),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "endDate must be YYYY-MM-DD"),
  location: z.string().trim().max(200).optional().nullable(),
  description: z.string().trim().max(2000).optional().nullable(),
});

function competitionSlug(name: string) {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "competition"}-${generateToken().slice(0, 10)}`;
}

async function adminMembers(pageId: string) {
  const rows = await db
    .select({
      membership: partnerOrganizationMemberships,
      organization: {
        id: organizations.id,
        name: organizations.name,
        location: organizations.location,
        city: organizations.city,
        state: organizations.state,
        logoUrl: organizations.logoUrl,
      },
      hasOwner: sql<boolean>`EXISTS (
        SELECT 1 FROM organization_admins oa
        WHERE oa.organization_id = ${organizations.id} AND oa.role = 'owner'
      )`,
      teamCount: sql<number>`(
        SELECT count(*)::int FROM teams t WHERE t.organization_id = ${organizations.id}
      )`,
      contentCount: sql<number>`(
        (SELECT count(*) FROM org_posts op WHERE op.organization_id = ${organizations.id}) +
        (SELECT count(*) FROM articles a JOIN teams t ON t.id = a.team_id WHERE t.organization_id = ${organizations.id}) +
        (SELECT count(*) FROM highlights h JOIN teams t ON t.id = h.team_id WHERE t.organization_id = ${organizations.id})
      )::int`,
      duplicateCount: sql<number>`(
        SELECT count(*)::int FROM organizations od
        WHERE lower(od.name) = lower(${organizations.name})
      )`,
    })
    .from(partnerOrganizationMemberships)
    .innerJoin(
      organizations,
      eq(organizations.id, partnerOrganizationMemberships.organizationId),
    )
    .where(eq(partnerOrganizationMemberships.partnerPageId, pageId))
    .orderBy(
      sql`${partnerOrganizationMemberships.position} NULLS LAST`,
      asc(organizations.name),
      asc(partnerOrganizationMemberships.createdAt),
    );
  return Promise.all(rows.map(async (row) => {
    const duplicateCandidates = (await rankedImportCandidates(pageId, row.organization.name))
      .filter((candidate) => candidate.id !== row.organization.id);
    const cleanup = await db.transaction((tx) =>
      organizationDeleteSafety(tx, row.membership.id, row.organization.id),
    );
    const protection = cleanup.safe ? [] : cleanup.reasons;
    return {
      id: row.membership.id,
      visible: row.membership.visible,
      position: row.membership.position,
      sourceColumn: row.membership.sourceColumn,
      importOperationId: row.membership.importOperationId,
      createdAt: row.membership.createdAt.toISOString(),
      organization: row.organization,
      hasOwner: row.hasOwner,
      teamCount: Number(row.teamCount),
      contentCount: Number(row.contentCount),
      duplicateName: Number(row.duplicateCount) > 1,
      duplicateCandidates,
      protected: !cleanup.safe,
      protection,
      cleanup: {
        allowed: cleanup.safe,
        reason: protection.length ? protection.join(", ") : null,
        summary: cleanup.safe
          ? "Eligible for safe cleanup"
          : "Keep the organization; remove only its directory membership",
      },
      canDeleteStaleImport: cleanup.safe,
    };
  }));
}

async function listDuplicateSwapRequests(pageId?: string) {
  const requests = await db
    .select()
    .from(partnerDuplicateSwapRequests)
    .where(pageId ? eq(partnerDuplicateSwapRequests.partnerPageId, pageId) : undefined)
    .orderBy(desc(partnerDuplicateSwapRequests.createdAt));
  const ids = [...new Set(requests.flatMap((request) => [
    request.sourceOrganizationId,
    request.targetOrganizationId,
    request.requestedByUserId,
    request.decidedByUserId,
  ].filter((id): id is string => !!id)))];
  const [orgRows, userRows] = await Promise.all([
    ids.length ? db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(inArray(organizations.id, ids)) : [],
    ids.length ? db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, ids)) : [],
  ]);
  const orgNames = new Map(orgRows.map((row) => [row.id, row]));
  const userNames = new Map(userRows.map((row) => [row.id, row]));
  return requests.map((request) => ({
    ...request,
    sourceOrganization: request.sourceOrganizationId
      ? orgNames.get(request.sourceOrganizationId) ?? null
      : null,
    targetOrganization: orgNames.get(request.targetOrganizationId) ?? null,
    requester: userNames.get(request.requestedByUserId) ?? null,
    approver: request.decidedByUserId ? userNames.get(request.decidedByUserId) ?? null : null,
  }));
}

router.get(
  "/admin/partner-duplicate-swap-requests",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const pageId = cleanText(req.query.pageId, 80);
    return res.json({ data: await listDuplicateSwapRequests(pageId || undefined) });
  }),
);

router.get(
  "/admin/partner-pages",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const pages = await db
      .select({
        page: partnerLandingPages,
        memberCount: sql<number>`count(${partnerOrganizationMemberships.id})::int`,
      })
      .from(partnerLandingPages)
      .leftJoin(
        partnerOrganizationMemberships,
        eq(
          partnerOrganizationMemberships.partnerPageId,
          partnerLandingPages.id,
        ),
      )
      .groupBy(partnerLandingPages.id)
      .orderBy(desc(partnerLandingPages.updatedAt));
    return res.json({
      data: pages.map(({ page, memberCount }) => ({
        ...page,
        memberCount: Number(memberCount),
      })),
    });
  }),
);

router.post(
  "/admin/partner-pages",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const officialName = cleanText(req.body?.officialName, 200);
    const associationLabel = cleanText(req.body?.associationLabel, 80);
    const slug = cleanText(req.body?.slug, 80).toLowerCase();
    if (!officialName || !associationLabel || !slug) {
      return apiError(
        res,
        400,
        "Official name, label, and URL slug are required",
      );
    }
    if (!SLUG.test(slug)) {
      return apiError(
        res,
        400,
        "Slug may contain lowercase letters, numbers, and hyphens",
      );
    }
    try {
      const [page] = await db
        .insert(partnerLandingPages)
        .values({
          officialName,
          associationLabel,
          slug,
          introduction: cleanText(req.body?.introduction, 4000),
          createdById: req.realUser!.id,
        })
        .returning();
      return res.status(201).json({ data: page });
    } catch (err) {
      if (/partner_landing_pages_slug_idx|duplicate key/i.test(String(err))) {
        return apiError(res, 409, "That partner URL slug is already in use");
      }
      throw err;
    }
  }),
);

router.get(
  "/admin/partner-pages/:pageId",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const page = await findPage(p(req.params.pageId));
    if (!page) return apiError(res, 404, "Partner page not found");
    return res.json({
      data: {
        ...page,
        competition: await featuredCompetition(page.id),
        competitions: await featuredCompetitions(page.id),
        members: await adminMembers(page.id),
        duplicateSwapRequests: await listDuplicateSwapRequests(page.id),
      },
    });
  }),
);

router.get(
  "/admin/partner-pages/:pageId/competition-search",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const pageId = p(req.params.pageId);
    if (!(await findPage(pageId)))
      return apiError(res, 404, "Partner page not found");
    const q = cleanText(req.query.q, 200);
    if (!q) return res.json({ data: [] });
    const escaped = q.replace(/[\\%_]/g, "\\$&");
    const rows = await db
      .select({
        id: tournaments.id,
        slug: tournaments.slug,
        name: tournaments.name,
        type: tournaments.type,
        startDate: tournaments.startDate,
        endDate: tournaments.endDate,
        location: tournaments.location,
        linkedToPage: sql<boolean>`EXISTS (
          SELECT 1
          FROM partner_landing_pages partner_page
          WHERE partner_page.id = ${pageId}
            AND tournaments.id = ANY(partner_page.competition_ids)
        )`,
      })
      .from(tournaments)
      .where(
        or(
          ilike(tournaments.name, `%${escaped}%`),
          ilike(tournaments.location, `%${escaped}%`),
        ),
      )
      .orderBy(desc(tournaments.startDate), asc(tournaments.name))
      .limit(30);
    return res.json({ data: rows });
  }),
);

router.put(
  "/admin/partner-pages/:pageId/competition",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const pageId = p(req.params.pageId);
    const page = await findPage(pageId);
    if (!page) return apiError(res, 404, "Partner page not found");
    const parsed = PartnerCompetitionBody.safeParse(req.body);
    if (!parsed.success) return apiError(res, 400, "A competition is required");
    const [competition] = await db
      .select()
      .from(tournaments)
      .where(eq(tournaments.id, parsed.data.competitionId))
      .limit(1);
    if (!competition) return apiError(res, 404, "Competition not found");
    const nextIds = page.competitionIds.includes(competition.id)
      ? page.competitionIds
      : [...page.competitionIds, competition.id];
    const [updated] = await db
      .update(partnerLandingPages)
      .set({
        competitionId: nextIds[0] ?? competition.id,
        competitionIds: nextIds,
        updatedAt: new Date(),
      })
      .where(eq(partnerLandingPages.id, pageId))
      .returning();
    return res.json({
      data: updated,
      competition: competitionMetadata(competition),
      competitions: await featuredCompetitions(pageId),
    });
  }),
);

router.delete(
  "/admin/partner-pages/:pageId/competition/:competitionId",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const pageId = p(req.params.pageId);
    const page = await findPage(pageId);
    if (!page) return apiError(res, 404, "Partner page not found");
    const competitionId = p(req.params.competitionId);
    const nextIds = page.competitionIds.filter((id) => id !== competitionId);
    const [updated] = await db
      .update(partnerLandingPages)
      .set({
        competitionIds: nextIds,
        competitionId: nextIds[0] ?? null,
        updatedAt: new Date(),
      })
      .where(eq(partnerLandingPages.id, pageId))
      .returning();
    return res.json({
      data: updated,
      competitions: await featuredCompetitions(pageId),
    });
  }),
);

router.delete(
  "/admin/partner-pages/:pageId/competition",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const pageId = p(req.params.pageId);
    if (!(await findPage(pageId)))
      return apiError(res, 404, "Partner page not found");
    const [updated] = await db
      .update(partnerLandingPages)
      .set({ competitionId: null, competitionIds: [], updatedAt: new Date() })
      .where(eq(partnerLandingPages.id, pageId))
      .returning();
    return res.json({ data: updated, competition: null });
  }),
);

router.post(
  "/admin/partner-pages/:pageId/competition",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const pageId = p(req.params.pageId);
    if (!(await findPage(pageId)))
      return apiError(res, 404, "Partner page not found");
    const parsed = PartnerCompetitionCreateBody.safeParse(req.body);
    if (!parsed.success) {
      return apiError(
        res,
        400,
        parsed.error.issues[0]?.message ?? "Invalid competition details",
      );
    }
    const body = parsed.data;
    if (body.endDate < body.startDate) {
      return apiError(res, 400, "endDate must be on or after startDate");
    }
    const adminId = req.realUser!.id;
    const result = await db.transaction(async (tx) => {
      const [competition] = await tx
        .insert(tournaments)
        .values({
          slug: competitionSlug(body.name),
          name: body.name,
          type: body.type,
          startDate: body.startDate,
          endDate: body.endDate,
          location: body.location ?? null,
          description: body.description ?? null,
          createdById: adminId,
          ownerUserId: adminId,
        })
        .returning();
      const page = await findPage(pageId);
      const nextIds = [...(page?.competitionIds ?? []), competition.id];
      const [updatedPage] = await tx
        .update(partnerLandingPages)
        .set({
          competitionId: nextIds[0] ?? competition.id,
          competitionIds: nextIds,
          updatedAt: new Date(),
        })
        .where(eq(partnerLandingPages.id, pageId))
        .returning();
      return { competition, page: updatedPage };
    });
    return res.status(201).json({
      data: result.page,
      competition: competitionMetadata(result.competition),
      consolePath: `/competitions/${result.competition.id}`,
    });
  }),
);

router.patch(
  "/admin/partner-pages/:pageId",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const pageId = p(req.params.pageId);
    if (!(await findPage(pageId)))
      return apiError(res, 404, "Partner page not found");
    const patch: Partial<typeof partnerLandingPages.$inferInsert> = {
      updatedAt: new Date(),
    };
    for (const [key, max] of [
      ["officialName", 200],
      ["associationLabel", 80],
      ["introduction", 4000],
    ] as const) {
      if (req.body?.[key] !== undefined)
        patch[key] = cleanText(req.body[key], max);
    }
    if (req.body?.slug !== undefined) {
      const slug = cleanText(req.body.slug, 80).toLowerCase();
      if (!SLUG.test(slug)) return apiError(res, 400, "Invalid URL slug");
      patch.slug = slug;
    }
    for (const key of ["primaryColor", "secondaryColor"] as const) {
      if (req.body?.[key] !== undefined) {
        const color = cleanText(req.body[key], 7);
        if (!HEX.test(color))
          return apiError(res, 400, `${key} must be a #rrggbb color`);
        patch[key] = color.toLowerCase();
      }
    }
    try {
      if (req.body?.logoUrl !== undefined)
        patch.logoUrl = validateImage(req.body.logoUrl);
      if (req.body?.bannerUrl !== undefined)
        patch.bannerUrl = validateImage(req.body.bannerUrl);
    } catch (err) {
      return apiError(
        res,
        /too large/i.test(String(err)) ? 413 : 400,
        (err as Error).message,
      );
    }
    if (req.body?.published !== undefined)
      patch.published = req.body.published === true;
    if (!patch.officialName && req.body?.officialName !== undefined) {
      return apiError(res, 400, "Official name is required");
    }
    const [updated] = await db
      .update(partnerLandingPages)
      .set(patch)
      .where(eq(partnerLandingPages.id, pageId))
      .returning();
    return res.json({ data: updated });
  }),
);

router.get(
  "/admin/partner-pages/:pageId/organization-search",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const pageId = p(req.params.pageId);
    const q = cleanText(req.query.q, 120);
    if (!q) return res.json({ data: [] });
    const rows = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        location: organizations.location,
        city: organizations.city,
        state: organizations.state,
        logoUrl: organizations.logoUrl,
        hasOwner: sql<boolean>`EXISTS (
          SELECT 1 FROM organization_admins oa
          WHERE oa.organization_id = ${organizations.id} AND oa.role = 'owner'
        )`,
        alreadyIncluded: sql<boolean>`EXISTS (
          SELECT 1 FROM partner_organization_memberships pm
          WHERE pm.partner_page_id = ${pageId}
            AND pm.organization_id = ${organizations.id}
        )`,
      })
      .from(organizations)
      .where(
        or(
          ilike(organizations.name, `%${q}%`),
          ilike(organizations.city, `%${q}%`),
          ilike(organizations.state, `%${q}%`),
          ilike(organizations.location, `%${q}%`),
        ),
      )
      .orderBy(asc(organizations.name))
      .limit(30);
    return res.json({ data: rows });
  }),
);

router.post(
  "/admin/partner-pages/:pageId/members",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const pageId = p(req.params.pageId);
    const organizationId = cleanText(req.body?.organizationId, 80);
    if (!(await findPage(pageId)))
      return apiError(res, 404, "Partner page not found");
    const [org] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    if (!org) return apiError(res, 404, "Organization not found");
    const [membership] = await db
      .insert(partnerOrganizationMemberships)
      .values({
        partnerPageId: pageId,
        organizationId,
        sourceColumn:
          cleanText(req.body?.sourceColumn, 200) || "Attached from directory",
      })
      .onConflictDoNothing()
      .returning();
    return res.status(membership ? 201 : 200).json({
      data: membership ?? null,
      alreadyIncluded: !membership,
    });
  }),
);

// Add every current ownerless organization in an admin-created list to the
// partner page. This is intentionally a membership-only operation: it does
// not move the organizations between admin lists or change ownership.
router.post(
  "/admin/partner-pages/:pageId/lists/:listId",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const pageId = p(req.params.pageId);
    const listId = p(req.params.listId);
    const list = await db
      .select({ id: orgAdminLists.id, name: orgAdminLists.name })
      .from(orgAdminLists)
      .where(eq(orgAdminLists.id, listId))
      .limit(1);
    if (!list[0]) {
      apiError(res, 404, "Organization list not found");
      return;
    }
    if (!(await findPage(pageId))) {
      apiError(res, 404, "Partner page not found");
      return;
    }

    const ownerExists = sql`EXISTS (
      SELECT 1 FROM organization_admins oa
      WHERE oa.organization_id = ${organizations.id}
        AND oa.role = 'owner'
    )`;
    const listOrganizations = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(
        and(eq(organizations.adminListId, listId), sql`NOT ${ownerExists}`),
      );

    const result = await db.transaction(async (tx) => {
      if (listOrganizations.length === 0) {
        return { addedCount: 0, skippedCount: 0, organizationCount: 0 };
      }
      const inserted = await tx
        .insert(partnerOrganizationMemberships)
        .values(
          listOrganizations.map((organization) => ({
            partnerPageId: pageId,
            organizationId: organization.id,
            sourceColumn: `Saved list: ${list[0].name}`,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: partnerOrganizationMemberships.id });
      return {
        addedCount: inserted.length,
        skippedCount: listOrganizations.length - inserted.length,
        organizationCount: listOrganizations.length,
      };
    });

    res.status(201).json({
      data: {
        list: list[0],
        ...result,
      },
    });
  }),
);

router.post(
  "/admin/partner-pages/:pageId/organizations",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const pageId = p(req.params.pageId);
    if (!(await findPage(pageId)))
      return apiError(res, 404, "Partner page not found");
    const name = cleanText(req.body?.name, 200);
    if (!name) return apiError(res, 400, "Organization name is required");
    let logoUrl: string | null | undefined;
    try {
      logoUrl = validateImage(req.body?.logoUrl);
    } catch (err) {
      return apiError(
        res,
        /too large/i.test(String(err)) ? 413 : 400,
        (err as Error).message,
      );
    }
    const teamNames = Array.isArray(req.body?.teams)
      ? req.body.teams
          .map((v: unknown) => cleanText(v, 200))
          .filter(Boolean)
          .slice(0, 100)
      : [];
    const result = await db.transaction(async (tx) => {
      const [org] = await tx
        .insert(organizations)
        .values({
          name,
          location: cleanText(req.body?.location, 200) || null,
          city: cleanText(req.body?.city, 120) || null,
          state: cleanText(req.body?.state, 2).toUpperCase() || null,
          logoUrl: logoUrl ?? null,
          claimToken: generateToken(),
          createdViaQuickSetupAt: new Date(),
        })
        .returning();
      for (const teamName of teamNames) {
        await tx
          .insert(teams)
          .values({ organizationId: org.id, name: teamName });
      }
      const [membership] = await tx
        .insert(partnerOrganizationMemberships)
        .values({
          partnerPageId: pageId,
          organizationId: org.id,
          sourceColumn: "Added manually",
        })
        .returning();
      return { org, membership, teamCount: teamNames.length };
    });
    return res.status(201).json({ data: result });
  }),
);

router.post(
  "/admin/partner-pages/:pageId/import/validate",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const pageId = p(req.params.pageId);
    if (!(await findPage(pageId)))
      return apiError(res, 404, "Partner page not found");
    const input = Array.isArray(req.body?.organizations)
      ? req.body.organizations.slice(0, 200)
      : [];
    const names = input.map((row: unknown) =>
      cleanText((row as { name?: unknown })?.name, 200),
    );
    const valid = names.every(Boolean) && input.length > 0;
    const seen = new Map<string, number>();
    const rows = await Promise.all(input.map(async (raw: unknown, index: number) => {
      const row = raw as { name?: unknown; sourceColumn?: unknown };
      const name = names[index] ?? "";
      const key = normalizedOrganizationName(name);
      const duplicateInFile = seen.has(key);
      if (key && !seen.has(key)) seen.set(key, index);
      const candidates = key ? await rankedImportCandidates(pageId, name) : [];
      const remembered = key
        ? await db
            .select({
              organizationId: partnerImportSuggestions.organizationId,
              decision: partnerImportSuggestions.decision,
              rationale: partnerImportSuggestions.rationale,
            })
            .from(partnerImportSuggestions)
            .where(and(
              eq(partnerImportSuggestions.partnerPageId, pageId),
              eq(partnerImportSuggestions.normalizedName, key),
            ))
            .limit(1)
        : [];
      return {
        index,
        sourceColumn: cleanText(row.sourceColumn, 200) || `Column ${index + 1}`,
        name,
        normalizedName: key,
        decisionRequired: candidates.length > 0,
        rememberedSuggestion: remembered[0] ?? null,
        rememberedDecision: remembered[0]?.decision ?? null,
        warnings: [
          ...(duplicateInFile
            ? [
                "This name appears more than once in the upload. A separate organization will be created by default.",
              ]
            : []),
          ...(candidates.length > 0
            ? [
                "Possible existing organizations found. Choose use_existing or keep_distinct before applying this row.",
              ]
            : []),
        ],
        candidates,
        // Keep the pre-1027 field for API clients while exposing ranked
        // evidence/status/team/page membership in candidates.
        possibleMatches: candidates.filter((item) => item.matchKind !== "close"),
      };
    }));
    return res.json({
      data: {
        valid,
        blockingErrors: valid ? [] : ["Every row needs an organization name."],
        rows,
      },
    });
  }),
);

router.post(
  "/admin/partner-pages/:pageId/import",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const pageId = p(req.params.pageId);
    const idempotencyKey = cleanText(req.body?.idempotencyKey, 160);
    const input = Array.isArray(req.body?.organizations)
      ? req.body.organizations.slice(0, 200)
      : [];
    if (!(await findPage(pageId)))
      return apiError(res, 404, "Partner page not found");
    if (!idempotencyKey || input.length === 0) {
      return apiError(
        res,
        400,
        "Import identity and at least one organization are required",
      );
    }
    // Retry before candidate validation: a durable idempotency result wins
    // even if canonical data changed after the first request.
    const retry = await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${"partner-import:" + pageId + ":" + idempotencyKey}))`,
      );
      const [lockedPage] = await tx.select({ id: partnerLandingPages.id })
        .from(partnerLandingPages)
        .where(eq(partnerLandingPages.id, pageId))
        .for("update")
        .limit(1);
      if (!lockedPage) return { error: "Partner page not found" as const };
      const [existingOperation] = await tx.select().from(partnerImportOperations)
        .where(and(
          eq(partnerImportOperations.partnerPageId, pageId),
          eq(partnerImportOperations.idempotencyKey, idempotencyKey),
        ))
        .limit(1);
      if (!existingOperation) return null;
      const memberships = await tx.select({
        id: partnerOrganizationMemberships.id,
        organizationId: partnerOrganizationMemberships.organizationId,
      }).from(partnerOrganizationMemberships).where(
        eq(partnerOrganizationMemberships.importOperationId, existingOperation.id),
      );
      return { replayed: true as const, operationId: existingOperation.id, memberships };
    });
    if (retry && "error" in retry) return apiError(res, 404, String(retry.error));
    if (retry?.replayed) return res.status(200).json({ data: retry });

    const candidateMap = new Map<number, ImportCandidate[]>();
    await Promise.all(input.map(async (raw: unknown, index: number) => {
      const name = cleanText((raw as { name?: unknown })?.name, 200);
      candidateMap.set(index, name ? await rankedImportCandidates(pageId, name) : []);
    }));
    for (let index = 0; index < input.length; index++) {
      const row = input[index] as {
        name?: unknown;
        action?: unknown;
        decision?: unknown;
        existingOrganizationId?: unknown;
        organizationId?: unknown;
      };
      const name = cleanText(row.name, 200);
      const action = cleanText(row.decision ?? row.action, 40);
      if (!name) return apiError(res, 400, `Organization ${index + 1}: name required`);
      if (!["skip", "use_existing", "attach", "keep_distinct", "create", ""].includes(action)) {
        return apiError(res, 400, `Organization ${index + 1}: decision must be use_existing or keep_distinct`);
      }
      if ((action === "use_existing" || action === "attach") &&
        !cleanText(row.existingOrganizationId ?? row.organizationId, 80)) {
        return apiError(res, 400, `Organization ${index + 1}: organizationId is required for use_existing`);
      }
    }
    let result;
    try {
      result = await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${"partner-import:" + pageId + ":" + idempotencyKey}))`,
      );
      // Serialize imports/replacements for a page and recheck the page while
      // holding the lock. This closes the validate→apply race.
      const lockedPage = await tx
        .select({ id: partnerLandingPages.id })
        .from(partnerLandingPages)
        .where(eq(partnerLandingPages.id, pageId))
        .for("update")
        .limit(1);
      if (!lockedPage[0]) throw new Error("Partner page not found");
      const [existingOperation] = await tx
        .select()
        .from(partnerImportOperations)
        .where(
          and(
            eq(partnerImportOperations.partnerPageId, pageId),
            eq(partnerImportOperations.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      if (existingOperation) {
        const memberships = await tx
          .select({
            id: partnerOrganizationMemberships.id,
            organizationId: partnerOrganizationMemberships.organizationId,
          })
          .from(partnerOrganizationMemberships)
          .where(
            eq(
              partnerOrganizationMemberships.importOperationId,
              existingOperation.id,
            ),
          );
        return {
          replayed: true,
          operationId: existingOperation.id,
          memberships,
        };
      }
      const [operation] = await tx
        .insert(partnerImportOperations)
        .values({ partnerPageId: pageId, idempotencyKey })
        .returning();
      const memberships: Array<{ id: string; organizationId: string }> = [];
      for (let index = 0; index < input.length; index++) {
        const row = input[index] as {
          name?: unknown;
          sourceColumn?: unknown;
          action?: unknown;
          existingOrganizationId?: unknown;
          location?: unknown;
          city?: unknown;
          state?: unknown;
          teams?: unknown;
          decision?: unknown;
        };
        const action = cleanText(row.decision ?? row.action, 40);
        if (!["skip", "use_existing", "attach", "keep_distinct", "create", ""].includes(action)) {
          throw new Error(`Organization ${index + 1}: decision must be use_existing or keep_distinct`);
        }
        const name = cleanText(row.name, 200);
        if (!name) throw new Error(`Organization ${index + 1}: name required`);
        const normalizedInputName = normalizedOrganizationName(name);
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${"partner-import-row:" + pageId + ":" + normalizedInputName}))`,
        );
        const currentNameRows = await tx.select({ id: organizations.id, name: organizations.name })
          .from(organizations);
        const currentCollision = currentNameRows.some((candidate) =>
          credibleOrganizationCollision(name, candidate.name),
        );
        if ((action === "" || action === "create") && currentCollision) {
          throw new PartnerImportCollisionError(
            `Organization ${index + 1}: a credible organization collision appeared; choose use_existing or keep_distinct`,
          );
        }
        let organizationId = cleanText(
          row.existingOrganizationId ??
            (row as { organizationId?: unknown }).organizationId,
          80,
        );
        if (action === "skip") {
          const [skippedRow] = await tx.insert(partnerImportRows).values({
            operationId: operation.id,
            rowIndex: index,
            sourceColumn: cleanText(row.sourceColumn, 200) || `Column ${index + 1}`,
            sourceName: name,
            normalizedName: normalizedOrganizationName(name),
            status: "skipped",
          }).returning();
          await tx.insert(partnerImportDecisions).values({
            partnerPageId: pageId,
            operationId: operation.id,
            importRowId: skippedRow.id,
            decision: "skip",
            decidedById: req.realUser!.id,
          });
          await tx.insert(partnerImportSuggestions).values({
            partnerPageId: pageId,
            normalizedName: normalizedOrganizationName(name),
            importRowId: skippedRow.id,
            organizationId: null,
            decision: "skip",
            rationale: { source: "explicit_decision", rowIndex: index },
            lastUsedAt: new Date(),
          }).onConflictDoUpdate({
            target: [
              partnerImportSuggestions.partnerPageId,
              partnerImportSuggestions.normalizedName,
            ],
            set: {
              organizationId: null,
              importRowId: skippedRow.id,
              decision: "skip",
              lastUsedAt: new Date(),
              rationale: { source: "explicit_decision", rowIndex: index },
            },
          });
          continue;
        }
        // Keep-distinct is intentionally the safe default when an older
        // client sends no decision. It never edits a possible source row.
        if (action !== "use_existing" && action !== "attach") {
          organizationId = "";
        }
        if (!organizationId) {
          const [org] = await tx
            .insert(organizations)
            .values({
              name,
              location: cleanText(row.location, 200) || null,
              city: cleanText(row.city, 120) || null,
              state: cleanText(row.state, 2).toUpperCase() || null,
              claimToken: generateToken(),
              partnerImportCreatedByOperationId: operation.id,
            })
            .returning({ id: organizations.id });
          organizationId = org.id;
          for (const teamName of dedupeTeamNames(row.teams)) {
            await tx.insert(teams).values({
              organizationId,
              name: teamName,
            });
          }
        } else {
          await tx.execute(
            sql`SELECT id FROM organizations WHERE id = ${organizationId} FOR UPDATE`,
          );
          const [org] = await tx
            .select({ id: organizations.id })
            .from(organizations)
            .where(eq(organizations.id, organizationId))
            .limit(1);
          if (!org)
            throw new Error(
              `Organization ${index + 1}: selected match no longer exists`,
            );
        }
        const [importRow] = await tx.insert(partnerImportRows).values({
          operationId: operation.id,
          rowIndex: index,
          sourceColumn: cleanText(row.sourceColumn, 200) || `Column ${index + 1}`,
          sourceName: name,
          normalizedName: normalizedOrganizationName(name),
          status: "applied",
        }).returning();
        for (const candidate of candidateMap.get(index) ?? []) {
          await tx.insert(partnerImportCandidates).values({
            importRowId: importRow.id,
            organizationId: candidate.id,
            rank: candidate.rank,
            matchKind: candidate.matchKind,
            evidence: candidate.evidence,
            teamCount: candidate.teamCount,
            pageMember: candidate.pageMember,
            status: candidate.id === organizationId ? "selected" : "candidate",
          }).onConflictDoNothing();
        }
        await tx.insert(partnerImportDecisions).values({
          partnerPageId: pageId,
          operationId: operation.id,
          importRowId: importRow.id,
          decision: action === "use_existing" || action === "attach"
            ? "use_existing"
            : "keep_distinct",
          organizationId,
          decidedById: req.realUser!.id,
        });
        await tx.insert(partnerImportSuggestions).values({
          partnerPageId: pageId,
          normalizedName: normalizedOrganizationName(name),
          importRowId: importRow.id,
          organizationId: action === "use_existing" || action === "attach" ? organizationId : null,
          decision: action === "use_existing" || action === "attach"
            ? "use_existing"
            : "keep_distinct",
          rationale: { source: "explicit_decision", rowIndex: index },
          lastUsedAt: new Date(),
        }).onConflictDoUpdate({
          target: [
            partnerImportSuggestions.partnerPageId,
            partnerImportSuggestions.normalizedName,
          ],
          set: {
            organizationId: action === "use_existing" || action === "attach" ? organizationId : null,
            importRowId: importRow.id,
            decision: action === "use_existing" || action === "attach"
              ? "use_existing"
              : "keep_distinct",
            lastUsedAt: new Date(),
            rationale: { source: "explicit_decision", rowIndex: index },
          },
        });
        const [membership] = await tx
          .insert(partnerOrganizationMemberships)
          .values({
            partnerPageId: pageId,
            organizationId,
            sourceColumn:
              cleanText(row.sourceColumn, 200) || `Column ${index + 1}`,
            importOperationId: operation.id,
            position: index,
          })
          .onConflictDoNothing()
          .returning({
            id: partnerOrganizationMemberships.id,
            organizationId: partnerOrganizationMemberships.organizationId,
          });
        if (membership) memberships.push(membership);
      }
        return { replayed: false, operationId: operation.id, memberships };
      });
    } catch (error) {
      if (error instanceof PartnerImportCollisionError) {
        return apiError(res, 409, error.message);
      }
      throw error;
    }
    return res.status(result.replayed ? 200 : 201).json({ data: result });
  }),
);

const ImportDecisionBody = z.object({
  decision: z.enum(["use_existing", "keep_distinct", "create", "skip"]),
  organizationId: z.string().uuid().nullable().optional(),
});

async function lockImportRow(tx: any, pageId: string, rowId: string) {
  const [row] = await tx
    .select({ row: partnerImportRows, operation: partnerImportOperations })
    .from(partnerImportRows)
    .innerJoin(partnerImportOperations, eq(partnerImportOperations.id, partnerImportRows.operationId))
    .where(and(
      eq(partnerImportRows.id, rowId),
      eq(partnerImportOperations.partnerPageId, pageId),
    ))
    .for("update")
    .limit(1);
  return row;
}

router.get(
  "/admin/partner-pages/:pageId/import/suggestions",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const pageId = p(req.params.pageId);
    if (!(await findPage(pageId))) return apiError(res, 404, "Partner page not found");
    const query = normalizedOrganizationName(cleanText(req.query.q, 200));
    const rows = await db
      .select()
      .from(partnerImportSuggestions)
      .where(and(
        eq(partnerImportSuggestions.partnerPageId, pageId),
        query ? ilike(partnerImportSuggestions.normalizedName, `%${query}%`) : undefined,
      ))
      .orderBy(desc(partnerImportSuggestions.lastUsedAt))
      .limit(50);
    return res.json({ data: rows });
  }),
);

// Decisions may be made after validation and before an import is applied.
// This endpoint is intentionally partner-page scoped: the same name can have
// a different answer for a different association.
async function decideImportRow(req: any, res: any) {
  const pageId = p(req.params.pageId);
  const rowId = p(req.params.rowId);
  const parsed = ImportDecisionBody.safeParse(req.body);
  if (!parsed.success) return apiError(res, 400, "decision must be use_existing, keep_distinct/create, or skip");
  const result = await db.transaction(async (tx) => {
    const locked = await lockImportRow(tx, pageId, rowId);
    if (!locked) return null;
    const { row, operation } = locked;
    const requestedDecision = parsed.data.decision === "create"
      ? "keep_distinct"
      : parsed.data.decision;
    let organizationId = parsed.data.organizationId ?? null;
    if (requestedDecision === "use_existing") {
      if (!organizationId) return { error: "organizationId is required for use_existing" };
      await tx.execute(sql`SELECT id FROM organizations WHERE id = ${organizationId} FOR UPDATE`);
      const [org] = await tx.select({ id: organizations.id }).from(organizations)
        .where(eq(organizations.id, organizationId)).limit(1);
      if (!org) return { error: "Selected organization no longer exists" };
    } else {
      organizationId = null;
    }
    const [decision] = await tx.insert(partnerImportDecisions).values({
      partnerPageId: pageId,
      operationId: operation.id,
      importRowId: row.id,
      decision: requestedDecision,
      organizationId,
      decidedById: req.realUser!.id,
    }).onConflictDoUpdate({
      target: [partnerImportDecisions.operationId, partnerImportDecisions.importRowId],
      set: {
        decision: requestedDecision,
        organizationId,
        decidedById: req.realUser!.id,
        reversedAt: null,
        updatedAt: new Date(),
      },
    }).returning();
    await tx.update(partnerImportRows).set({
      status: requestedDecision === "skip" ? "skipped" : "decided",
    }).where(eq(partnerImportRows.id, row.id));
    await tx.insert(partnerImportSuggestions).values({
      partnerPageId: pageId,
      normalizedName: row.normalizedName,
      importRowId: row.id,
      organizationId,
      decision: requestedDecision,
      rationale: { source: "explicit_decision", importRowId: row.id },
      lastUsedAt: new Date(),
    }).onConflictDoUpdate({
      target: [partnerImportSuggestions.partnerPageId, partnerImportSuggestions.normalizedName],
      set: {
        organizationId,
        importRowId: row.id,
        decision: requestedDecision,
        lastUsedAt: new Date(),
        rationale: { source: "explicit_decision", importRowId: row.id },
      },
    });
    return { decision, row };
  });
  if (!result) return apiError(res, 404, "Import row not found");
  if ("error" in result) return apiError(res, 409, String(result.error));
  return res.json({ data: result });
}

router.put(
  "/admin/partner-pages/:pageId/import/rows/:rowId/decision",
  requireAdmin,
  asyncHandler(decideImportRow),
);
router.post(
  "/admin/partner-pages/:pageId/import/decisions/:rowId",
  requireAdmin,
  asyncHandler(decideImportRow),
);

async function reverseImportDecision(req: any, res: any) {
  const pageId = p(req.params.pageId);
  const rowId = p(req.params.rowId);
  const result = await db.transaction(async (tx) => {
    let locked = await lockImportRow(tx, pageId, rowId);
    let actualRowId = rowId;
    if (!locked) {
      const [byDecisionId] = await tx.select({
        importRowId: partnerImportDecisions.importRowId,
      }).from(partnerImportDecisions).where(and(
        eq(partnerImportDecisions.id, rowId),
        eq(partnerImportDecisions.partnerPageId, pageId),
      )).limit(1);
      if (byDecisionId) {
        actualRowId = byDecisionId.importRowId;
        locked = await lockImportRow(tx, pageId, actualRowId);
      }
    }
    if (!locked) return null;
    const [updated] = await tx.update(partnerImportDecisions).set({
      reversedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(partnerImportDecisions.operationId, locked.operation.id),
      eq(partnerImportDecisions.importRowId, actualRowId),
      sql`${partnerImportDecisions.reversedAt} IS NULL`,
    )).returning();
    if (!updated) return { alreadyReversed: true };
    const [priorDecision] = await tx.select({
      id: partnerImportDecisions.id,
      importRowId: partnerImportDecisions.importRowId,
      decision: partnerImportDecisions.decision,
      organizationId: partnerImportDecisions.organizationId,
      normalizedName: partnerImportRows.normalizedName,
    }).from(partnerImportDecisions).innerJoin(
      partnerImportRows,
      eq(partnerImportRows.id, partnerImportDecisions.importRowId),
    ).where(and(
      eq(partnerImportDecisions.partnerPageId, pageId),
      eq(partnerImportRows.normalizedName, locked.row.normalizedName),
      sql`${partnerImportDecisions.reversedAt} IS NULL`,
    )).orderBy(desc(partnerImportDecisions.createdAt), desc(partnerImportDecisions.updatedAt))
      .limit(1);
    if (priorDecision) {
      await tx.insert(partnerImportSuggestions).values({
        partnerPageId: pageId,
        normalizedName: priorDecision.normalizedName,
        importRowId: priorDecision.importRowId,
        organizationId: priorDecision.organizationId,
        decision: priorDecision.decision,
        rationale: { source: "restored_prior_decision", decisionId: priorDecision.id },
        lastUsedAt: new Date(),
      }).onConflictDoUpdate({
        target: [partnerImportSuggestions.partnerPageId, partnerImportSuggestions.normalizedName],
        set: {
          importRowId: priorDecision.importRowId,
          organizationId: priorDecision.organizationId,
          decision: priorDecision.decision,
          rationale: { source: "restored_prior_decision", decisionId: priorDecision.id },
          lastUsedAt: new Date(),
        },
      });
    } else {
      await tx.delete(partnerImportSuggestions).where(and(
        eq(partnerImportSuggestions.partnerPageId, pageId),
        eq(partnerImportSuggestions.normalizedName, locked.row.normalizedName),
      ));
    }
    await tx.update(partnerImportRows).set({ status: "pending" })
      .where(eq(partnerImportRows.id, actualRowId));
    return {
      decision: updated,
      reversible: {
        organizationEffect: "not_reversed",
        restoredPriorDecision: priorDecision ?? null,
        removedActiveSuggestion: !priorDecision,
      },
    };
  });
  if (!result) return apiError(res, 404, "Import row not found");
  return res.json({ data: result });
}

router.delete(
  "/admin/partner-pages/:pageId/import/decisions/:rowId",
  requireAdmin,
  asyncHandler(reverseImportDecision),
);
router.post(
  "/admin/partner-pages/:pageId/import/decisions/:rowId/revert",
  requireAdmin,
  asyncHandler(reverseImportDecision),
);

async function organizationDeleteSafety(tx: any, membershipId: string, organizationId: string) {
  await tx.execute(sql`SELECT id FROM organizations WHERE id = ${organizationId} FOR UPDATE`);
  await tx.execute(sql`SELECT id FROM partner_organization_memberships WHERE id = ${membershipId} FOR UPDATE`);
  // Lock every source team in a stable order before checking any activity.
  // This serializes roster/schedule/content writes with cleanup and prevents
  // a team from becoming active between the safety check and deletion.
  await tx.execute(sql`
    SELECT id
    FROM teams
    WHERE organization_id = ${organizationId}
    ORDER BY id
    FOR UPDATE
  `);
  const [state] = await tx.select({
    importOperationId: partnerOrganizationMemberships.importOperationId,
    createdByImportOperationId: organizations.partnerImportCreatedByOperationId,
    ownerCount: sql<number>`(SELECT count(*) FROM organization_admins WHERE organization_id = ${organizationId} AND role = 'owner')::int`,
    adminCount: sql<number>`(SELECT count(*) FROM organization_admins WHERE organization_id = ${organizationId})::int`,
    pendingClaimCount: sql<number>`(SELECT count(*) FROM organization_claim_requests WHERE organization_id = ${organizationId} AND status = 'pending')::int`,
    pendingJoinCount: sql<number>`(SELECT count(*) FROM organization_join_requests WHERE organization_id = ${organizationId} AND status = 'pending')::int`,
    pendingInviteCount: sql<number>`(
      (SELECT count(*) FROM organization_invites WHERE organization_id = ${organizationId} AND status = 'pending') +
      (SELECT count(*) FROM coach_invite_groups WHERE organization_id = ${organizationId} AND status = 'pending')
    )::int`,
    // Count every organization-owned row that would be deleted or nulled by
    // an organization cascade. The row locks above prevent FK-backed inserts
    // while these counts are evaluated.
    organizationDependencyCount: sql<number>`(
      (SELECT count(*) FROM organization_follow_optouts WHERE organization_id = ${organizationId}) +
      (SELECT count(*) FROM user_pinned_orgs WHERE org_id = ${organizationId}) +
      (SELECT count(*) FROM organization_roster_outreach WHERE organization_id = ${organizationId}) +
      (SELECT count(*) FROM organization_invites WHERE organization_id = ${organizationId}) +
      (SELECT count(*) FROM coach_invite_groups WHERE organization_id = ${organizationId}) +
      (SELECT count(*) FROM staged_coach_invites WHERE organization_id = ${organizationId}) +
      (SELECT count(*) FROM org_subscriptions WHERE organization_id = ${organizationId}) +
      (SELECT count(*) FROM organization_join_requests WHERE organization_id = ${organizationId}) +
      (SELECT count(*) FROM organization_claim_requests WHERE organization_id = ${organizationId}) +
      (SELECT count(*) FROM partner_import_candidates pic JOIN partner_import_rows pir ON pir.id = pic.import_row_id
        WHERE pic.organization_id = ${organizationId}
          AND pir.operation_id IS DISTINCT FROM ${partnerOrganizationMemberships.importOperationId}) +
      (SELECT count(*) FROM partner_import_decisions
        WHERE organization_id = ${organizationId}
          AND operation_id IS DISTINCT FROM ${partnerOrganizationMemberships.importOperationId}) +
      (SELECT count(*) FROM partner_import_suggestions pis
        WHERE pis.organization_id = ${organizationId}
          AND (pis.import_row_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM partner_import_rows pir2
            WHERE pir2.id = pis.import_row_id
              AND pir2.operation_id = ${partnerOrganizationMemberships.importOperationId}
          ))) +
      (SELECT count(*) FROM partner_replacement_operations WHERE candidate_organization_id = ${organizationId}) +
      (SELECT count(*) FROM broadcasts WHERE organization_id = ${organizationId}) +
      (SELECT count(*) FROM schedule_events WHERE organization_id = ${organizationId})
    )::int`,
    // Team rows themselves are intentionally omitted: empty shells are safe
    // to cascade. Every other team FK is a protected dependency, including
    // staged invites and competition/news/broadcast data.
    teamDependencyCount: sql<number>`(
      (SELECT count(*) FROM user_pinned_teams upt JOIN teams t ON t.id = upt.team_id WHERE t.organization_id = ${organizationId}) +
      (SELECT count(*) FROM organization_roster_outreach oro JOIN teams t ON t.id = oro.team_id WHERE t.organization_id = ${organizationId}) +
      (SELECT count(*) FROM team_followers tf JOIN teams t ON t.id = tf.team_id WHERE t.organization_id = ${organizationId}) +
      (SELECT count(*) FROM roster_entries re JOIN teams t ON t.id = re.team_id WHERE t.organization_id = ${organizationId}) +
      (SELECT count(*) FROM roster_invites ri JOIN teams t ON t.id = ri.team_id WHERE t.organization_id = ${organizationId}) +
      (SELECT count(*) FROM staged_coach_invites sci JOIN teams t ON t.id = sci.team_id WHERE t.organization_id = ${organizationId}) +
      (SELECT count(*) FROM articles a JOIN teams t ON t.id = a.team_id WHERE t.organization_id = ${organizationId}) +
      (SELECT count(*) FROM highlights h JOIN teams t ON t.id = h.team_id WHERE t.organization_id = ${organizationId}) +
      (SELECT count(*) FROM tournament_participants tp JOIN teams t ON t.id = tp.team_id WHERE t.organization_id = ${organizationId}) +
      (SELECT count(*) FROM tournament_participants tp JOIN teams t ON t.id = tp.pending_team_id WHERE t.organization_id = ${organizationId}) +
      (SELECT count(*) FROM game_score_reports gsr JOIN teams t ON t.id = gsr.team_id WHERE t.organization_id = ${organizationId}) +
      (SELECT count(*) FROM team_hidden_competition_games thc JOIN teams t ON t.id = thc.team_id WHERE t.organization_id = ${organizationId}) +
      (SELECT count(*) FROM schedule_recurrences sr JOIN teams t ON t.id = sr.team_id WHERE t.organization_id = ${organizationId}) +
      (SELECT count(*) FROM schedule_events se JOIN teams t ON t.id = se.team_id WHERE t.organization_id = ${organizationId}) +
      (SELECT count(*) FROM broadcasts b JOIN teams t ON t.id = b.team_id WHERE t.organization_id = ${organizationId}) +
      (SELECT count(*) FROM team_news_links tnl JOIN teams t ON t.id = tnl.team_id WHERE t.organization_id = ${organizationId})
    )::int`,
    followerCount: sql<number>`(SELECT count(*) FROM organization_followers WHERE organization_id = ${organizationId})::int`,
    contentCount: sql<number>`(
      (SELECT count(*) FROM org_posts WHERE organization_id = ${organizationId}) +
      (SELECT count(*) FROM articles a JOIN teams t ON t.id = a.team_id WHERE t.organization_id = ${organizationId}) +
      (SELECT count(*) FROM highlights h JOIN teams t ON t.id = h.team_id WHERE t.organization_id = ${organizationId})
    )::int`,
    teamCount: sql<number>`(SELECT count(*) FROM teams WHERE organization_id = ${organizationId})::int`,
    teamActivityCount: sql<number>`(
      (SELECT count(*) FROM roster_entries re JOIN teams t ON t.id = re.team_id WHERE t.organization_id = ${organizationId}) +
      (SELECT count(*) FROM roster_invites ri JOIN teams t ON t.id = ri.team_id WHERE t.organization_id = ${organizationId}) +
      (SELECT count(*) FROM team_followers tf JOIN teams t ON t.id = tf.team_id WHERE t.organization_id = ${organizationId}) +
      (SELECT count(*) FROM schedule_events se JOIN teams t ON t.id = se.team_id WHERE t.organization_id = ${organizationId}) +
      (SELECT count(*) FROM schedule_recurrences sr JOIN teams t ON t.id = sr.team_id WHERE t.organization_id = ${organizationId})
    )::int`,
    otherMembershipCount: sql<number>`(
      SELECT count(*) FROM partner_organization_memberships
      WHERE organization_id = ${organizationId} AND id <> ${membershipId}
    )::int`,
  }).from(partnerOrganizationMemberships).innerJoin(
    organizations,
    eq(organizations.id, partnerOrganizationMemberships.organizationId),
  ).where(eq(partnerOrganizationMemberships.id, membershipId)).limit(1);
  if (!state) return { safe: false, reasons: ["membership_missing"] as string[] };
  const reasons: string[] = [];
  if (!state.importOperationId) reasons.push("not_import_created");
  if (
    !state.createdByImportOperationId ||
    state.createdByImportOperationId !== state.importOperationId
  ) reasons.push("source_not_created_by_this_import");
  if (Number(state.ownerCount) > 0) reasons.push("has_owner");
  if (Number(state.adminCount) > 0) reasons.push("has_admin");
  if (Number(state.pendingClaimCount) > 0) reasons.push("pending_claim");
  if (Number(state.pendingJoinCount) > 0) reasons.push("pending_join_request");
  if (Number(state.pendingInviteCount) > 0) reasons.push("pending_invite");
  if (Number(state.organizationDependencyCount) > 0) reasons.push("organization_dependencies");
  if (Number(state.teamDependencyCount) > 0) reasons.push("team_dependencies");
  if (Number(state.followerCount) > 0) reasons.push("activity");
  if (Number(state.contentCount) > 0) reasons.push("content");
  if (Number(state.teamActivityCount) > 0) reasons.push("team_activity");
  if (Number(state.otherMembershipCount) > 0) reasons.push("other_partner_use");
  return { safe: reasons.length === 0, reasons, ...state };
}

async function importImpactPreview(req: any, res: any) {
  const pageId = p(req.params.pageId);
  const operationId = p(req.params.operationId) || cleanText(req.body?.operationId, 80);
  const preview = await db.transaction(async (tx) => {
    const [page] = await tx.select({ id: partnerLandingPages.id }).from(partnerLandingPages)
      .where(eq(partnerLandingPages.id, pageId)).for("update").limit(1);
    if (!page) return { error: "Partner page not found" as const };
    const [operation] = await tx.select().from(partnerImportOperations).where(and(
      eq(partnerImportOperations.id, operationId),
      eq(partnerImportOperations.partnerPageId, pageId),
    )).for("update").limit(1);
    if (!operation) return { error: "Import operation not found" as const };
    const memberships = await tx.select({
      id: partnerOrganizationMemberships.id,
      organizationId: partnerOrganizationMemberships.organizationId,
      visible: partnerOrganizationMemberships.visible,
      position: partnerOrganizationMemberships.position,
      name: organizations.name,
    }).from(partnerOrganizationMemberships).innerJoin(
      organizations, eq(organizations.id, partnerOrganizationMemberships.organizationId),
    ).where(eq(partnerOrganizationMemberships.importOperationId, operationId))
      .orderBy(sql`${partnerOrganizationMemberships.position} NULLS LAST`)
      .for("update");
    const safety = await Promise.all(memberships.map((membership) =>
      organizationDeleteSafety(tx, membership.id, membership.organizationId),
    ));
    return { operationId, memberships, safety };
  });
  if ("error" in preview) return apiError(res, 404, String(preview.error));
  return res.json({
    data: {
      operationId: preview.operationId,
      current: preview.memberships,
      stale: preview.memberships.map((membership, index) => ({
        ...membership,
        ...preview.safety[index],
        action: preview.safety[index]?.safe ? "delete_membership_and_organization" : "directory_only",
      })),
      preservesVisibilityAndOrder: true,
    },
  });
}

router.post(
  "/admin/partner-pages/:pageId/import/:operationId/impact-preview",
  requireAdmin,
  asyncHandler(importImpactPreview),
);
router.post(
  "/admin/partner-pages/:pageId/import/impact-preview",
  requireAdmin,
  asyncHandler(importImpactPreview),
);

async function memberReplacementPreview(req: any, res: any) {
  const pageId = p(req.params.pageId);
  const membershipId = p(req.params.membershipId);
  const candidateId = cleanText(req.body?.organizationId ?? req.body?.candidateId, 80);
  if (!candidateId) return apiError(res, 400, "organizationId or candidateId is required");
  const result = await db.transaction(async (tx) => {
    const [page] = await tx.select({ id: partnerLandingPages.id }).from(partnerLandingPages)
      .where(eq(partnerLandingPages.id, pageId)).for("update").limit(1);
    if (!page) return { error: "Partner page not found" as const };
    const [member] = await tx.select({
      membership: partnerOrganizationMemberships,
      organization: { id: organizations.id, name: organizations.name },
    }).from(partnerOrganizationMemberships).innerJoin(
      organizations, eq(organizations.id, partnerOrganizationMemberships.organizationId),
    ).where(and(
      eq(partnerOrganizationMemberships.id, membershipId),
      eq(partnerOrganizationMemberships.partnerPageId, pageId),
    )).for("update").limit(1);
    if (!member) return { error: "Partner membership not found" as const };
    await tx.execute(sql`SELECT id FROM organizations WHERE id = ${candidateId} FOR UPDATE`);
    const [candidate] = await tx.select({
      id: organizations.id,
      name: organizations.name,
      teamCount: sql<number>`(SELECT count(*) FROM teams WHERE organization_id = ${organizations.id})::int`,
    }).from(organizations).where(eq(organizations.id, candidateId)).limit(1);
    if (!candidate) return { error: "Replacement organization not found" as const };
    const [sibling] = await tx.select({ id: partnerOrganizationMemberships.id })
      .from(partnerOrganizationMemberships).where(and(
        eq(partnerOrganizationMemberships.partnerPageId, pageId),
        eq(partnerOrganizationMemberships.organizationId, candidateId),
        sql`${partnerOrganizationMemberships.id} <> ${membershipId}`,
      )).limit(1);
    const cleanup = await organizationDeleteSafety(tx, membershipId, member.organization.id);
    return {
      member: member.membership,
      source: member.organization,
      candidate,
      cleanup,
      siblingMembershipId: sibling?.id ?? null,
    };
  });
  if ("error" in result) return apiError(res, result.error === "Partner page not found" ? 404 : 409, String(result.error));
  const warnings = result.siblingMembershipId
    ? ["The replacement organization is already on this partner page."]
    : result.cleanup.safe
      ? []
      : [`Source retained as directory-only (${result.cleanup.reasons.join(", ")}).`];
  return res.json({
    impact: {
      memberId: membershipId,
      organizationId: result.source.id,
      organizationName: result.source.name,
      candidate: result.candidate,
      protected: !result.cleanup.safe,
      canReplace: !result.siblingMembershipId,
      warnings,
      cleanup: result.cleanup.reasons,
      sourceVisibility: result.member.visible,
      sourcePosition: result.member.position,
      summary: result.siblingMembershipId
        ? "Replacement is unavailable because the candidate is already included."
        : "Only this partner membership will be replaced; visibility and order are preserved.",
    },
  });
}

async function replacePartnerMemberInTransaction(
  tx: any,
  pageId: string,
  membershipId: string,
  candidateId: string,
  idempotencyKey: string,
) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${
    "partner-member-replace:" + pageId + ":" + membershipId + ":" + candidateId + ":" + idempotencyKey
  }))`);
  const [page] = await tx.select({ id: partnerLandingPages.id }).from(partnerLandingPages)
    .where(eq(partnerLandingPages.id, pageId)).for("update").limit(1);
  if (!page) return { error: "Partner page not found" as const };
  const [existingReplacement] = await tx.select().from(partnerReplacementOperations)
    .where(and(
      eq(partnerReplacementOperations.partnerPageId, pageId),
      eq(partnerReplacementOperations.membershipId, membershipId),
      eq(partnerReplacementOperations.idempotencyKey, idempotencyKey),
    )).limit(1);
  if (existingReplacement) {
    if (existingReplacement.candidateOrganizationId !== candidateId) {
      return { error: "Replacement idempotency key was already used for another organization" as const };
    }
    return { replayed: true as const, response: existingReplacement.result };
  }
  const [member] = await tx.select({
    membership: partnerOrganizationMemberships,
    organization: { id: organizations.id, name: organizations.name },
  }).from(partnerOrganizationMemberships).innerJoin(
    organizations, eq(organizations.id, partnerOrganizationMemberships.organizationId),
  ).where(and(
    eq(partnerOrganizationMemberships.id, membershipId),
    eq(partnerOrganizationMemberships.partnerPageId, pageId),
  )).for("update").limit(1);
  if (!member) return { error: "Partner membership not found" as const };
  const [candidate] = await tx.select({ id: organizations.id, name: organizations.name })
    .from(organizations).where(eq(organizations.id, candidateId)).for("update").limit(1);
  if (!candidate) return { error: "Replacement organization not found" as const };
  if (candidate.id === member.organization.id) {
    return { error: "Replacement organization is already selected" as const };
  }
  const [sibling] = await tx.select({ id: partnerOrganizationMemberships.id })
    .from(partnerOrganizationMemberships).where(and(
      eq(partnerOrganizationMemberships.partnerPageId, pageId),
      eq(partnerOrganizationMemberships.organizationId, candidateId),
      sql`${partnerOrganizationMemberships.id} <> ${membershipId}`,
    )).limit(1);
  if (sibling) return { error: "Replacement organization is already included on this partner page" as const };
  const cleanup = await organizationDeleteSafety(tx, membershipId, member.organization.id);
  const [updated] = await tx.update(partnerOrganizationMemberships).set({
    organizationId: candidate.id,
    importOperationId: null,
    replacementIdempotencyKey: idempotencyKey,
    visible: member.membership.visible,
    position: member.membership.position,
  }).where(and(
    eq(partnerOrganizationMemberships.id, membershipId),
    eq(partnerOrganizationMemberships.partnerPageId, pageId),
  )).returning();
  let sourceDeleted = false;
  if (cleanup.safe) {
    await tx.delete(organizations).where(eq(organizations.id, member.organization.id));
    sourceDeleted = true;
  }
  const responseData = {
    updated,
    sourceDeleted,
    sourceRetainedDirectoryOnly: !cleanup.safe,
    cleanup,
    summary: "Only the selected partner membership was replaced.",
  };
  const response = { summary: responseData.summary, data: responseData };
  await tx.insert(partnerReplacementOperations).values({
    partnerPageId: pageId,
    membershipId,
    idempotencyKey,
    candidateOrganizationId: candidate.id,
    result: response,
  });
  return response;
}

async function replacePartnerMember(req: any, res: any) {
  const pageId = p(req.params.pageId);
  const membershipId = p(req.params.membershipId);
  const candidateId = cleanText(req.body?.organizationId ?? req.body?.candidateId, 80);
  const idempotencyKey = cleanText(req.body?.idempotencyKey, 160);
  if (!candidateId || !idempotencyKey) {
    return apiError(res, 400, "organizationId and idempotencyKey are required");
  }
  const result = await db.transaction((tx) =>
    replacePartnerMemberInTransaction(tx, pageId, membershipId, candidateId, idempotencyKey),
  );
  if ("error" in result) return apiError(res, result.error === "Partner page not found" || result.error === "Partner membership not found" ? 404 : 409, String(result.error));
  if ("replayed" in result && result.replayed) {
    return res.status(200).json(result.response);
  }
  return res.status(200).json({
    summary: result.summary,
    data: result.data,
  });
}

router.post(
  "/admin/partner-pages/:pageId/members/:membershipId/replace/preview",
  requireAdmin,
  asyncHandler(memberReplacementPreview),
);
router.post(
  "/admin/partner-pages/:pageId/members/:membershipId/replace",
  requireAdmin,
  asyncHandler(replacePartnerMember),
);

async function replacePartnerImport(req: any, res: any) {
  // A whole-operation replacement can accidentally touch sibling rows. For
  // backwards compatibility, dispatch only when the operation has one row;
  // otherwise force callers to identify the membership explicitly.
  const pageId = p(req.params.pageId);
  const operationId = p(req.params.operationId) || cleanText(req.body?.operationId, 80);
  const operationMembers = operationId
    ? await db.select({ id: partnerOrganizationMemberships.id })
      .from(partnerOrganizationMemberships)
      .where(and(
        eq(partnerOrganizationMemberships.partnerPageId, pageId),
        eq(partnerOrganizationMemberships.importOperationId, operationId),
      ))
    : [];
  if (operationMembers.length !== 1) {
    return apiError(
      res,
      409,
      "Replacement is member-scoped; use /members/:membershipId/replace",
    );
  }
  req.params.membershipId = operationMembers[0].id;
  const firstOrganization = Array.isArray(req.body?.organizations)
    ? req.body.organizations[0]
    : null;
  req.body = {
    ...req.body,
    organizationId: req.body?.organizationId ??
      req.body?.candidateId ??
      firstOrganization?.organizationId ??
      firstOrganization?.existingOrganizationId,
  };
  return replacePartnerMember(req, res);
  /*
  const pageId = p(req.params.pageId);
  const sourceOperationId = p(req.params.operationId) || cleanText(req.body?.operationId, 80);
  const idempotencyKey = cleanText(req.body?.idempotencyKey, 160);
  const input = Array.isArray(req.body?.organizations)
    ? req.body.organizations.slice(0, 200)
    : Array.isArray(req.body?.organizationIds)
      ? req.body.organizationIds.slice(0, 200).map((organizationId: unknown) => ({
          organizationId,
          action: "use_existing",
        }))
      : [];
  if (!idempotencyKey || !sourceOperationId || input.length === 0) {
    return apiError(res, 400, "operationId, idempotencyKey, and replacement organizations are required");
  }
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"partner-replace:" + pageId + ":" + idempotencyKey}))`);
    const [page] = await tx.select({ id: partnerLandingPages.id }).from(partnerLandingPages)
      .where(eq(partnerLandingPages.id, pageId)).for("update").limit(1);
    if (!page) return { error: "Partner page not found" };
    const [source] = await tx.select().from(partnerImportOperations).where(and(
      eq(partnerImportOperations.id, sourceOperationId),
      eq(partnerImportOperations.partnerPageId, pageId),
    )).for("update").limit(1);
    if (!source) return { error: "Import operation not found" };
    const [replayed] = await tx.select().from(partnerImportOperations).where(and(
      eq(partnerImportOperations.partnerPageId, pageId),
      eq(partnerImportOperations.idempotencyKey, idempotencyKey),
    )).limit(1);
    if (replayed) return { replayed: true, operationId: replayed.id, deletedCount: 0, directoryOnlyCount: 0 };
    const [operation] = await tx.insert(partnerImportOperations).values({
      partnerPageId: pageId,
      idempotencyKey,
    }).returning();
    const desiredIds: string[] = [];
    const memberships: Array<{ id: string; organizationId: string; position: number }> = [];
    for (let index = 0; index < input.length; index++) {
      const row = input[index] as {
        name?: unknown;
        organizationId?: unknown;
        existingOrganizationId?: unknown;
        action?: unknown;
        decision?: unknown;
        sourceColumn?: unknown;
      };
      const action = cleanText(row.decision ?? row.action, 40) || "use_existing";
      if (action === "skip") continue;
      let organizationId = cleanText(row.organizationId ?? row.existingOrganizationId, 80);
      if (action === "keep_distinct" || !organizationId) {
        const name = cleanText(row.name, 200);
        if (!name) return { error: `Organization ${index + 1}: name required` };
        const [created] = await tx.insert(organizations).values({
          name,
          location: cleanText((row as any).location, 200) || null,
          city: cleanText((row as any).city, 120) || null,
          state: cleanText((row as any).state, 2).toUpperCase() || null,
          claimToken: generateToken(),
          partnerImportCreatedByOperationId: operation.id,
        }).returning({ id: organizations.id });
        organizationId = created.id;
      } else {
        await tx.execute(sql`SELECT id FROM organizations WHERE id = ${organizationId} FOR UPDATE`);
        const [exists] = await tx.select({ id: organizations.id }).from(organizations)
          .where(eq(organizations.id, organizationId)).limit(1);
        if (!exists) return { error: `Organization ${index + 1}: selected match no longer exists` };
      }
      if (desiredIds.includes(organizationId)) continue;
      desiredIds.push(organizationId);
      const position = typeof (row as any).position === "number" ? (row as any).position : index;
      const [membership] = await tx.insert(partnerOrganizationMemberships).values({
        partnerPageId: pageId,
        organizationId,
        sourceColumn: cleanText(row.sourceColumn, 200) || `Column ${index + 1}`,
        importOperationId: operation.id,
        position,
        visible: true,
      }).onConflictDoUpdate({
        target: [partnerOrganizationMemberships.partnerPageId, partnerOrganizationMemberships.organizationId],
        set: {
          visible: true,
          position,
          importOperationId: operation.id,
          sourceColumn: cleanText(row.sourceColumn, 200) || `Column ${index + 1}`,
        },
      }).returning({
        id: partnerOrganizationMemberships.id,
        organizationId: partnerOrganizationMemberships.organizationId,
        position: partnerOrganizationMemberships.position,
      });
      memberships.push({ id: membership.id, organizationId, position: membership.position ?? position });
    }
    const stale = await tx.select({
      id: partnerOrganizationMemberships.id,
      organizationId: partnerOrganizationMemberships.organizationId,
    }).from(partnerOrganizationMemberships).where(and(
      eq(partnerOrganizationMemberships.importOperationId, source.id),
      eq(partnerOrganizationMemberships.partnerPageId, pageId),
    )).for("update");
    let deletedCount = 0;
    let directoryOnlyCount = 0;
    for (const oldMembership of stale) {
      if (desiredIds.includes(oldMembership.organizationId)) continue;
      const safety = await organizationDeleteSafety(tx, oldMembership.id, oldMembership.organizationId);
      if (safety.safe) {
        await tx.delete(partnerOrganizationMemberships).where(eq(partnerOrganizationMemberships.id, oldMembership.id));
        await tx.delete(organizations).where(eq(organizations.id, oldMembership.organizationId));
        deletedCount++;
      } else {
        // A claimed/content-bearing/followed source remains canonical. The
        // partner directory is simply detached from it.
        await tx.update(partnerOrganizationMemberships).set({ visible: false }).where(eq(partnerOrganizationMemberships.id, oldMembership.id));
        directoryOnlyCount++;
      }
    }
    return {
      replayed: false,
      operationId: operation.id,
      replacedOperationId: source.id,
      memberships,
      deletedCount,
      directoryOnlyCount,
    };
  });
  if ("error" in result) return apiError(res, result.error === "Partner page not found" || result.error === "Import operation not found" ? 404 : 409, String(result.error));
  return res.status(result.replayed ? 200 : 201).json({ data: result });
  */
}

router.post(
  "/admin/partner-pages/:pageId/import/:operationId/replace",
  requireAdmin,
  asyncHandler(replacePartnerImport),
);
router.post(
  "/admin/partner-pages/:pageId/import/replace",
  requireAdmin,
  asyncHandler(replacePartnerImport),
);

router.patch(
  "/admin/partner-pages/:pageId/members/:membershipId",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const [updated] = await db
      .update(partnerOrganizationMemberships)
      .set({ visible: req.body?.visible === true })
      .where(
        and(
          eq(partnerOrganizationMemberships.id, p(req.params.membershipId)),
          eq(
            partnerOrganizationMemberships.partnerPageId,
            p(req.params.pageId),
          ),
        ),
      )
      .returning();
    if (!updated) return apiError(res, 404, "Partner membership not found");
    return res.json({ data: updated });
  }),
);

router.delete(
  "/admin/partner-pages/:pageId/members/:membershipId",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const [removed] = await db
      .delete(partnerOrganizationMemberships)
      .where(
        and(
          eq(partnerOrganizationMemberships.id, p(req.params.membershipId)),
          eq(
            partnerOrganizationMemberships.partnerPageId,
            p(req.params.pageId),
          ),
        ),
      )
      .returning({ id: partnerOrganizationMemberships.id });
    if (!removed) return apiError(res, 404, "Partner membership not found");
    return res.json({ ok: true });
  }),
);

router.delete(
  "/admin/partner-pages/:pageId/members/:membershipId/stale-organization",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const pageId = p(req.params.pageId);
    const membershipId = p(req.params.membershipId);
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"partner-stale-delete:" + membershipId}))`);
      await tx.execute(sql`SELECT id FROM partner_landing_pages WHERE id = ${pageId} FOR UPDATE`);
      const [row] = await tx.select({
        organizationId: partnerOrganizationMemberships.organizationId,
        name: organizations.name,
      }).from(partnerOrganizationMemberships).innerJoin(
        organizations,
        eq(organizations.id, partnerOrganizationMemberships.organizationId),
      ).where(and(
        eq(partnerOrganizationMemberships.id, membershipId),
        eq(partnerOrganizationMemberships.partnerPageId, pageId),
      )).for("update").limit(1);
      if (!row) return { notFound: true as const };
      const safety = await organizationDeleteSafety(tx, membershipId, row.organizationId);
      if (cleanText(req.body?.confirmName, 200) !== row.name) {
        return { badConfirmation: true as const, name: row.name };
      }
      if (!safety.safe) return { unsafe: true as const, name: row.name, reasons: safety.reasons };
      await tx.delete(partnerOrganizationMemberships).where(eq(partnerOrganizationMemberships.id, membershipId));
      await tx.delete(organizations).where(eq(organizations.id, row.organizationId));
      return { deleted: true as const };
    });
    if ("notFound" in result) return apiError(res, 404, "Partner membership not found");
    if ("badConfirmation" in result) return apiError(res, 400, "Type the organization name exactly to confirm deletion");
    if ("unsafe" in result) {
      return apiError(
        res,
        409,
        `Organization cannot be safely deleted (${result.reasons.join(", ")}). Hide or remove it from the page instead.`,
      );
    }
    return res.json({ ok: true });
  }),
);

router.get(
  "/partner-pages/:slug",
  asyncHandler(async (req, res) => {
    const slug = p(req.params.slug).toLowerCase();
    const [page] = await db
      .select()
      .from(partnerLandingPages)
      .where(
        and(
          sql`lower(${partnerLandingPages.slug}) = ${slug}`,
          eq(partnerLandingPages.published, true),
        ),
      )
      .limit(1);
    if (!page) return apiError(res, 404, "Partner page not found");
    const rows = await db
      .select({
        membershipId: partnerOrganizationMemberships.id,
        importOperationId: partnerOrganizationMemberships.importOperationId,
        importCreatedByOperationId: organizations.partnerImportCreatedByOperationId,
        organization: {
          id: organizations.id,
          name: organizations.name,
          location: organizations.location,
          city: organizations.city,
          state: organizations.state,
          logoUrl: organizations.logoUrl,
        },
        canRequestClaim: sql<boolean>`NOT EXISTS (
          SELECT 1 FROM organization_admins oa
          WHERE oa.organization_id = ${organizations.id} AND oa.role = 'owner'
        )`,
        owner: {
          userId: sql<string | null>`CASE WHEN ${users.isMinor} = false THEN ${users.id} ELSE NULL END`,
          displayName: sql<string | null>`CASE WHEN ${users.isMinor} = true THEN 'Organization owner' ELSE ${users.name} END`,
          avatarUrl: sql<string | null>`CASE WHEN ${users.isMinor} = false THEN ${users.avatarUrl} ELSE NULL END`,
        },
      })
      .from(partnerOrganizationMemberships)
      .innerJoin(
        organizations,
        eq(organizations.id, partnerOrganizationMemberships.organizationId),
      )
      .leftJoin(
        organizationAdmins,
        and(
          eq(organizationAdmins.organizationId, organizations.id),
          eq(organizationAdmins.role, "owner"),
        ),
      )
      .leftJoin(users, eq(users.id, organizationAdmins.userId))
      .where(
        and(
          eq(partnerOrganizationMemberships.partnerPageId, page.id),
          eq(partnerOrganizationMemberships.visible, true),
        ),
      )
      .orderBy(
        sql`${partnerOrganizationMemberships.position} NULLS LAST`,
        asc(organizations.name),
        asc(partnerOrganizationMemberships.createdAt),
      );
    const orgIds = rows.map((row) => row.organization.id);
    const managedOrganizations = req.sessionUser && !req.isMasquerading
      ? await db
          .select({
            id: organizations.id,
            name: organizations.name,
            city: organizations.city,
            state: organizations.state,
          })
          .from(organizationAdmins)
          .innerJoin(organizations, eq(organizations.id, organizationAdmins.organizationId))
          .where(and(
            eq(organizationAdmins.userId, req.sessionUser.id),
            or(eq(organizationAdmins.role, "owner"), eq(organizationAdmins.role, "admin")),
            sql`EXISTS (
              SELECT 1 FROM organization_admins owner_admin
              WHERE owner_admin.organization_id = ${organizations.id}
                AND owner_admin.role = 'owner'
            )`,
            sql`NOT EXISTS (
              SELECT 1 FROM partner_organization_memberships existing_member
              WHERE existing_member.partner_page_id = ${page.id}
                AND existing_member.organization_id = ${organizations.id}
            )`,
          ))
          .orderBy(asc(organizations.name))
      : [];
    const pendingSwapRequests = req.sessionUser && !req.isMasquerading
      ? await db.select({
          sourceMembershipId: partnerDuplicateSwapRequests.sourceMembershipId,
          targetOrganizationId: partnerDuplicateSwapRequests.targetOrganizationId,
          status: partnerDuplicateSwapRequests.status,
        }).from(partnerDuplicateSwapRequests).where(and(
          eq(partnerDuplicateSwapRequests.partnerPageId, page.id),
          eq(partnerDuplicateSwapRequests.requestedByUserId, req.sessionUser.id),
        ))
      : [];
    const pendingBySource = new Map<string, (typeof pendingSwapRequests)[number]>();
    for (const request of pendingSwapRequests) {
      if (!pendingBySource.has(request.sourceMembershipId)) {
        pendingBySource.set(request.sourceMembershipId, request);
      }
    }
    const teamRows =
      orgIds.length > 0
        ? await db
            .select({
              id: teams.id,
              organizationId: teams.organizationId,
              name: teams.name,
            })
            .from(teams)
            .where(
              and(
                inArray(teams.organizationId, orgIds),
                sql`${teams.archivedAt} IS NULL`,
              ),
            )
            .orderBy(asc(teams.name))
        : [];
    return res.json({
      data: {
        page: {
          slug: page.slug,
          officialName: page.officialName,
          associationLabel: page.associationLabel,
          introduction: page.introduction,
          logoUrl: page.logoUrl,
          bannerUrl: page.bannerUrl,
          primaryColor: page.primaryColor,
          secondaryColor: page.secondaryColor,
        },
        competition: await featuredCompetition(page.id),
        competitions: await featuredCompetitions(page.id),
        organizations: rows.map((row) => ({
          ...row.organization,
          membershipId: row.membershipId,
          canRequestClaim: row.canRequestClaim,
          canRequestDuplicateSwap:
            Boolean(
              row.importOperationId &&
              row.importOperationId === row.importCreatedByOperationId,
            ) &&
            managedOrganizations.length > 0,
          duplicateSwapRequest: pendingBySource.get(row.membershipId) ?? null,
          owner:
            row.owner.displayName == null
              ? null
              : {
                  userId: row.owner.userId,
                  displayName: row.owner.displayName,
                  avatarUrl: row.owner.avatarUrl,
                },
          teams: teamRows
            .filter((team) => team.organizationId === row.organization.id)
            .map(({ id, name }) => ({ id, name })),
        })),
        duplicateSwapTargets: managedOrganizations,
      },
    });
  }),
);

router.post(
  "/partner-pages/:slug/duplicate-swap-requests",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Sign in before requesting a directory correction");
    if (req.isMasquerading) return apiError(res, 403, "Exit masquerade before requesting a directory correction");
    const slug = p(req.params.slug).toLowerCase();
    const sourceMembershipId = cleanText(req.body?.sourceMembershipId, 80);
    const targetOrganizationId = cleanText(req.body?.targetOrganizationId, 80);
    if (!sourceMembershipId || !targetOrganizationId) {
      return apiError(res, 400, "sourceMembershipId and targetOrganizationId are required");
    }
    const requestedKey = cleanText(req.body?.idempotencyKey, 160);
    const idempotencyKey = requestedKey || `duplicate-swap:${me.id}:${sourceMembershipId}:${targetOrganizationId}`;
    const result = await db.transaction(async (tx) => {
      const [page] = await tx.select({
        id: partnerLandingPages.id,
        slug: partnerLandingPages.slug,
        officialName: partnerLandingPages.officialName,
        associationLabel: partnerLandingPages.associationLabel,
        published: partnerLandingPages.published,
      }).from(partnerLandingPages).where(and(
        sql`lower(${partnerLandingPages.slug}) = ${slug}`,
        eq(partnerLandingPages.published, true),
      )).for("update").limit(1);
      if (!page) return { error: "Partner page not found" as const };
      const [replayed] = await tx.select().from(partnerDuplicateSwapRequests).where(and(
        eq(partnerDuplicateSwapRequests.partnerPageId, page.id),
        eq(partnerDuplicateSwapRequests.idempotencyKey, idempotencyKey),
      )).limit(1);
      if (replayed) {
        if (replayed.requestedByUserId !== me.id ||
          replayed.sourceMembershipId !== sourceMembershipId ||
          replayed.targetOrganizationId !== targetOrganizationId) {
          return { error: "Idempotency key was already used for a different duplicate swap request" as const };
        }
        return { request: replayed, created: false as const };
      }
      const [pending] = await tx.select().from(partnerDuplicateSwapRequests).where(and(
        eq(partnerDuplicateSwapRequests.partnerPageId, page.id),
        eq(partnerDuplicateSwapRequests.sourceMembershipId, sourceMembershipId),
        eq(partnerDuplicateSwapRequests.status, "pending"),
      )).orderBy(asc(partnerDuplicateSwapRequests.createdAt), asc(partnerDuplicateSwapRequests.id))
        .for("update").limit(1);
      if (pending) {
        if (pending.requestedByUserId === me.id && pending.targetOrganizationId === targetOrganizationId) {
          return { request: pending, created: false as const };
        }
        return {
          error: "A duplicate swap request is already pending for this directory slot" as const,
          pending,
        };
      }
      const [source] = await tx.select({
        membership: partnerOrganizationMemberships,
        organization: {
          id: organizations.id,
          name: organizations.name,
          partnerImportCreatedByOperationId: organizations.partnerImportCreatedByOperationId,
        },
      }).from(partnerOrganizationMemberships).innerJoin(
        organizations, eq(organizations.id, partnerOrganizationMemberships.organizationId),
      ).where(and(
        eq(partnerOrganizationMemberships.id, sourceMembershipId),
        eq(partnerOrganizationMemberships.partnerPageId, page.id),
        eq(partnerOrganizationMemberships.visible, true),
      )).for("update").limit(1);
      if (!source ||
        !source.membership.importOperationId ||
        source.membership.importOperationId !== source.organization.partnerImportCreatedByOperationId) {
        return { error: "This organization is not an eligible imported staging duplicate" as const };
      }
      const [target] = await tx.select({
        organization: organizations,
        adminRole: organizationAdmins.role,
      }).from(organizations).innerJoin(
        organizationAdmins,
        and(
          eq(organizationAdmins.organizationId, organizations.id),
          eq(organizationAdmins.userId, me.id),
          or(eq(organizationAdmins.role, "owner"), eq(organizationAdmins.role, "admin")),
        ),
      ).where(eq(organizations.id, targetOrganizationId)).for("update").limit(1);
      if (!target) return { error: "You must be an owner or admin of the target organization" as const };
      if (target.organization.id === source.organization.id) {
        return { error: "The target organization must be different from the staging duplicate" as const };
      }
      if (!credibleOrganizationCollision(source.organization.name, target.organization.name)) {
        return { error: "The selected organization is not a credible duplicate of this staging entry" as const };
      }
      const [targetOwner] = await tx.select({ id: organizationAdmins.userId }).from(organizationAdmins)
        .where(and(eq(organizationAdmins.organizationId, targetOrganizationId), eq(organizationAdmins.role, "owner")))
        .limit(1);
      if (!targetOwner) return { error: "The target organization must be established before requesting a swap" as const };
      const [alreadyIncluded] = await tx.select({ id: partnerOrganizationMemberships.id })
        .from(partnerOrganizationMemberships).where(and(
          eq(partnerOrganizationMemberships.partnerPageId, page.id),
          eq(partnerOrganizationMemberships.organizationId, targetOrganizationId),
        )).limit(1);
      if (alreadyIncluded) return { error: "The target organization is already on this partner page" as const };
      const [created] = await tx.insert(partnerDuplicateSwapRequests).values({
        partnerPageId: page.id,
        sourceMembershipId,
        sourceOrganizationId: source.organization.id,
        targetOrganizationId,
        requestedByUserId: me.id,
        idempotencyKey,
        pageSnapshot: {
          id: page.id,
          slug: page.slug,
          officialName: page.officialName,
          associationLabel: page.associationLabel,
        },
      }).returning();
      return { request: created, created: true as const, page, source, target: target.organization };
    });
    if ("error" in result) {
      const message = String(result.error ?? "Duplicate swap request failed");
      return apiError(res, /not found/i.test(message) ? 404 : 409, message, {
        extras: "pending" in result && result.pending ? { pendingRequest: result.pending } : undefined,
      });
    }
    if (!result.request) return apiError(res, 409, "A duplicate swap request could not be saved");
    if (result.created) {
      const [requester] = await db.select({ name: users.name }).from(users).where(eq(users.id, me.id)).limit(1);
      const admins = await db.select({ email: users.email, name: users.name }).from(users)
        .where(and(eq(users.role, "admin"), sql`${users.email} IS NOT NULL`, sql`${users.deletedAt} IS NULL`));
      const reviewUrl = `${appBaseUrl()}/app/admin/organizations?section=partner&edit=${encodeURIComponent(result.page.slug)}`;
      for (const admin of admins) {
        if (!admin.email) continue;
        try {
          await sendEmail({
            to: admin.email,
            subject: `Partner directory duplicate swap request: ${result.source.organization.name}`,
            kind: "partner_duplicate_swap_request",
            contextLabel: result.page.officialName,
            text: [
              `A partner directory swap request needs review.`,
              `Partner page: ${result.page.officialName} (${result.page.slug})`,
              `Displayed staging organization: ${result.source.organization.name}`,
              `Requested existing organization: ${result.target.name}`,
              `Requester: ${requester?.name ?? "Kinectem user"} (${me.email})`,
              `Review: ${reviewUrl}`,
            ].join("\n"),
          });
        } catch (err) {
          req.log.error({ err, requestId: result.request.id }, "Partner duplicate swap email failed after durable save");
        }
      }
    }
    return res.status(result.created ? 201 : 200).json({
      data: {
        id: result.request.id,
        status: result.request.status,
        sourceMembershipId: result.request.sourceMembershipId,
        targetOrganizationId: result.request.targetOrganizationId,
      },
    });
  }),
);

const duplicateSwapDecisionHandler = asyncHandler(async (req: any, res: any) => {
    const requestId = p(req.params.requestId);
    const decision = cleanText(req.body?.decision, 20).toLowerCase();
    if (decision !== "approved" && decision !== "denied") {
      return apiError(res, 400, "decision must be approved or denied");
    }
    const result = await db.transaction(async (tx) => {
      const [request] = await tx.select().from(partnerDuplicateSwapRequests)
        .where(eq(partnerDuplicateSwapRequests.id, requestId)).for("update").limit(1);
      if (!request) return { error: "Duplicate swap request not found" as const };
      const requestedStatus = decision === "approved" ? "approved" : "denied";
      if (request.status !== "pending") {
        if (request.status === requestedStatus) return { request, replayed: true as const };
        return { error: `Duplicate swap request is already ${request.status}` as const };
      }
      if (decision === "denied") {
        await tx.update(partnerDuplicateSwapRequests).set({
          status: "denied",
          decidedByUserId: req.realUser!.id,
          decidedAt: new Date(),
          updatedAt: new Date(),
        }).where(and(
          eq(partnerDuplicateSwapRequests.partnerPageId, request.partnerPageId),
          eq(partnerDuplicateSwapRequests.sourceMembershipId, request.sourceMembershipId),
          eq(partnerDuplicateSwapRequests.status, "pending"),
          sql`${partnerDuplicateSwapRequests.id} <> ${request.id}`,
        ));
        const [updated] = await tx.update(partnerDuplicateSwapRequests).set({
          status: "denied",
          decidedByUserId: req.realUser!.id,
          decidedAt: new Date(),
          updatedAt: new Date(),
        }).where(and(eq(partnerDuplicateSwapRequests.id, requestId), eq(partnerDuplicateSwapRequests.status, "pending"))).returning();
        return { request: updated, replayed: false as const, decision: "denied" as const };
      }
      const [page] = await tx.select({
        id: partnerLandingPages.id,
        published: partnerLandingPages.published,
        slug: partnerLandingPages.slug,
      }).from(partnerLandingPages).where(eq(partnerLandingPages.id, request.partnerPageId)).for("update").limit(1);
      const [source] = await tx.select({
        membership: partnerOrganizationMemberships,
        organization: {
          id: organizations.id,
          name: organizations.name,
          partnerImportCreatedByOperationId: organizations.partnerImportCreatedByOperationId,
        },
      }).from(partnerOrganizationMemberships).innerJoin(
        organizations, eq(organizations.id, partnerOrganizationMemberships.organizationId),
      ).where(and(
        eq(partnerOrganizationMemberships.id, request.sourceMembershipId),
        eq(partnerOrganizationMemberships.partnerPageId, request.partnerPageId),
      )).for("update").limit(1);
      const [target] = await tx.select({ id: organizations.id, name: organizations.name }).from(organizations)
        .where(eq(organizations.id, request.targetOrganizationId)).for("update").limit(1);
      const [requester] = await tx.select({
        id: users.id,
        deletedAt: users.deletedAt,
      }).from(users).where(eq(users.id, request.requestedByUserId)).for("update").limit(1);
      const authorityRows = await tx.select({
        userId: organizationAdmins.userId,
        role: organizationAdmins.role,
      }).from(organizationAdmins)
        .where(eq(organizationAdmins.organizationId, request.targetOrganizationId))
        .for("update");
      const requesterTargetRole = authorityRows.find((row) =>
        row.userId === request.requestedByUserId && (row.role === "owner" || row.role === "admin"));
      const targetOwner = authorityRows.find((row) => row.role === "owner");
      if (!page || !page.published || !source || !target ||
        !requester || requester.deletedAt || !requesterTargetRole || !targetOwner ||
        source.organization.id !== request.sourceOrganizationId ||
        source.membership.importOperationId !== source.organization.partnerImportCreatedByOperationId ||
        !source.membership.visible ||
        source.organization.id === target.id ||
        !credibleOrganizationCollision(source.organization.name, target.name)) {
        return { error: "Request is no longer valid for approval" as const };
      }
      const [targetMembership] = await tx.select({ id: partnerOrganizationMemberships.id })
        .from(partnerOrganizationMemberships).where(and(
          eq(partnerOrganizationMemberships.partnerPageId, request.partnerPageId),
          eq(partnerOrganizationMemberships.organizationId, target.id),
        )).limit(1);
      if (targetMembership) return { error: "Target organization is already on this partner page" as const };
      await tx.update(partnerDuplicateSwapRequests).set({
        status: "denied",
        decidedByUserId: req.realUser!.id,
        decidedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(
        eq(partnerDuplicateSwapRequests.partnerPageId, request.partnerPageId),
        eq(partnerDuplicateSwapRequests.sourceMembershipId, request.sourceMembershipId),
        eq(partnerDuplicateSwapRequests.status, "pending"),
        sql`${partnerDuplicateSwapRequests.id} <> ${request.id}`,
      ));
      const replacement = await replacePartnerMemberInTransaction(
        tx,
        request.partnerPageId,
        request.sourceMembershipId,
        request.targetOrganizationId,
        `duplicate-swap-request:${request.id}`,
      );
      if ("error" in replacement) return { error: replacement.error };
      const [updated] = await tx.update(partnerDuplicateSwapRequests).set({
        status: "approved",
        decidedByUserId: req.realUser!.id,
        decidedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(eq(partnerDuplicateSwapRequests.id, requestId), eq(partnerDuplicateSwapRequests.status, "pending"))).returning();
      return { request: updated, replacement, replayed: false as const, decision: "approved" as const };
    });
    if ("error" in result) {
      const message = String(result.error ?? "Duplicate swap decision failed");
      return apiError(res, /not found/i.test(message) ? 404 : 409, message);
    }
    if (result.replayed) return res.json({ data: result.request });
    const requesterLink = `/partners/${encodeURIComponent(String(result.request.pageSnapshot?.slug ?? ""))}`;
    try {
      await db.insert(notifications).values({
        userId: result.request.requestedByUserId,
        kind: "partner_duplicate_swap_decision",
        message: `Your partner directory duplicate swap request was ${result.request.status}.`,
        link: requesterLink,
        actorUserId: req.realUser!.id,
      });
      await dispatchNotificationEmail({
        userId: result.request.requestedByUserId,
        category: "team_roster",
        build: (ctx) => ({
          to: ctx.to,
          subject: `Partner directory swap request ${result.request.status}`,
          kind: "partner_duplicate_swap_decision",
          contextLabel: "Partner directory",
          text: [
            `Hi ${ctx.recipientName},`,
            "",
            `Your partner directory duplicate swap request was ${result.request.status}.`,
            "",
            `Review your partner directory requests: ${appBaseUrl()}${requesterLink}`,
            "",
            `Manage email preferences: ${ctx.unsubscribeUrl}`,
          ].join("\n"),
        }),
      });
    } catch (err) {
      req.log.error({ err, requestId }, "Partner duplicate swap outcome notification failed");
    }
    return res.json({ data: result.request, replacement: "replacement" in result ? result.replacement : null });
});

// Friendly aliases mirror the rest of the admin review API while the
// decision endpoint remains available for clients that send an explicit
// status.
router.post(
  "/admin/partner-duplicate-swap-requests/:requestId/approve",
  requireAdmin,
  (req, _res, next) => {
    req.body = { ...(req.body ?? {}), decision: "approved" };
    req.url = req.url.replace(/\/approve$/, "/decision");
    next();
  },
);
router.post(
  "/admin/partner-duplicate-swap-requests/:requestId/deny",
  requireAdmin,
  (req, _res, next) => {
    req.body = { ...(req.body ?? {}), decision: "denied" };
    req.url = req.url.replace(/\/deny$/, "/decision");
    next();
  },
);
router.post(
  "/admin/partner-duplicate-swap-requests/:requestId/decision",
  requireAdmin,
  duplicateSwapDecisionHandler,
);

router.post(
  "/partner-pages/:slug/organizations/:organizationId/admin-requests",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Create an account or sign in before requesting access");
    const slug = p(req.params.slug).toLowerCase();
    const organizationId = p(req.params.organizationId);
    const [target] = await db
      .select({
        pageId: partnerLandingPages.id,
        organizationId: organizations.id,
        organizationName: organizations.name,
        ownerUserId: organizationAdmins.userId,
      })
      .from(partnerLandingPages)
      .innerJoin(
        partnerOrganizationMemberships,
        eq(partnerOrganizationMemberships.partnerPageId, partnerLandingPages.id),
      )
      .innerJoin(
        organizations,
        eq(organizations.id, partnerOrganizationMemberships.organizationId),
      )
      .innerJoin(
        organizationAdmins,
        and(
          eq(organizationAdmins.organizationId, organizations.id),
          eq(organizationAdmins.role, "owner"),
        ),
      )
      .where(
        and(
          sql`lower(${partnerLandingPages.slug}) = ${slug}`,
          eq(partnerLandingPages.published, true),
          eq(partnerOrganizationMemberships.visible, true),
          eq(organizations.id, organizationId),
        ),
      )
      .limit(1);
    if (!target) {
      return apiError(res, 404, "Claimed organization is not available on this partner page");
    }

    const [myMembership] = await db
      .select({ role: organizationAdmins.role })
      .from(organizationAdmins)
      .where(
        and(
          eq(organizationAdmins.organizationId, organizationId),
          eq(organizationAdmins.userId, me.id),
        ),
      )
      .limit(1);
    if (myMembership?.role === "owner" || myMembership?.role === "admin") {
      return apiError(res, 409, "You already have administrator access");
    }

    const [requester] = await db
      .select({ name: users.name, isMinor: users.isMinor })
      .from(users)
      .where(eq(users.id, me.id))
      .limit(1);
    const requesterName =
      requester && !requester.isMinor ? requester.name : "A Kinectem user";

    const result = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(organizationJoinRequests)
        .values({
          organizationId,
          userId: me.id,
          status: "pending",
          requestedRole: "admin",
          sourcePartnerPageId: target.pageId,
        })
        .onConflictDoNothing()
        .returning();
      if (!created) {
        const [existing] = await tx
          .select()
          .from(organizationJoinRequests)
          .where(
            and(
              eq(organizationJoinRequests.organizationId, organizationId),
              eq(organizationJoinRequests.userId, me.id),
              eq(organizationJoinRequests.status, "pending"),
            ),
          )
          .limit(1);
        return { request: existing, created: false };
      }
      await tx.insert(notifications).values({
        userId: target.ownerUserId,
        kind: "org_admin_access_request",
        message: `${requesterName} requested admin access to ${target.organizationName}`,
        link: `/organizations/${organizationId}`,
        actorUserId: me.id,
      });
      return { request: created, created: true };
    });
    if (!result.request) {
      return apiError(res, 409, "A pending access request already exists");
    }

    if (result.created) {
      await dispatchNotificationEmail({
        userId: target.ownerUserId,
        category: "team_roster",
        excludeRecipientUserId: me.id,
        build: (ctx) => ({
          to: ctx.to,
          subject: `${requesterName} requested admin access to ${target.organizationName}`,
          kind: "org_admin_access_request",
          contextLabel: target.organizationName,
          text: [
            `Hi ${ctx.recipientName},`,
            "",
            `${requesterName} requested administrator access to ${target.organizationName} after finding the club on its partner page.`,
            "",
            `Review the request: ${appBaseUrl()}/app/organizations/${organizationId}`,
            "",
            `Manage email preferences: ${ctx.unsubscribeUrl}`,
          ].join("\n"),
        }),
      });
    }

    return res.status(result.created ? 201 : 200).json({
      data: {
        id: result.request.id,
        status: result.request.status,
        requestedRole: result.request.requestedRole,
      },
    });
  }),
);

router.post(
  "/partner-pages/:slug/claims",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Sign in before requesting access");
    const slug = p(req.params.slug).toLowerCase();
    const organizationId = cleanText(req.body?.organizationId, 80);
    const submittedOrganizationName = cleanText(
      req.body?.organizationName,
      200,
    );
    const requesterFullName = cleanText(req.body?.fullName, 200);
    const requesterTitle = cleanText(req.body?.title, 200);
    if (!submittedOrganizationName || !requesterFullName || !requesterTitle) {
      return apiError(
        res,
        400,
        "Organization name, full name, and title are required",
      );
    }
    if (
      req.body?.confirmCorrect !== true ||
      req.body?.confirmAuthorized !== true
    ) {
      return apiError(
        res,
        400,
        "Confirm the organization and your authorization before submitting",
      );
    }
    const [target] = await db
      .select({
        pageId: partnerLandingPages.id,
        partnerName: partnerLandingPages.officialName,
        organizationName: organizations.name,
        organizationLogoUrl: organizations.logoUrl,
        organizationCity: organizations.city,
        organizationState: organizations.state,
      })
      .from(partnerLandingPages)
      .innerJoin(
        partnerOrganizationMemberships,
        eq(
          partnerOrganizationMemberships.partnerPageId,
          partnerLandingPages.id,
        ),
      )
      .innerJoin(
        organizations,
        eq(organizations.id, partnerOrganizationMemberships.organizationId),
      )
      .where(
        and(
          sql`lower(${partnerLandingPages.slug}) = ${slug}`,
          eq(partnerLandingPages.published, true),
          eq(partnerOrganizationMemberships.visible, true),
          eq(organizations.id, organizationId),
        ),
      )
      .limit(1);
    if (!target)
      return apiError(
        res,
        404,
        "Organization is not available on this partner page",
      );
    if (
      normalizedOrganizationName(submittedOrganizationName) !==
      normalizedOrganizationName(target.organizationName)
    ) {
      return apiError(
        res,
        400,
        `Enter "${target.organizationName}" to confirm the selected organization`,
      );
    }
    const [owner] = await db
      .select({ userId: organizationAdmins.userId })
      .from(organizationAdmins)
      .where(
        and(
          eq(organizationAdmins.organizationId, organizationId),
          eq(organizationAdmins.role, "owner"),
        ),
      )
      .limit(1);
    if (owner)
      return apiError(res, 409, "This organization already has an owner");
    const [existing] = await db
      .select({ id: organizationClaimRequests.id })
      .from(organizationClaimRequests)
      .where(
        and(
          eq(organizationClaimRequests.organizationId, organizationId),
          eq(organizationClaimRequests.requestedByUserId, me.id),
          eq(organizationClaimRequests.status, "pending"),
        ),
      )
      .limit(1);
    if (existing)
      return apiError(
        res,
        409,
        "You already have a pending request for this organization",
      );
    const [claim] = await db
      .insert(organizationClaimRequests)
      .values({
        organizationId,
        requestedByUserId: me.id,
        submittedOrganizationName,
        requesterFullName,
        requesterTitle,
        sourcePartnerPageId: target.pageId,
      })
      .returning();
    const submittedAt = claim.createdAt.toISOString();
    const reviewUrl = `${appBaseUrl()}/app/admin/moderation?tab=org-claims&claimId=${claim.id}`;
    try {
      await sendEmail({
        to: "competitions@kinectem.com",
        subject: `Partner club claim request: ${target.organizationName}`,
        kind: "partner_org_claim_request",
        contextLabel: target.organizationName,
        text: [
          `Organization: ${target.organizationName}`,
          `Submitted organization name: ${submittedOrganizationName}`,
          `Requester: ${requesterFullName}`,
          `Title: ${requesterTitle}`,
          `Account email: ${me.email}`,
          `Partner page: ${target.partnerName} (${slug})`,
          `Submitted: ${submittedAt}`,
          `Review: ${reviewUrl}`,
        ].join("\n"),
      });
    } catch (err) {
      req.log.error(
        { err, claimId: claim.id },
        "Partner organization claim email failed after durable save",
      );
    }
    return res.status(201).json({
      data: {
        id: claim.id,
        status: claim.status,
        organizationName: target.organizationName,
        partnerName: target.partnerName,
        submittedAt,
      },
    });
  }),
);

export default router;
