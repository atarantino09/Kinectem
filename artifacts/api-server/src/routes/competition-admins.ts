// Task #745 — multi-admin management for organizer hubs + competitions.
//
// Hand-written Express routes + local Zod (NOT in the locked openapi.yaml;
// the client calls them via `customFetch`). Two membership tables back this:
// organizer_admins (hub-wide rights over all attached competitions, including
// later-attached ones) and competition_admins (single competition). Rules:
//   - list admins / add admin / invite by email: any admin or the owner
//   - remove admin / withdraw is open to managers; ONLY the owner (or a
//     platform admin) can remove admins, and the owner is never removable
//   - minors can never be admins (COPPA): blocked on add, on invite-accept,
//     and excluded from the user-search picker
// Email invites mirror organization-invites.ts: token SHA-256 hashed at rest,
// 14-day TTL, dedupe-pending 409, best-effort email + acceptUrl fallback,
// rotate-link endpoint, lazy expiry, idempotent accept.

import { Router, type IRouter } from "express";
import {
  db,
  users,
  tournaments,
  competitionOrganizers,
  competitionAdmins,
  organizerAdmins,
  competitionAdminInvites,
} from "@workspace/db";
import { and, desc, eq, ilike, isNull, or } from "drizzle-orm";
import { asyncHandler } from "../lib/async-handler";
import { generateToken, hashToken } from "../lib/passwords";
import { rateLimit, ipKey } from "../middlewares/rate-limit";
import { requireAuth } from "../lib/auth";
import {
  buildCompetitionAdminInviteUrl,
  sendCompetitionAdminInviteEmail,
} from "../lib/email";
import {
  canOperateCompetition,
  canOperateOrganizer,
} from "../lib/competition-permissions";
import { apiError, displayName, notFound, safeAvatarUrl } from "../lib/spec-helpers";

const router: IRouter = Router();

const INVITE_TTL_DAYS = 14;

type DbInviteStatus = "pending" | "accepted" | "expired" | "revoked";
type WireInviteStatus = "pending" | "accepted" | "expired" | "withdrawn";

function toWireStatus(s: DbInviteStatus): WireInviteStatus {
  return s === "revoked" ? "withdrawn" : (s as WireInviteStatus);
}

type SessionUserLike = { id: string; role: string };

// Resolved management target — a hub or a competition. Keeps every handler
// below shared between the two kinds.
type Target =
  | {
      kind: "hub";
      id: string;
      name: string;
      ownerUserId: string;
      row: typeof competitionOrganizers.$inferSelect;
    }
  | {
      kind: "competition";
      id: string;
      name: string;
      ownerUserId: string | null;
      row: typeof tournaments.$inferSelect;
    };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveTarget(
  kind: "hub" | "competition",
  id: string,
): Promise<Target | null> {
  // Guard: a malformed id would make the uuid-typed query throw a raw 500.
  if (!UUID_RE.test(id)) return null;
  if (kind === "hub") {
    const [o] = await db
      .select()
      .from(competitionOrganizers)
      .where(eq(competitionOrganizers.id, id))
      .limit(1);
    if (!o) return null;
    return { kind, id: o.id, name: o.name, ownerUserId: o.ownerUserId, row: o };
  }
  const [t] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, id))
    .limit(1);
  if (!t) return null;
  return {
    kind,
    id: t.id,
    name: t.name,
    ownerUserId: t.ownerUserId ?? t.createdById,
    row: t,
  };
}

async function canManageTarget(me: SessionUserLike, target: Target): Promise<boolean> {
  return target.kind === "hub"
    ? canOperateOrganizer(me, target.row)
    : canOperateCompetition(me, target.row);
}

function isTargetOwner(me: SessionUserLike, target: Target): boolean {
  return me.role === "admin" || (target.ownerUserId != null && target.ownerUserId === me.id);
}

async function listAdminRows(target: Target) {
  if (target.kind === "hub") {
    return db
      .select({ userId: organizerAdmins.userId, createdAt: organizerAdmins.createdAt, u: users })
      .from(organizerAdmins)
      .innerJoin(users, eq(users.id, organizerAdmins.userId))
      .where(eq(organizerAdmins.organizerId, target.id))
      .orderBy(desc(organizerAdmins.createdAt));
  }
  return db
    .select({ userId: competitionAdmins.userId, createdAt: competitionAdmins.createdAt, u: users })
    .from(competitionAdmins)
    .innerJoin(users, eq(users.id, competitionAdmins.userId))
    .where(eq(competitionAdmins.competitionId, target.id))
    .orderBy(desc(competitionAdmins.createdAt));
}

async function isExistingAdmin(target: Target, userId: string): Promise<boolean> {
  if (target.kind === "hub") {
    const [row] = await db
      .select({ userId: organizerAdmins.userId })
      .from(organizerAdmins)
      .where(and(eq(organizerAdmins.organizerId, target.id), eq(organizerAdmins.userId, userId)))
      .limit(1);
    return !!row;
  }
  const [row] = await db
    .select({ userId: competitionAdmins.userId })
    .from(competitionAdmins)
    .where(and(eq(competitionAdmins.competitionId, target.id), eq(competitionAdmins.userId, userId)))
    .limit(1);
  return !!row;
}

async function insertAdmin(target: Target, userId: string, grantedById: string) {
  if (target.kind === "hub") {
    await db
      .insert(organizerAdmins)
      .values({ organizerId: target.id, userId, grantedById })
      .onConflictDoNothing();
    return;
  }
  await db
    .insert(competitionAdmins)
    .values({ competitionId: target.id, userId, grantedById })
    .onConflictDoNothing();
}

function adminMemberJson(u: typeof users.$inferSelect, isOwner: boolean, since: Date | null) {
  return {
    userId: u.id,
    displayName: displayName(u),
    email: u.email ?? null,
    avatarUrl: safeAvatarUrl(u.avatarUrl),
    isOwner,
    since: since ? since.toISOString() : null,
  };
}

function inviteJson(
  i: typeof competitionAdminInvites.$inferSelect,
  inviter: Pick<typeof users.$inferSelect, "id" | "name"> | null,
) {
  return {
    id: i.id,
    invitedEmail: i.invitedEmail,
    status: toWireStatus(i.status as DbInviteStatus),
    invitedBy: inviter
      ? { id: inviter.id, displayName: displayName(inviter) }
      : null,
    createdAt: i.createdAt.toISOString(),
    expiresAt: i.expiresAt ? i.expiresAt.toISOString() : null,
  };
}

// Route paths for the two kinds. Kept as two explicit mounts (not a
// `/:kind/` param) so hub routes read `/organizers/...` and competition
// routes `/competitions/...`, matching the rest of the API surface.
const KINDS = [
  { kind: "hub" as const, base: "/organizers" },
  { kind: "competition" as const, base: "/competitions" },
];

// ---------------------------------------------------------------------------
// GET /organizers/:id/admins · GET /competitions/:id/admins
// Owner + admins, owner flagged and listed first. Managers only.
// ---------------------------------------------------------------------------
for (const { kind, base } of KINDS) {
  router.get(
    `${base}/:id/admins`,
    requireAuth,
    asyncHandler(async (req, res) => {
      const me = req.sessionUser;
      if (!me) return apiError(res, 401, "Not authenticated");
      const target = await resolveTarget(kind, req.params.id);
      if (!target) return notFound(res);
      if (!(await canManageTarget(me, target))) {
        return apiError(res, 403, "Only an owner or admin can view admins");
      }
      const adminRows = await listAdminRows(target);
      const ownerRow = target.ownerUserId
        ? (
            await db
              .select()
              .from(users)
              .where(eq(users.id, target.ownerUserId))
              .limit(1)
          )[0] ?? null
        : null;
      res.json({
        data: [
          ...(ownerRow ? [adminMemberJson(ownerRow, true, null)] : []),
          ...adminRows.map((r) => adminMemberJson(r.u, false, r.createdAt)),
        ],
        viewerIsOwner: isTargetOwner(me, target),
      });
    }),
  );

  // -------------------------------------------------------------------------
  // POST .../admins — add an existing user as admin. Open to any manager.
  // Minors are never eligible (COPPA).
  // -------------------------------------------------------------------------
  router.post(
    `${base}/:id/admins`,
    requireAuth,
    asyncHandler(async (req, res) => {
      const me = req.sessionUser;
      if (!me) return apiError(res, 401, "Not authenticated");
      const target = await resolveTarget(kind, req.params.id);
      if (!target) return notFound(res);
      if (!(await canManageTarget(me, target))) {
        return apiError(res, 403, "Only an owner or admin can add admins");
      }
      const targetUserId = String(req.body?.userId ?? "").trim();
      if (!targetUserId || !UUID_RE.test(targetUserId)) {
        return apiError(res, 400, "userId required");
      }
      const [targetUser] = await db
        .select()
        .from(users)
        .where(and(eq(users.id, targetUserId), isNull(users.deletedAt)))
        .limit(1);
      if (!targetUser) return apiError(res, 404, "User not found");
      if (targetUser.isMinor) {
        return apiError(res, 403, "Minors can't be made admins.", {
          code: "MINORS_NOT_ELIGIBLE",
        });
      }
      if (target.ownerUserId === targetUser.id) {
        return apiError(res, 409, "That user is already the owner.", {
          code: "ALREADY_OWNER",
        });
      }
      if (await isExistingAdmin(target, targetUser.id)) {
        return apiError(res, 409, `${displayName(targetUser)} is already an admin.`, {
          code: "ALREADY_AN_ADMIN",
        });
      }
      await insertAdmin(target, targetUser.id, me.id);
      res.status(201).json(adminMemberJson(targetUser, false, new Date()));
    }),
  );

  // -------------------------------------------------------------------------
  // DELETE .../admins/:userId — OWNER-ONLY (or platform admin). The owner
  // is never removable (they're not a membership row to begin with).
  // -------------------------------------------------------------------------
  router.delete(
    `${base}/:id/admins/:userId`,
    requireAuth,
    asyncHandler(async (req, res) => {
      const me = req.sessionUser;
      if (!me) return apiError(res, 401, "Not authenticated");
      const target = await resolveTarget(kind, req.params.id);
      if (!target) return notFound(res);
      if (!isTargetOwner(me, target)) {
        return apiError(res, 403, "Only the owner can remove admins");
      }
      const userId = String(req.params.userId);
      if (!UUID_RE.test(userId)) return notFound(res);
      if (target.ownerUserId === userId) {
        return apiError(res, 409, "The owner can't be removed.", {
          code: "OWNER_NOT_REMOVABLE",
        });
      }
      if (target.kind === "hub") {
        await db
          .delete(organizerAdmins)
          .where(and(eq(organizerAdmins.organizerId, target.id), eq(organizerAdmins.userId, userId)));
      } else {
        await db
          .delete(competitionAdmins)
          .where(and(eq(competitionAdmins.competitionId, target.id), eq(competitionAdmins.userId, userId)));
      }
      res.json({ ok: true });
    }),
  );

  // -------------------------------------------------------------------------
  // GET .../admin-invites — pending email invites. Managers only.
  // -------------------------------------------------------------------------
  router.get(
    `${base}/:id/admin-invites`,
    requireAuth,
    asyncHandler(async (req, res) => {
      const me = req.sessionUser;
      if (!me) return apiError(res, 401, "Not authenticated");
      const target = await resolveTarget(kind, req.params.id);
      if (!target) return notFound(res);
      if (!(await canManageTarget(me, target))) {
        return apiError(res, 403, "Only an owner or admin can view invites");
      }
      const targetCol =
        target.kind === "hub"
          ? competitionAdminInvites.organizerId
          : competitionAdminInvites.competitionId;
      const rows = await db
        .select({ i: competitionAdminInvites, u: users })
        .from(competitionAdminInvites)
        .leftJoin(users, eq(competitionAdminInvites.invitedById, users.id))
        .where(and(eq(targetCol, target.id), eq(competitionAdminInvites.status, "pending")))
        .orderBy(desc(competitionAdminInvites.createdAt));
      res.json({ data: rows.map((r) => inviteJson(r.i, r.u)) });
    }),
  );

  // -------------------------------------------------------------------------
  // POST .../admin-invites — invite by email. Open to any manager. If the
  // email already belongs to a minor account, block up front.
  // -------------------------------------------------------------------------
  router.post(
    `${base}/:id/admin-invites`,
    requireAuth,
    asyncHandler(async (req, res) => {
      const me = req.sessionUser;
      if (!me) return apiError(res, 401, "Not authenticated");
      const target = await resolveTarget(kind, req.params.id);
      if (!target) return notFound(res);
      if (!(await canManageTarget(me, target))) {
        return apiError(res, 403, "Only an owner or admin can send invites");
      }
      const emailRaw = String(req.body?.email ?? "").trim().toLowerCase();
      if (!emailRaw) return apiError(res, 400, "email required");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
        return apiError(res, 400, "invalid email");
      }

      const [existingUser] = await db
        .select()
        .from(users)
        .where(and(eq(users.email, emailRaw), isNull(users.deletedAt)))
        .limit(1);
      if (existingUser) {
        if (existingUser.isMinor) {
          return apiError(res, 403, "Minors can't be made admins.", {
            code: "MINORS_NOT_ELIGIBLE",
          });
        }
        if (target.ownerUserId === existingUser.id) {
          return apiError(res, 409, "That user is already the owner.", {
            code: "ALREADY_OWNER",
          });
        }
        if (await isExistingAdmin(target, existingUser.id)) {
          return apiError(
            res,
            409,
            `${displayName(existingUser)} is already an admin.`,
            { code: "ALREADY_AN_ADMIN" },
          );
        }
      }

      const targetCol =
        target.kind === "hub"
          ? competitionAdminInvites.organizerId
          : competitionAdminInvites.competitionId;
      const [duplicate] = await db
        .select()
        .from(competitionAdminInvites)
        .where(
          and(
            eq(targetCol, target.id),
            eq(competitionAdminInvites.invitedEmail, emailRaw),
            eq(competitionAdminInvites.status, "pending"),
          ),
        )
        .limit(1);
      if (duplicate) {
        return apiError(res, 409, "An invite is already pending for this email.", {
          code: "INVITE_ALREADY_PENDING",
        });
      }

      const rawToken = generateToken();
      const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 3600 * 1000);
      const [invite] = await db
        .insert(competitionAdminInvites)
        .values({
          organizerId: target.kind === "hub" ? target.id : null,
          competitionId: target.kind === "competition" ? target.id : null,
          invitedById: me.id,
          invitedEmail: emailRaw,
          tokenHash: hashToken(rawToken),
          status: "pending",
          expiresAt,
        })
        .returning();

      // Best-effort email — a delivery failure shouldn't roll back the invite
      // row; the inviter can fall back to copying the accept link.
      let emailSent = false;
      try {
        await sendCompetitionAdminInviteEmail(emailRaw, {
          targetName: target.name,
          targetKind: target.kind,
          inviterDisplayName: displayName(me),
          token: rawToken,
        });
        emailSent = true;
      } catch (err) {
        req.log.warn(
          { err, targetKind: target.kind, targetId: target.id, inviteId: invite.id },
          "Failed to send admin invite email; invite row was still created",
        );
      }
      res.status(201).json({
        ...inviteJson(invite, me),
        emailSent,
        acceptUrl: buildCompetitionAdminInviteUrl(rawToken),
      });
    }),
  );

  // -------------------------------------------------------------------------
  // DELETE .../admin-invites/:inviteId — withdraw a pending invite.
  // -------------------------------------------------------------------------
  router.delete(
    `${base}/:id/admin-invites/:inviteId`,
    requireAuth,
    asyncHandler(async (req, res) => {
      const me = req.sessionUser;
      if (!me) return apiError(res, 401, "Not authenticated");
      const target = await resolveTarget(kind, req.params.id);
      if (!target) return notFound(res);
      if (!(await canManageTarget(me, target))) {
        return apiError(res, 403, "Only an owner or admin can withdraw invites");
      }
      const targetCol =
        target.kind === "hub"
          ? competitionAdminInvites.organizerId
          : competitionAdminInvites.competitionId;
      const [invite] = await db
        .select()
        .from(competitionAdminInvites)
        .where(and(eq(competitionAdminInvites.id, String(req.params.inviteId)), eq(targetCol, target.id)))
        .limit(1);
      if (!invite) return notFound(res);
      if (invite.status === "pending") {
        await db
          .update(competitionAdminInvites)
          .set({ status: "revoked", withdrawnAt: new Date(), updatedAt: new Date() })
          .where(eq(competitionAdminInvites.id, invite.id));
        return res.json({ id: invite.id, status: "withdrawn" as WireInviteStatus });
      }
      res.json({ id: invite.id, status: toWireStatus(invite.status as DbInviteStatus) });
    }),
  );
}

// ---------------------------------------------------------------------------
// POST .../admin-invites/:inviteId/link — mint/rotate the shareable accept
// link. Tokens are hashed at rest, so we rotate to a fresh token. Rate-limited
// per inviter (mirrors the org-invite link endpoint).
// ---------------------------------------------------------------------------
const adminInviteLinkLimiter = rateLimit({
  name: "competition-admin-invite-link",
  windowMs: 60_000,
  max: 20,
  keys: (req) => [req.sessionUser?.id ?? ipKey(req)],
  message: "You're requesting invite links too quickly. Please wait a moment.",
});

for (const { kind, base } of KINDS) {
  router.post(
    `${base}/:id/admin-invites/:inviteId/link`,
    requireAuth,
    adminInviteLinkLimiter,
    asyncHandler(async (req, res) => {
      const me = req.sessionUser;
      if (!me) return apiError(res, 401, "Not authenticated");
      const target = await resolveTarget(kind, req.params.id);
      if (!target) return notFound(res);
      if (!(await canManageTarget(me, target))) {
        return apiError(res, 403, "Only an owner or admin can copy invite links");
      }
      const targetCol =
        target.kind === "hub"
          ? competitionAdminInvites.organizerId
          : competitionAdminInvites.competitionId;
      const [invite] = await db
        .select()
        .from(competitionAdminInvites)
        .where(and(eq(competitionAdminInvites.id, String(req.params.inviteId)), eq(targetCol, target.id)))
        .limit(1);
      if (!invite) return notFound(res);
      if (invite.status !== "pending") {
        return apiError(res, 409, "Invite is no longer pending", {
          code: "INVITE_NOT_PENDING",
        });
      }
      const rawToken = generateToken();
      await db
        .update(competitionAdminInvites)
        .set({ tokenHash: hashToken(rawToken), updatedAt: new Date() })
        .where(eq(competitionAdminInvites.id, invite.id));
      res.json({ acceptUrl: buildCompetitionAdminInviteUrl(rawToken) });
    }),
  );
}

// ---------------------------------------------------------------------------
// Token routes — preview + accept for the emailed link.
// ---------------------------------------------------------------------------

async function findInviteByToken(token: string) {
  if (!token) return null;
  const [row] = await db
    .select({ i: competitionAdminInvites, inviter: users })
    .from(competitionAdminInvites)
    .leftJoin(users, eq(competitionAdminInvites.invitedById, users.id))
    .where(eq(competitionAdminInvites.tokenHash, hashToken(token)))
    .limit(1);
  return row ?? null;
}

async function inviteTarget(i: typeof competitionAdminInvites.$inferSelect): Promise<Target | null> {
  if (i.organizerId) return resolveTarget("hub", i.organizerId);
  if (i.competitionId) return resolveTarget("competition", i.competitionId);
  return null;
}

router.get(
  "/admin-invites/:token/preview",
  asyncHandler(async (req, res) => {
    const row = await findInviteByToken(String(req.params.token));
    if (!row) return notFound(res);
    const wireStatus = toWireStatus(row.i.status as DbInviteStatus);
    const expired =
      row.i.expiresAt !== null &&
      row.i.expiresAt.getTime() < Date.now() &&
      wireStatus === "pending";
    if (wireStatus !== "pending" || expired) {
      return apiError(res, 410, expired ? "Invite expired" : `Invite ${wireStatus}`, {
        code: "INVITE_NOT_PENDING",
      });
    }
    const target = await inviteTarget(row.i);
    if (!target) return notFound(res);
    res.json({
      id: row.i.id,
      status: wireStatus,
      invitedEmail: row.i.invitedEmail,
      target: {
        kind: target.kind,
        id: target.id,
        name: target.name,
        slug: target.row.slug,
      },
      invitedBy: row.inviter
        ? { id: row.inviter.id, displayName: displayName(row.inviter) }
        : null,
    });
  }),
);

router.post(
  "/admin-invites/:token/accept",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const row = await findInviteByToken(String(req.params.token));
    if (!row) return notFound(res);
    const wireStatus = toWireStatus(row.i.status as DbInviteStatus);
    if (wireStatus !== "pending") {
      return apiError(res, 410, `Invite ${wireStatus}`, { code: "INVITE_NOT_PENDING" });
    }
    if (row.i.expiresAt && row.i.expiresAt.getTime() < Date.now()) {
      // Lazy-expire so a stale row doesn't keep showing as pending.
      await db
        .update(competitionAdminInvites)
        .set({ status: "expired", updatedAt: new Date() })
        .where(eq(competitionAdminInvites.id, row.i.id));
      return apiError(res, 410, "Invite expired", { code: "INVITE_EXPIRED" });
    }
    // COPPA — a minor account can never accept an admin invite, even if one
    // was somehow addressed to them.
    const [meFull] = await db
      .select()
      .from(users)
      .where(eq(users.id, me.id))
      .limit(1);
    if (!meFull || meFull.isMinor) {
      return apiError(res, 403, "Minors can't be made admins.", {
        code: "MINORS_NOT_ELIGIBLE",
      });
    }
    const target = await inviteTarget(row.i);
    if (!target) return notFound(res);

    const markAccepted = () =>
      db
        .update(competitionAdminInvites)
        .set({
          status: "accepted",
          acceptedAt: new Date(),
          resolvedUserId: me.id,
          updatedAt: new Date(),
        })
        .where(eq(competitionAdminInvites.id, row.i.id));

    // Owner or already an admin — resolve the invite without inserting a
    // duplicate membership row (idempotent accept).
    if (target.ownerUserId !== me.id && !(await isExistingAdmin(target, me.id))) {
      await insertAdmin(target, me.id, row.i.invitedById ?? me.id);
    }
    await markAccepted();
    res.json({
      ok: true,
      target: {
        kind: target.kind,
        id: target.id,
        name: target.name,
        slug: target.row.slug,
      },
    });
  }),
);

// ---------------------------------------------------------------------------
// GET /competition-admin-user-search?q= — user picker for "add admin".
// Minors are NEVER surfaced here (COPPA): they can't be admins, so they
// must not be discoverable through this picker at all. Deleted accounts
// excluded too. Signed-in users only.
// ---------------------------------------------------------------------------
router.get(
  "/competition-admin-user-search",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (q.length < 2) return res.json({ data: [] });
    const rows = await db
      .select()
      .from(users)
      .where(
        and(
          isNull(users.deletedAt),
          eq(users.isMinor, false),
          or(ilike(users.name, `%${q}%`), ilike(users.email, `%${q}%`)),
        ),
      )
      .limit(10);
    res.json({
      data: rows.map((u) => ({
        id: u.id,
        displayName: displayName(u),
        email: u.email ?? null,
        avatarUrl: safeAvatarUrl(u.avatarUrl),
      })),
    });
  }),
);

export default router;
