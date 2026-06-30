import { Router, type IRouter } from "express";
import {
  db,
  users,
  organizations,
  organizationAdmins,
  organizationFollowers,
  organizationInvites,
} from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { asyncHandler } from "../lib/async-handler";
import { generateToken, hashToken } from "../lib/passwords";
import { rateLimit, ipKey } from "../middlewares/rate-limit";
import {
  sendOrganizationInviteEmail,
  buildOrganizationInviteUrl,
} from "../lib/email";
import { canManageOrganization } from "../lib/permissions";
import {
  apiError,
  displayName,
  notFound,
  paginate,
  toMember,
} from "../lib/spec-helpers";

const router: IRouter = Router();

type DbInviteStatus = "pending" | "accepted" | "expired" | "revoked";
type WireInviteStatus = "pending" | "accepted" | "expired" | "withdrawn";

// DB enum spells the withdraw state "revoked" (it's shared with the
// roster-invite table). The OpenAPI surface exposes "withdrawn" so org
// and roster invite vocab match. Translate at the route boundary.
function toWireStatus(s: DbInviteStatus): WireInviteStatus {
  return s === "revoked" ? "withdrawn" : (s as WireInviteStatus);
}

function fromWireStatus(s: WireInviteStatus): DbInviteStatus {
  return s === "withdrawn" ? "revoked" : (s as DbInviteStatus);
}

type InviteRow = typeof organizationInvites.$inferSelect;
type UserRow = typeof users.$inferSelect;

function toInviteResponse(i: InviteRow, inviter: Pick<UserRow, "id" | "name"> | null) {
  return {
    id: i.id,
    organizationId: i.organizationId,
    invitedEmail: i.invitedEmail,
    role: i.role as "admin" | "member",
    note: i.note,
    status: toWireStatus(i.status as DbInviteStatus),
    invitedBy: {
      id: inviter?.id ?? "",
      displayName: inviter ? displayName(inviter) : "Unknown",
    },
    // Task #666 — SendGrid delivery tracking (extra fields; openapi locked,
    // read via narrow cast on the client).
    deliveryStatus: i.deliveryStatus,
    deliveryEventAt: i.deliveryEventAt ? i.deliveryEventAt.toISOString() : null,
    deliveryReason: i.deliveryReason ?? null,
    createdAt: i.createdAt.toISOString(),
    expiresAt: i.expiresAt ? i.expiresAt.toISOString() : null,
  };
}

// ---------------------------------------------------------------------------
// Task #541 — POST /organizations/:orgId/members
//
// The OpenAPI spec declared this operation (`addMember`) but it had no
// handler. The new "Add admin → Find existing user" picker in the org
// Manage dialog drives it. Owner/admin only. Idempotent on the
// already-a-member case (returns 409 with the existing row's role so the
// UI can show a clear "they're already a member" toast).
// ---------------------------------------------------------------------------
router.post(
  "/organizations/:orgId/members",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const { orgId } = req.params;
    if (!(await canManageOrganization(me.id, orgId))) {
      return apiError(res, 403, "Org admins only");
    }
    const targetUserId = String(req.body?.userId ?? "").trim();
    const role = req.body?.role;
    if (!targetUserId) return apiError(res, 400, "userId required");
    if (role !== "admin" && role !== "member") {
      return apiError(res, 400, "role must be 'admin' or 'member'");
    }
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    if (!org) return notFound(res);
    const [target] = await db
      .select()
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1);
    if (!target) return apiError(res, 404, "User not found");

    const [existing] = await db
      .select({ role: organizationAdmins.role, joinedAt: organizationAdmins.createdAt })
      .from(organizationAdmins)
      .where(
        and(
          eq(organizationAdmins.organizationId, orgId),
          eq(organizationAdmins.userId, target.id),
        ),
      )
      .limit(1);
    if (existing) {
      return apiError(
        res,
        409,
        `${displayName(target)} is already a ${existing.role} of this organization.`,
        { code: "ALREADY_A_MEMBER" },
      );
    }
    const [row] = await db
      .insert(organizationAdmins)
      .values({ organizationId: orgId, userId: target.id, role })
      .returning();
    // New members also follow the org so it surfaces on their feed.
    await db
      .insert(organizationFollowers)
      .values({ organizationId: orgId, userId: target.id })
      .onConflictDoNothing();
    res.status(201).json(toMember(target, row.role, row.createdAt));
  }),
);

// ---------------------------------------------------------------------------
// Task #541 — Organization invite endpoints.
// ---------------------------------------------------------------------------

const INVITE_TTL_DAYS = 14;

router.get(
  "/organizations/:orgId/invites",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const { orgId } = req.params;
    if (!(await canManageOrganization(me.id, orgId))) {
      return apiError(res, 403, "Org admins only");
    }
    const wireStatus = (req.query.status as string | undefined) ?? "pending";
    const valid: readonly WireInviteStatus[] = [
      "pending",
      "accepted",
      "expired",
      "withdrawn",
    ];
    const filter: WireInviteStatus = (valid as readonly string[]).includes(wireStatus)
      ? (wireStatus as WireInviteStatus)
      : "pending";
    const dbStatus = fromWireStatus(filter);
    const rows = await db
      .select({ i: organizationInvites, u: users })
      .from(organizationInvites)
      .leftJoin(users, eq(organizationInvites.invitedById, users.id))
      .where(
        and(
          eq(organizationInvites.organizationId, orgId),
          eq(organizationInvites.status, dbStatus),
        ),
      )
      .orderBy(desc(organizationInvites.createdAt));
    res.json(paginate(rows.map((r) => toInviteResponse(r.i, r.u))));
  }),
);

router.post(
  "/organizations/:orgId/invites",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const { orgId } = req.params;
    if (!(await canManageOrganization(me.id, orgId))) {
      return apiError(res, 403, "Org admins only");
    }
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    if (!org) return notFound(res);

    const emailRaw = String(req.body?.email ?? "").trim().toLowerCase();
    const role = req.body?.role;
    const note = typeof req.body?.note === "string"
      ? req.body.note.slice(0, 500)
      : null;
    if (!emailRaw) return apiError(res, 400, "email required");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
      return apiError(res, 400, "invalid email");
    }
    if (role !== "admin" && role !== "member") {
      return apiError(res, 400, "role must be 'admin' or 'member'");
    }

    // If a Kinectem user with this email is already a member of the org,
    // surface a clean 409 instead of letting the invite accumulate.
    const [existingUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, emailRaw))
      .limit(1);
    if (existingUser) {
      const [membership] = await db
        .select({ role: organizationAdmins.role })
        .from(organizationAdmins)
        .where(
          and(
            eq(organizationAdmins.organizationId, orgId),
            eq(organizationAdmins.userId, existingUser.id),
          ),
        )
        .limit(1);
      if (membership) {
        return apiError(
          res,
          409,
          `${displayName(existingUser)} is already a ${membership.role} of this organization.`,
          { code: "ALREADY_A_MEMBER" },
        );
      }
    }

    // Dedupe pending invites for the same (org, email). Returning the
    // existing row keeps the action idempotent from the UI's POV.
    const [duplicate] = await db
      .select()
      .from(organizationInvites)
      .where(
        and(
          eq(organizationInvites.organizationId, orgId),
          eq(organizationInvites.invitedEmail, emailRaw),
          eq(organizationInvites.status, "pending"),
        ),
      )
      .limit(1);
    if (duplicate) {
      return apiError(
        res,
        409,
        "An invite is already pending for this email.",
        { code: "INVITE_ALREADY_PENDING" },
      );
    }

    const rawToken = generateToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 3600 * 1000);
    const [invite] = await db
      .insert(organizationInvites)
      .values({
        organizationId: orgId,
        invitedById: me.id,
        invitedEmail: emailRaw,
        role,
        note,
        tokenHash,
        status: "pending",
        expiresAt,
      })
      .returning();

    // Best-effort email send. A delivery failure shouldn't roll back
    // the invite row — the inviter can resend by withdrawing + re-creating.
    // Task #656 — report the email-send outcome (mirrors the team-invite
    // pattern in teams.ts) so the admin can fall back to copying the link
    // when delivery fails silently.
    let emailSent = false;
    try {
      await sendOrganizationInviteEmail(emailRaw, {
        organizationName: org.name,
        inviterDisplayName: displayName(me),
        role,
        token: rawToken,
        note,
        inviteId: invite.id,
      });
      emailSent = true;
      // Task #666 — record the successful hand-off to SendGrid. Later Event
      // Webhook events (delivered/bounced/etc) supersede this.
      await db
        .update(organizationInvites)
        .set({ deliveryStatus: "sent", updatedAt: new Date() })
        .where(eq(organizationInvites.id, invite.id));
    } catch (err) {
      req.log.warn(
        { err, orgId, inviteId: invite.id },
        "Failed to send organization invite email; invite row was still created",
      );
    }

    // Task #656 — append the email-send outcome and the public accept URL
    // outside the locked openapi.yaml; the client reads them via a narrow cast
    // (mirrors the team-invite `emailSent`/`acceptUrl` pattern).
    res.status(201).json({
      ...toInviteResponse(invite, me),
      emailSent,
      acceptUrl: buildOrganizationInviteUrl(rawToken),
    });
  }),
);

router.delete(
  "/organizations/:orgId/invites/:inviteId",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const { orgId, inviteId } = req.params;
    if (!(await canManageOrganization(me.id, orgId))) {
      return apiError(res, 403, "Org admins only");
    }
    const [invite] = await db
      .select()
      .from(organizationInvites)
      .where(
        and(
          eq(organizationInvites.id, inviteId),
          eq(organizationInvites.organizationId, orgId),
        ),
      )
      .limit(1);
    if (!invite) return notFound(res);
    if (invite.status === "pending") {
      await db
        .update(organizationInvites)
        .set({ status: "revoked", withdrawnAt: new Date(), updatedAt: new Date() })
        .where(eq(organizationInvites.id, invite.id));
      return res.json({ id: invite.id, status: "withdrawn" as WireInviteStatus });
    }
    res.json({ id: invite.id, status: toWireStatus(invite.status as DbInviteStatus) });
  }),
);

// Task #666 — mint/rotate a shareable accept link for a pending org invite.
// Org invite tokens are hashed at rest (only tokenHash is stored), so the raw
// link can't be reconstructed from an existing row — we rotate to a fresh
// token and return its URL. Keyed per inviter so the rotate path can't be
// hammered. Modest allowance covers honest "copy the link" retries.
const orgInviteLinkLimiter = rateLimit({
  name: "org-invite-link",
  windowMs: 60_000,
  max: 20,
  keys: (req) => [req.sessionUser?.id ?? ipKey(req)],
  message: "You're requesting invite links too quickly. Please wait a moment.",
});

router.post(
  "/organizations/:orgId/invites/:inviteId/link",
  orgInviteLinkLimiter,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const { orgId, inviteId } = req.params;
    if (!(await canManageOrganization(me.id, orgId))) {
      return apiError(res, 403, "Org admins only");
    }
    const [invite] = await db
      .select()
      .from(organizationInvites)
      .where(
        and(
          eq(organizationInvites.id, inviteId),
          eq(organizationInvites.organizationId, orgId),
        ),
      )
      .limit(1);
    if (!invite) return notFound(res);
    if (invite.status !== "pending") {
      return apiError(res, 409, "Invite is no longer pending", {
        code: "INVITE_NOT_PENDING",
      });
    }
    // Rotate the token so the link is freshly valid; the previous (unknown)
    // token is invalidated, which is acceptable for a "copy the link" action.
    const rawToken = generateToken();
    await db
      .update(organizationInvites)
      .set({ tokenHash: hashToken(rawToken), updatedAt: new Date() })
      .where(eq(organizationInvites.id, invite.id));
    res.json({ acceptUrl: buildOrganizationInviteUrl(rawToken) });
  }),
);

// Helper for the public/auth token routes — locates an invite by the
// raw token (which the recipient pastes back via URL) by hashing it.
async function findInviteByToken(token: string) {
  if (!token) return null;
  const tokenHash = hashToken(token);
  const [row] = await db
    .select({ i: organizationInvites, org: organizations, inviter: users })
    .from(organizationInvites)
    .innerJoin(
      organizations,
      eq(organizationInvites.organizationId, organizations.id),
    )
    .leftJoin(users, eq(organizationInvites.invitedById, users.id))
    .where(eq(organizationInvites.tokenHash, tokenHash))
    .limit(1);
  return row ?? null;
}

router.get(
  "/org-invites/:token/preview",
  asyncHandler(async (req, res) => {
    const row = await findInviteByToken(req.params.token);
    if (!row) return notFound(res);
    const wireStatus = toWireStatus(row.i.status as DbInviteStatus);
    const expired =
      row.i.expiresAt !== null &&
      row.i.expiresAt.getTime() < Date.now() &&
      wireStatus === "pending";
    if (wireStatus !== "pending" || expired) {
      return apiError(
        res,
        410,
        expired ? "Invite expired" : `Invite ${wireStatus}`,
        { code: "INVITE_NOT_PENDING" },
      );
    }
    res.json({
      id: row.i.id,
      status: wireStatus,
      role: row.i.role as "admin" | "member",
      invitedEmail: row.i.invitedEmail,
      organization: {
        id: row.org.id,
        name: row.org.name,
        avatarUrl: row.org.logoUrl ?? null,
      },
      invitedBy: row.inviter
        ? { id: row.inviter.id, displayName: displayName(row.inviter) }
        : null,
    });
  }),
);

router.post(
  "/org-invites/:token/accept",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const row = await findInviteByToken(req.params.token);
    if (!row) return notFound(res);
    const wireStatus = toWireStatus(row.i.status as DbInviteStatus);
    if (wireStatus !== "pending") {
      return apiError(res, 410, `Invite ${wireStatus}`, { code: "INVITE_NOT_PENDING" });
    }
    if (row.i.expiresAt && row.i.expiresAt.getTime() < Date.now()) {
      // Lazy-expire so a stale row doesn't keep showing as pending.
      await db
        .update(organizationInvites)
        .set({ status: "expired", updatedAt: new Date() })
        .where(eq(organizationInvites.id, row.i.id));
      return apiError(res, 410, "Invite expired", { code: "INVITE_EXPIRED" });
    }

    // Already a member? Surface a friendly state instead of inserting
    // a duplicate row (the DB would fail with a unique-violation anyway).
    const [existing] = await db
      .select({ role: organizationAdmins.role, createdAt: organizationAdmins.createdAt })
      .from(organizationAdmins)
      .where(
        and(
          eq(organizationAdmins.organizationId, row.i.organizationId),
          eq(organizationAdmins.userId, me.id),
        ),
      )
      .limit(1);
    if (existing) {
      // Mark the invite accepted so it leaves the pending queue and
      // the inviter sees the resolution.
      await db
        .update(organizationInvites)
        .set({
          status: "accepted",
          acceptedAt: new Date(),
          resolvedUserId: me.id,
          updatedAt: new Date(),
        })
        .where(eq(organizationInvites.id, row.i.id));
      return res
        .status(200)
        .json(toMember(me, existing.role, existing.createdAt));
    }

    const [membership] = await db
      .insert(organizationAdmins)
      .values({
        organizationId: row.i.organizationId,
        userId: me.id,
        role: row.i.role as "admin" | "member",
      })
      .returning();
    await db
      .insert(organizationFollowers)
      .values({ organizationId: row.i.organizationId, userId: me.id })
      .onConflictDoNothing();
    await db
      .update(organizationInvites)
      .set({
        status: "accepted",
        acceptedAt: new Date(),
        resolvedUserId: me.id,
        updatedAt: new Date(),
      })
      .where(eq(organizationInvites.id, row.i.id));
    res.status(200).json(toMember(me, membership.role, membership.createdAt));
  }),
);

router.post(
  "/org-invites/:token/decline",
  asyncHandler(async (req, res) => {
    const row = await findInviteByToken(req.params.token);
    if (!row) return notFound(res);
    const wireStatus = toWireStatus(row.i.status as DbInviteStatus);
    if (wireStatus !== "pending") {
      return res.json({ id: row.i.id, status: wireStatus });
    }
    await db
      .update(organizationInvites)
      .set({ status: "revoked", withdrawnAt: new Date(), updatedAt: new Date() })
      .where(eq(organizationInvites.id, row.i.id));
    res.json({ id: row.i.id, status: "withdrawn" as WireInviteStatus });
    // Silence an unused-import lint for `sql` in case future
    // helpers need raw SQL; keep this file self-contained.
    void sql;
  }),
);

export default router;
