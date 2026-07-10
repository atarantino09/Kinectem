// Task #723 — Competition Organizer hub ("parent company") routes.
//
// Hand-written Express routes + local Zod, mirroring tournaments.ts: these
// endpoints are NOT in the locked openapi.yaml; the client calls them via
// `customFetch`. An organizer is a branded home base owned by ONE user that
// groups the competitions they run.

import { Router, type IRouter } from "express";
import {
  db,
  competitionOrganizers,
  organizerFollowers,
  tournaments,
  tournamentMatches,
  tournamentParticipants,
  articles,
  teams,
} from "@workspace/db";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { rateLimit, ipKey } from "../middlewares/rate-limit";
import { requireAuth } from "../lib/auth";
import { apiError, MAX_IMAGE_DATA_URL_LENGTH } from "../lib/spec-helpers";

const router: IRouter = Router();

const ONE_HOUR = 60 * 60 * 1000;

const organizerWriteLimiter = rateLimit({
  name: "organizer-write",
  windowMs: ONE_HOUR,
  max: 60,
  keys: (req) => [ipKey(req)],
  message: "Too many organizer changes. Please wait a moment and try again.",
});

// Same slug strategy as competitions: name + short random suffix so two
// same-named companies never collide on the unique slug.
function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const suffix = randomBytes(4).toString("hex");
  return base ? `${base}-${suffix}` : suffix;
}

type SessionUserLike = { id: string; role: string };

function canOperateOrganizer(
  me: SessionUserLike,
  organizer: { ownerUserId: string },
): boolean {
  return me.role === "admin" || organizer.ownerUserId === me.id;
}

// Validators — mirror tournaments.ts branding rules.
const BrandColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "brandColor must be a #rrggbb hex color");

const HttpUrl = z
  .string()
  .trim()
  .max(2000)
  .regex(/^https?:\/\//, "Must be an http(s) URL");

const ImageUrl = z.union([
  HttpUrl,
  z
    .string()
    .max(MAX_IMAGE_DATA_URL_LENGTH)
    .regex(/^data:image\//, "Must be an image data: URL"),
]);

function organizerToJson(o: typeof competitionOrganizers.$inferSelect) {
  return {
    id: o.id,
    slug: o.slug,
    name: o.name,
    description: o.description,
    logoUrl: o.logoUrl,
    brandColor: o.brandColor,
    secondaryColor: o.secondaryColor,
    tertiaryColor: o.tertiaryColor,
    bannerUrl: o.bannerUrl,
    websiteUrl: o.websiteUrl,
    createdAt: o.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// POST /organizers — any signed-in user creates an organizer home base and
// becomes its owner. Multiple organizers per user are allowed (a person may
// run more than one event company), though one is the common case.
// ---------------------------------------------------------------------------

const CreateOrganizerBody = z.object({
  name: z.string().trim().min(1, "Organizer name is required").max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  websiteUrl: HttpUrl.optional().nullable(),
});

router.post(
  "/organizers",
  requireAuth,
  organizerWriteLimiter,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const parsed = CreateOrganizerBody.safeParse(req.body);
    if (!parsed.success) {
      const first = parsed.error.errors[0];
      return apiError(res, 400, first?.message ?? "Invalid organizer details.", {
        code: "VALIDATION_FAILED",
        extras: { fields: parsed.error.flatten().fieldErrors },
      });
    }
    const body = parsed.data;
    const [row] = await db
      .insert(competitionOrganizers)
      .values({
        slug: slugify(body.name),
        name: body.name,
        description: body.description ?? null,
        websiteUrl: body.websiteUrl ?? null,
        ownerUserId: me.id,
      })
      .returning();
    res.status(201).json(organizerToJson(row));
  }),
);

// ---------------------------------------------------------------------------
// GET /my/organizers — organizers the signed-in user owns, each with a
// competition count (for the hub card on the competitions page).
// ---------------------------------------------------------------------------

router.get(
  "/my/organizers",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const rows = await db
      .select()
      .from(competitionOrganizers)
      .where(eq(competitionOrganizers.ownerUserId, me.id))
      .orderBy(desc(competitionOrganizers.createdAt));
    const counts = rows.length
      ? await db
          .select({
            organizerId: tournaments.organizerId,
            n: sql<number>`count(*)::int`,
          })
          .from(tournaments)
          .where(
            inArray(
              tournaments.organizerId,
              rows.map((r) => r.id),
            ),
          )
          .groupBy(tournaments.organizerId)
      : [];
    const countById = new Map(counts.map((c) => [c.organizerId, c.n]));
    res.json({
      data: rows.map((o) => ({
        ...organizerToJson(o),
        competitionCount: countById.get(o.id) ?? 0,
      })),
    });
  }),
);

// ---------------------------------------------------------------------------
// PATCH /organizers/:id — owner/platform-admin edits details + branding.
// ---------------------------------------------------------------------------

const UpdateOrganizerBody = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  logoUrl: ImageUrl.nullable().optional(),
  brandColor: BrandColor.nullable().optional(),
  secondaryColor: BrandColor.nullable().optional(),
  tertiaryColor: BrandColor.nullable().optional(),
  bannerUrl: ImageUrl.nullable().optional(),
  websiteUrl: HttpUrl.nullable().optional(),
});

router.patch(
  "/organizers/:id",
  requireAuth,
  organizerWriteLimiter,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");

    // Friendly 413 for over-cap inline images before Zod (mirrors the
    // competition PATCH) — the global JSON parser already allows big bodies
    // only on routes that opt in, so this is a defensive message.
    for (const key of ["logoUrl", "bannerUrl"] as const) {
      const v = (req.body as Record<string, unknown>)?.[key];
      if (
        typeof v === "string" &&
        v.startsWith("data:image/") &&
        v.length > MAX_IMAGE_DATA_URL_LENGTH
      ) {
        return apiError(res, 413, "That image is too large. Try a smaller file.");
      }
    }

    const [organizer] = await db
      .select()
      .from(competitionOrganizers)
      .where(eq(competitionOrganizers.id, req.params.id))
      .limit(1);
    if (!organizer) return apiError(res, 404, "Organizer not found");
    if (!canOperateOrganizer(me, organizer)) {
      return apiError(res, 403, "Only the organizer owner can edit it");
    }

    const parsed = UpdateOrganizerBody.safeParse(req.body);
    if (!parsed.success) {
      const first = parsed.error.errors[0];
      return apiError(res, 400, first?.message ?? "Invalid organizer details.", {
        code: "VALIDATION_FAILED",
        extras: { fields: parsed.error.flatten().fieldErrors },
      });
    }
    const body = parsed.data;
    const [updated] = await db
      .update(competitionOrganizers)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.logoUrl !== undefined ? { logoUrl: body.logoUrl } : {}),
        ...(body.brandColor !== undefined ? { brandColor: body.brandColor } : {}),
        ...(body.secondaryColor !== undefined
          ? { secondaryColor: body.secondaryColor }
          : {}),
        ...(body.tertiaryColor !== undefined
          ? { tertiaryColor: body.tertiaryColor }
          : {}),
        ...(body.bannerUrl !== undefined ? { bannerUrl: body.bannerUrl } : {}),
        ...(body.websiteUrl !== undefined ? { websiteUrl: body.websiteUrl } : {}),
        updatedAt: new Date(),
      })
      .where(eq(competitionOrganizers.id, organizer.id))
      .returning();
    res.json(organizerToJson(updated));
  }),
);

// ---------------------------------------------------------------------------
// POST /organizers/:id/competitions — attach or detach an owned competition.
// Body: { competitionId, attach }. Caller must be able to operate BOTH the
// organizer and the competition (owner or platform admin).
// ---------------------------------------------------------------------------

const AttachBody = z.object({
  competitionId: z.string().uuid(),
  attach: z.boolean(),
});

router.post(
  "/organizers/:id/competitions",
  requireAuth,
  organizerWriteLimiter,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const parsed = AttachBody.safeParse(req.body);
    if (!parsed.success) {
      return apiError(res, 400, "Invalid request body", {
        code: "VALIDATION_FAILED",
      });
    }
    const [organizer] = await db
      .select()
      .from(competitionOrganizers)
      .where(eq(competitionOrganizers.id, req.params.id))
      .limit(1);
    if (!organizer) return apiError(res, 404, "Organizer not found");
    if (!canOperateOrganizer(me, organizer)) {
      return apiError(res, 403, "Only the organizer owner can manage its competitions");
    }
    const [competition] = await db
      .select()
      .from(tournaments)
      .where(eq(tournaments.id, parsed.data.competitionId))
      .limit(1);
    if (!competition) return apiError(res, 404, "Competition not found");
    const compOwner = competition.ownerUserId ?? competition.createdById;
    if (me.role !== "admin" && compOwner !== me.id) {
      return apiError(res, 403, "You can only attach competitions you own");
    }
    if (
      !parsed.data.attach &&
      competition.organizerId !== organizer.id
    ) {
      // Detach is scoped to THIS organizer — a stale client can't detach a
      // competition that has since moved to another hub.
      return apiError(res, 409, "That competition is not attached to this organizer");
    }
    await db
      .update(tournaments)
      .set({
        organizerId: parsed.data.attach ? organizer.id : null,
        updatedAt: new Date(),
      })
      .where(eq(tournaments.id, competition.id));
    res.json({ ok: true, attached: parsed.data.attach });
  }),
);

// ---------------------------------------------------------------------------
// GET /organizers/:slug — PUBLIC hub read: organizer branding + its
// competitions grouped by status + featured recaps pulled from across them.
// ---------------------------------------------------------------------------

router.get(
  "/organizers/:slug",
  asyncHandler(async (req, res) => {
    const [organizer] = await db
      .select()
      .from(competitionOrganizers)
      .where(eq(competitionOrganizers.slug, req.params.slug))
      .limit(1);
    if (!organizer) return apiError(res, 404, "Organizer not found");

    // Viewer follow state for the Follow button. Logged-out → false.
    const viewerId = req.sessionUser?.id ?? null;
    const isFollowing = viewerId
      ? (
          await db
            .select({ userId: organizerFollowers.userId })
            .from(organizerFollowers)
            .where(
              and(
                eq(organizerFollowers.organizerId, organizer.id),
                eq(organizerFollowers.userId, viewerId),
              ),
            )
            .limit(1)
        ).length > 0
      : false;

    const comps = await db
      .select()
      .from(tournaments)
      .where(eq(tournaments.organizerId, organizer.id))
      .orderBy(desc(tournaments.startDate));

    const compIds = comps.map((c) => c.id);
    const today = new Date().toISOString().slice(0, 10);

    // Per-competition counts in two grouped queries (not N+1).
    const matchCounts = compIds.length
      ? await db
          .select({
            id: tournamentMatches.tournamentId,
            n: sql<number>`count(*)::int`,
          })
          .from(tournamentMatches)
          .where(inArray(tournamentMatches.tournamentId, compIds))
          .groupBy(tournamentMatches.tournamentId)
      : [];
    const participantCounts = compIds.length
      ? await db
          .select({
            id: tournamentParticipants.tournamentId,
            n: sql<number>`count(*)::int`,
          })
          .from(tournamentParticipants)
          .where(inArray(tournamentParticipants.tournamentId, compIds))
          .groupBy(tournamentParticipants.tournamentId)
      : [];
    const matchCountById = new Map(matchCounts.map((r) => [r.id, r.n]));
    const participantCountById = new Map(
      participantCounts.map((r) => [r.id, r.n]),
    );

    // Cross-competition featured recap rail — newest first, capped.
    const featuredRows = compIds.length
      ? await db
          .select({
            article: articles,
            teamName: teams.name,
            competitionId: articles.competitionId,
          })
          .from(articles)
          .innerJoin(teams, eq(teams.id, articles.teamId))
          .where(
            and(
              inArray(articles.competitionId, compIds),
              eq(articles.featured, true),
              eq(articles.status, "published"),
              isNull(articles.hiddenAt),
            ),
          )
          .orderBy(desc(articles.createdAt))
          .limit(12)
      : [];
    const compById = new Map(comps.map((c) => [c.id, c]));

    res.json({
      organizer: { ...organizerToJson(organizer), isFollowing },
      competitions: comps.map((c) => ({
        id: c.id,
        slug: c.slug,
        name: c.name,
        type: c.type,
        startDate: c.startDate,
        endDate: c.endDate,
        location: c.location,
        logoUrl: c.logoUrl,
        brandColor: c.brandColor,
        // Same status semantics as the competition page.
        isActive: today >= c.startDate && today <= c.endDate,
        isEnded: today > c.endDate,
        matchCount: matchCountById.get(c.id) ?? 0,
        participantCount: participantCountById.get(c.id) ?? 0,
      })),
      featuredRecaps: featuredRows.map(({ article: a, teamName, competitionId }) => ({
        id: `article-${a.id}`,
        title: a.title,
        summary: a.summary,
        coverImageUrl: a.coverImageUrl,
        gameDate: a.gameDate,
        opponentName: a.opponentName,
        teamScore: a.teamScore,
        opponentScore: a.opponentScore,
        teamId: a.teamId,
        teamName,
        publishedAt: a.publishedAt,
        competitionName: competitionId
          ? (compById.get(competitionId)?.name ?? null)
          : null,
        // Mini competition brand strip on the recap card (mirrors the
        // PostCard competition banner, just compact).
        competition: (() => {
          const comp = competitionId ? compById.get(competitionId) : undefined;
          return comp
            ? {
                slug: comp.slug,
                name: comp.name,
                logoUrl: comp.logoUrl,
                brandColor: comp.brandColor,
                secondaryColor: comp.secondaryColor,
              }
            : null;
        })(),
      })),
    });
  }),
);

// ---------------------------------------------------------------------------
// Organizer follows — quick access only, intentionally NOT a feed source.
// Mirrors competition follows (tournaments.ts).
// ---------------------------------------------------------------------------

// POST /organizers/:slug/follow — idempotent (conflict → no-op).
router.post(
  "/organizers/:slug/follow",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [organizer] = await db
      .select({ id: competitionOrganizers.id })
      .from(competitionOrganizers)
      .where(eq(competitionOrganizers.slug, req.params.slug))
      .limit(1);
    if (!organizer) return apiError(res, 404, "Organizer not found");
    await db
      .insert(organizerFollowers)
      .values({ organizerId: organizer.id, userId: me.id })
      .onConflictDoNothing();
    res.json({ ok: true, isFollowing: true });
  }),
);

// DELETE /organizers/:slug/follow — idempotent.
router.delete(
  "/organizers/:slug/follow",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [organizer] = await db
      .select({ id: competitionOrganizers.id })
      .from(competitionOrganizers)
      .where(eq(competitionOrganizers.slug, req.params.slug))
      .limit(1);
    if (!organizer) return apiError(res, 404, "Organizer not found");
    await db
      .delete(organizerFollowers)
      .where(
        and(
          eq(organizerFollowers.organizerId, organizer.id),
          eq(organizerFollowers.userId, me.id),
        ),
      );
    res.json({ ok: true, isFollowing: false });
  }),
);

// GET /my/followed-organizers — quick-access list for the feed sidebar.
router.get(
  "/my/followed-organizers",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const rows = await db
      .select({
        id: competitionOrganizers.id,
        slug: competitionOrganizers.slug,
        name: competitionOrganizers.name,
        logoUrl: competitionOrganizers.logoUrl,
        brandColor: competitionOrganizers.brandColor,
        followedAt: organizerFollowers.createdAt,
      })
      .from(organizerFollowers)
      .innerJoin(
        competitionOrganizers,
        eq(competitionOrganizers.id, organizerFollowers.organizerId),
      )
      .where(eq(organizerFollowers.userId, me.id))
      .orderBy(desc(organizerFollowers.createdAt));
    res.json({ data: rows });
  }),
);

export default router;
