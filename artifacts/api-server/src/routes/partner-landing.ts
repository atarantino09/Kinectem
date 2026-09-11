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
  partnerLandingPages,
  partnerOrganizationMemberships,
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

function normalizedOrganizationName(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
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
      asc(organizations.name),
      asc(partnerOrganizationMemberships.createdAt),
    );
  return rows.map((row) => ({
    id: row.membership.id,
    visible: row.membership.visible,
    sourceColumn: row.membership.sourceColumn,
    importOperationId: row.membership.importOperationId,
    createdAt: row.membership.createdAt.toISOString(),
    organization: row.organization,
    hasOwner: row.hasOwner,
    teamCount: Number(row.teamCount),
    contentCount: Number(row.contentCount),
    duplicateName: Number(row.duplicateCount) > 1,
    canDeleteStaleImport: !row.hasOwner && Number(row.contentCount) === 0,
  }));
}

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
    const existing =
      names.length > 0
        ? await db
            .select({
              id: organizations.id,
              name: organizations.name,
              city: organizations.city,
              state: organizations.state,
              location: organizations.location,
            })
            .from(organizations)
            .where(
              or(
                ...names.map(
                  (name: string) =>
                    sql`lower(${organizations.name}) = ${name.toLowerCase()}`,
                ),
              ),
            )
        : [];
    const seen = new Map<string, number>();
    const rows = input.map((raw: unknown, index: number) => {
      const row = raw as { name?: unknown; sourceColumn?: unknown };
      const name = names[index] ?? "";
      const key = normalizedOrganizationName(name);
      const duplicateInFile = seen.has(key);
      if (key && !seen.has(key)) seen.set(key, index);
      return {
        index,
        sourceColumn: cleanText(row.sourceColumn, 200) || `Column ${index + 1}`,
        name,
        warnings: [
          ...(duplicateInFile
            ? [
                "This name appears more than once in the upload. A separate organization will be created by default.",
              ]
            : []),
          ...(existing.some(
            (item) => normalizedOrganizationName(item.name) === key,
          )
            ? [
                "Possible existing organization found. Creating a separate record remains the default.",
              ]
            : []),
        ],
        possibleMatches: existing.filter(
          (item) => normalizedOrganizationName(item.name) === key,
        ),
      };
    });
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
    const result = await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${"partner-import:" + pageId + ":" + idempotencyKey}))`,
      );
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
        };
        if (row.action === "skip") continue;
        let organizationId = cleanText(row.existingOrganizationId, 80);
        if (row.action !== "attach" || !organizationId) {
          const name = cleanText(row.name, 200);
          if (!name)
            throw new Error(`Organization ${index + 1}: name required`);
          const [org] = await tx
            .insert(organizations)
            .values({
              name,
              location: cleanText(row.location, 200) || null,
              city: cleanText(row.city, 120) || null,
              state: cleanText(row.state, 2).toUpperCase() || null,
              claimToken: generateToken(),
            })
            .returning({ id: organizations.id });
          organizationId = org.id;
          const teamNames = Array.isArray(row.teams)
            ? row.teams
                .map((v) => cleanText(v, 200))
                .filter(Boolean)
                .slice(0, 100)
            : [];
          for (const teamName of teamNames) {
            await tx.insert(teams).values({ organizationId, name: teamName });
          }
        } else {
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
        const [membership] = await tx
          .insert(partnerOrganizationMemberships)
          .values({
            partnerPageId: pageId,
            organizationId,
            sourceColumn:
              cleanText(row.sourceColumn, 200) || `Column ${index + 1}`,
            importOperationId: operation.id,
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
    return res.status(result.replayed ? 200 : 201).json({ data: result });
  }),
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
    const [row] = await db
      .select({
        organizationId: partnerOrganizationMemberships.organizationId,
        importOperationId: partnerOrganizationMemberships.importOperationId,
        name: organizations.name,
        ownerCount: sql<number>`(SELECT count(*) FROM organization_admins oa WHERE oa.organization_id = ${organizations.id} AND oa.role = 'owner')::int`,
        otherMembershipCount: sql<number>`(
          SELECT count(*) FROM partner_organization_memberships pom
          WHERE pom.organization_id = ${organizations.id}
            AND pom.id <> ${partnerOrganizationMemberships.id}
        )::int`,
        pendingClaimCount: sql<number>`(
          SELECT count(*) FROM organization_claim_requests ocr
          WHERE ocr.organization_id = ${organizations.id}
            AND ocr.status = 'pending'
        )::int`,
        contentCount: sql<number>`(
          (SELECT count(*) FROM org_posts op WHERE op.organization_id = ${organizations.id}) +
          (SELECT count(*) FROM articles a JOIN teams t ON t.id = a.team_id WHERE t.organization_id = ${organizations.id}) +
          (SELECT count(*) FROM highlights h JOIN teams t ON t.id = h.team_id WHERE t.organization_id = ${organizations.id})
        )::int`,
      })
      .from(partnerOrganizationMemberships)
      .innerJoin(
        organizations,
        eq(organizations.id, partnerOrganizationMemberships.organizationId),
      )
      .where(
        and(
          eq(partnerOrganizationMemberships.id, membershipId),
          eq(partnerOrganizationMemberships.partnerPageId, pageId),
        ),
      )
      .limit(1);
    if (!row) return apiError(res, 404, "Partner membership not found");
    if (!row.importOperationId) {
      return apiError(
        res,
        409,
        "Only organizations created by a partner import can be deleted here. Remove it from the page instead.",
      );
    }
    if (Number(row.otherMembershipCount) > 0) {
      return apiError(
        res,
        409,
        "This organization is included on another partner page and cannot be deleted. Remove it from this page instead.",
      );
    }
    if (Number(row.pendingClaimCount) > 0) {
      return apiError(
        res,
        409,
        "This organization has a pending ownership request and cannot be deleted. Hide or remove it from the page instead.",
      );
    }
    if (Number(row.ownerCount) > 0 || Number(row.contentCount) > 0) {
      return apiError(
        res,
        409,
        "Claimed or content-bearing organizations cannot be deleted here. Hide or remove it from the page instead.",
      );
    }
    if (cleanText(req.body?.confirmName, 200) !== row.name) {
      return apiError(
        res,
        400,
        "Type the organization name exactly to confirm deletion",
      );
    }
    await db
      .delete(organizations)
      .where(eq(organizations.id, row.organizationId));
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
      .orderBy(asc(organizations.name));
    const orgIds = rows.map((row) => row.organization.id);
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
          canRequestClaim: row.canRequestClaim,
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
      },
    });
  }),
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
