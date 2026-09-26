// Task #755 — multi-guardian support ("two parents per child").
//
// The `guardian_links` table is the source of truth for the parent↔child
// graph; `users.parentId` is a dual-written MIRROR of the primary ACTIVE
// guardian (the locked `coppa.ts` reads it). Every status/primary write in
// this file goes through `syncParentIdMirror` inside a child-scoped
// advisory-lock transaction so the mirror can never drift and concurrent
// accepts/removals/transfers can't race the one-primary invariant.
//
// Invite model: no invite token — accepting is session-authenticated. If the
// invited email already has an account we set `guardianId` immediately;
// otherwise the pending link stores `inviteEmail` and is CLAIMED the first
// time a signed-in user with that (verified-by-login) email lists their
// children. The invite endpoint's 200-dedup response is deliberately generic
// so callers can't probe whether an email has an account.

import { Router, type IRouter } from "express";
import { db, users, guardianLinks, notifications, consentAuditLog } from "@workspace/db";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { asyncHandler } from "../lib/async-handler";
import { apiError, displayName, safeAvatarUrl } from "../lib/spec-helpers";
import { clientIp } from "../lib/coppa";
import { logger } from "../lib/logger";
import { rateLimit, ipKey } from "../middlewares/rate-limit";
import { sendGuardianLinkInviteEmail } from "../lib/email";
import { syncParentIdMirror, isActiveGuardian } from "../lib/guardian-links";
import {
  backfillTeamFollowsForLinkedChild,
  cleanupTeamFollowsForUnlinkedChild,
} from "../lib/team-follow";

const router: IRouter = Router();

type LinkRow = typeof guardianLinks.$inferSelect;
type UserRow = typeof users.$inferSelect;

// The locked coppa.ts hardcodes its ConsentAuditEvent union, so the new
// Task #755 events can't go through logConsentEvent(). Same best-effort
// semantics: audit failures must never break the user-facing flow.
type GuardianLinkAuditEvent =
  | "guardian_link_invited"
  | "guardian_link_accepted"
  | "guardian_link_declined"
  | "guardian_link_removed"
  | "guardian_link_primary_transferred";

async function logGuardianLinkEvent(args: {
  event: GuardianLinkAuditEvent;
  childUserId: string;
  actorEmail?: string | null;
  actorIp?: string | null;
  details?: string | null;
}): Promise<void> {
  try {
    await db.insert(consentAuditLog).values({
      event: args.event,
      childUserId: args.childUserId,
      actorEmail: args.actorEmail ?? null,
      actorIp: args.actorIp ?? null,
      details: args.details ?? null,
    });
  } catch (err) {
    logger.error({ err, event: args.event }, "Failed to write consent audit log");
  }
}

// ---------------------------------------------------------------------------
// Serializers
// ---------------------------------------------------------------------------

// GuardianLinkResponse. For an unclaimed pending invite (no account yet) the
// spec still requires a `guardian` object; we use the link's own id as the
// placeholder id and surface the invited email as the display name — the
// only viewers of this list are the child, their guardians, and admins, all
// of whom are allowed to see who was invited.
function toGuardianLinkResponse(
  link: LinkRow,
  guardian: Pick<UserRow, "id" | "name" | "avatarUrl"> | null,
) {
  return {
    id: link.id,
    guardian: guardian
      ? {
          id: guardian.id,
          displayName:
            link.status === "pending" &&
            [link.inviteFirstName, link.inviteLastName].some(Boolean)
              ? [link.inviteFirstName, link.inviteLastName].filter(Boolean).join(" ")
              : displayName(guardian),
          avatarUrl: safeAvatarUrl(guardian.avatarUrl),
        }
      : {
          id: link.id,
          displayName:
            [link.inviteFirstName, link.inviteLastName].filter(Boolean).join(" ") ||
            link.inviteEmail ||
            "Invited guardian",
          avatarUrl: null,
        },
    relationshipType: link.relationshipType,
    isPrimary: link.isPrimary,
    status: link.status,
    consentGrantedAt: link.consentGrantedAt
      ? link.consentGrantedAt.toISOString()
      : null,
    consentMethod: link.consentMethod ?? null,
    createdAt: link.createdAt.toISOString(),
  };
}

// ChildLinkResponse — viewer is always the guardian themselves (or an
// admin), so dateOfBirth is allowed here per the spec's COPPA note.
function toChildLinkResponse(
  link: LinkRow,
  child: Pick<UserRow, "id" | "name" | "avatarUrl" | "dateOfBirth">,
) {
  return {
    id: link.id,
    child: {
      id: child.id,
      displayName: displayName(child),
      avatarUrl: safeAvatarUrl(child.avatarUrl),
      dateOfBirth: child.dateOfBirth
        ? child.dateOfBirth.toISOString().slice(0, 10)
        : null,
    },
    relationshipType: link.relationshipType,
    isPrimary: link.isPrimary,
    status: link.status,
    consentGrantedAt: link.consentGrantedAt
      ? link.consentGrantedAt.toISOString()
      : null,
    consentMethod: link.consentMethod ?? null,
    createdAt: link.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Shared lookups
// ---------------------------------------------------------------------------

async function loadLiveLink(linkId: string): Promise<LinkRow | null> {
  const [link] = await db
    .select()
    .from(guardianLinks)
    .where(and(eq(guardianLinks.id, linkId), ne(guardianLinks.status, "revoked")))
    .limit(1);
  return link ?? null;
}

function isAdmin(u: { role: string | null } | undefined | null): boolean {
  return u?.role === "admin";
}

async function isPrimaryActiveGuardian(
  guardianUserId: string,
  childId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: guardianLinks.id })
    .from(guardianLinks)
    .where(
      and(
        eq(guardianLinks.childId, childId),
        eq(guardianLinks.guardianId, guardianUserId),
        eq(guardianLinks.status, "active"),
        eq(guardianLinks.isPrimary, true),
      ),
    )
    .limit(1);
  return !!row;
}

// A pending link is addressed to `me` when it carries their user id OR —
// for invites sent before the account existed — when its inviteEmail
// matches the email they log in with.
function linkAddressedToMe(
  link: LinkRow,
  me: { id: string; email: string | null },
): boolean {
  if (link.guardianId) return link.guardianId === me.id;
  return (
    !!link.inviteEmail &&
    !!me.email &&
    link.inviteEmail.toLowerCase() === me.email.toLowerCase()
  );
}

// ---------------------------------------------------------------------------
// GET /users/:userId/guardians — list a child's guardian links
// ---------------------------------------------------------------------------

router.get(
  "/users/:userId/guardians",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const childId = String(req.params.userId);
    const [child] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, childId))
      .limit(1);
    if (!child) return apiError(res, 404, "User not found");
    const allowed =
      me.id === childId ||
      isAdmin(me) ||
      (await isActiveGuardian(me.id, childId));
    if (!allowed) return apiError(res, 403, "Not allowed");

    const links = await db
      .select()
      .from(guardianLinks)
      .where(
        and(
          eq(guardianLinks.childId, childId),
          ne(guardianLinks.status, "revoked"),
        ),
      )
      .orderBy(
        sql`${guardianLinks.isPrimary} DESC`,
        sql`${guardianLinks.status} ASC`,
        guardianLinks.createdAt,
      );
    const guardianIds = links
      .map((l) => l.guardianId)
      .filter((g): g is string => !!g);
    const guardianRows = guardianIds.length
      ? await db
          .select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl })
          .from(users)
          .where(inArray(users.id, guardianIds))
      : [];
    const byId = new Map(guardianRows.map((g) => [g.id, g]));
    res.json({
      data: links.map((l) =>
        toGuardianLinkResponse(l, l.guardianId ? byId.get(l.guardianId) ?? null : null),
      ),
    });
  }),
);

// ---------------------------------------------------------------------------
// POST /users/:userId/guardians/invite
// ---------------------------------------------------------------------------

router.post(
  "/users/:userId/guardians/invite",
  rateLimit({
    name: "guardian-invite",
    windowMs: 60 * 60 * 1000,
    max: 20,
    keys: (req) => [ipKey(req)],
  }),
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const childId = String(req.params.userId);
    const [child] = await db
      .select()
      .from(users)
      .where(eq(users.id, childId))
      .limit(1);
    if (!child) return apiError(res, 404, "User not found");

    // Only the child themselves, any ACTIVE guardian (spec: "a linked
    // parent"), or a platform admin may invite. Guardian/admin powers don't
    // apply while masquerading (consistent with the other guardian-
    // privileged routes).
    const isSelf = me.id === childId;
    const allowed =
      isSelf ||
      (!req.isMasquerading &&
        (isAdmin(me) || (await isActiveGuardian(me.id, childId))));
    if (!allowed) return apiError(res, 403, "Not allowed");

    const firstName =
      typeof req.body?.firstName === "string" ? req.body.firstName.trim() : "";
    const lastName =
      typeof req.body?.lastName === "string" ? req.body.lastName.trim() : "";
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const relationshipType =
      req.body?.relationshipType === "legal_guardian"
        ? ("legal_guardian" as const)
        : ("parent" as const);
    if (!firstName || !lastName || !email) {
      return apiError(res, 400, "firstName, lastName, and email are required");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return apiError(res, 400, "A valid email is required");
    }
    if (child.email && child.email.toLowerCase() === email) {
      return apiError(res, 400, "A child cannot be their own guardian");
    }
    if (me.email && me.email.toLowerCase() === email && !isSelf) {
      // The inviter is already acting as a guardian (or admin); a
      // self-invite would just duplicate their existing link.
      return apiError(res, 400, "You cannot invite yourself");
    }

    // Resolve an existing account for the address (never revealed to the
    // caller — both branches produce indistinguishable success responses
    // apart from the documented 200-dedup case).
    const [invitee] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1);

    // Privacy-safe dedup: any live (pending or active) link for this child
    // matching the address or the resolved account → generic 200.
    const dupConds = [
      and(
        eq(guardianLinks.childId, childId),
        ne(guardianLinks.status, "revoked"),
        sql`lower(${guardianLinks.inviteEmail}) = ${email}`,
      ),
    ];
    if (invitee) {
      dupConds.push(
        and(
          eq(guardianLinks.childId, childId),
          ne(guardianLinks.status, "revoked"),
          eq(guardianLinks.guardianId, invitee.id),
        ),
      );
    }
    for (const cond of dupConds) {
      const [dup] = await db.select({ id: guardianLinks.id }).from(guardianLinks).where(cond).limit(1);
      if (dup) {
        return res.json({ message: "Invite processed." });
      }
    }

    const [link] = await db
      .insert(guardianLinks)
      .values({
        childId,
        guardianId: invitee?.id ?? null,
        inviteEmail: email,
        inviteFirstName: firstName,
        inviteLastName: lastName,
        relationshipType,
        isPrimary: false,
        status: "pending",
        invitedByUserId: me.id,
      })
      .returning();

    await logGuardianLinkEvent({
      event: "guardian_link_invited",
      childUserId: childId,
      actorEmail: me.email ?? null,
      actorIp: clientIp(req),
      details: `relationship=${relationshipType}`,
    });

    // In-app bell for invitees who already have an account.
    if (invitee) {
      const childFirst = child.name?.trim().split(/\s+/)[0] || "a child";
      await db.insert(notifications).values({
        userId: invitee.id,
        kind: "guardian_link_invite",
        message: `${displayName(me)} invited you to be ${childFirst}'s ${
          relationshipType === "legal_guardian" ? "legal guardian" : "parent"
        } on Kinectem.`,
        link: `/family`,
        actorUserId: me.id,
      });
    }

    // Email is best-effort — the invite also surfaces in-app.
    try {
      await sendGuardianLinkInviteEmail(email, {
        childName: child.name,
        inviterName: displayName(me),
        inviteeName: `${firstName} ${lastName}`,
        relationshipType,
      });
    } catch (err) {
      logger.error({ err }, "Failed to send guardian link invite email");
    }

    res.status(201).json(
      toGuardianLinkResponse(
        link,
        invitee
          ? { id: invitee.id, name: invitee.name, avatarUrl: invitee.avatarUrl }
          : null,
      ),
    );
  }),
);

// ---------------------------------------------------------------------------
// GET /users/:userId/children — a guardian's child links (incl. pending
// invites addressed to them). NOTE: the legacy GET /users/me/children in
// guardians.ts registers first and keeps handling the literal "me" path.
// ---------------------------------------------------------------------------

router.get(
  "/users/:userId/children",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const userId = String(req.params.userId);
    if (userId !== me.id && !isAdmin(me)) {
      return apiError(res, 403, "Not allowed");
    }
    const [subject] = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!subject) return apiError(res, 404, "User not found");

    // Claim unclaimed email invites: the subject is signed in with this
    // email (or an admin is viewing — skip claiming in that case).
    if (userId === me.id && me.email) {
      try {
        await db
          .update(guardianLinks)
          .set({ guardianId: me.id, updatedAt: new Date() })
          .where(
            and(
              isNull(guardianLinks.guardianId),
              eq(guardianLinks.status, "pending"),
              sql`lower(${guardianLinks.inviteEmail}) = ${me.email.toLowerCase()}`,
              // Guard against a duplicate live pair (partial unique index):
              sql`NOT EXISTS (
                SELECT 1 FROM guardian_links g2
                WHERE g2.child_id = ${guardianLinks.childId}
                  AND g2.guardian_id = ${me.id}
                  AND g2.status <> 'revoked'
              )`,
              // If several unclaimed pending invites exist for the SAME
              // child+email, claim only the oldest — claiming both in one
              // statement would collide on the live-pair unique index.
              sql`${guardianLinks.id} IN (
                SELECT DISTINCT ON (g3.child_id) g3.id FROM guardian_links g3
                WHERE g3.guardian_id IS NULL
                  AND g3.status = 'pending'
                  AND lower(g3.invite_email) = ${me.email.toLowerCase()}
                ORDER BY g3.child_id, g3.created_at
              )`,
            ),
          );
      } catch (err) {
        // A concurrent claim/accept can still race the guards above into a
        // unique violation; claiming is opportunistic, so treat it as a
        // no-op rather than failing the whole listing.
        if ((err as { code?: string })?.code !== "23505") throw err;
        logger.warn({ err }, "Guardian invite claim raced a duplicate live pair; skipped");
      }
    }

    const rows = await db
      .select({ link: guardianLinks, child: users })
      .from(guardianLinks)
      .innerJoin(users, eq(users.id, guardianLinks.childId))
      .where(
        and(
          eq(guardianLinks.guardianId, userId),
          ne(guardianLinks.status, "revoked"),
        ),
      )
      .orderBy(
        sql`${guardianLinks.status} ASC`,
        guardianLinks.createdAt,
      );
    res.json({
      data: rows.map((r) => toChildLinkResponse(r.link, r.child)),
    });
  }),
);

// ---------------------------------------------------------------------------
// POST /guardian-links/:linkId/accept
// ---------------------------------------------------------------------------

router.post(
  "/guardian-links/:linkId/accept",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    if (req.isMasquerading) return apiError(res, 403, "Not allowed while masquerading");
    const link = await loadLiveLink(String(req.params.linkId));
    if (!link) return apiError(res, 404, "Invitation not found");
    if (!linkAddressedToMe(link, me)) {
      // Don't leak the link's existence to non-recipients.
      return apiError(res, 404, "Invitation not found");
    }
    if (link.status !== "pending") {
      return apiError(res, 404, "Invitation not found");
    }

    const updated = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${link.childId}))`);
      const [fresh] = await tx
        .select()
        .from(guardianLinks)
        .where(eq(guardianLinks.id, link.id))
        .limit(1);
      if (!fresh || fresh.status !== "pending") return null;
      // Idempotency under duplicate invites: if any OTHER live link already
      // exists for (child, me) — e.g. a duplicate pending invite that was
      // claimed, or an already-active link — revoke it before activating
      // this one so the live-pair unique index can never throw a 500.
      // Net state is unchanged (same guardian, one active link) and the
      // primary flag is re-derived below + by syncParentIdMirror.
      await tx
        .update(guardianLinks)
        .set({ status: "revoked", isPrimary: false, updatedAt: new Date() })
        .where(
          and(
            eq(guardianLinks.childId, link.childId),
            eq(guardianLinks.guardianId, me.id),
            ne(guardianLinks.id, link.id),
            ne(guardianLinks.status, "revoked"),
          ),
        );
      // Becomes primary only when the child has no active primary yet
      // (e.g. their original guardian was removed while this sat pending).
      const [existingPrimary] = await tx
        .select({ id: guardianLinks.id })
        .from(guardianLinks)
        .where(
          and(
            eq(guardianLinks.childId, link.childId),
            eq(guardianLinks.status, "active"),
            eq(guardianLinks.isPrimary, true),
          ),
        )
        .limit(1);
      const [row] = await tx
        .update(guardianLinks)
        .set({
          guardianId: me.id,
          status: "active",
          isPrimary: !existingPrimary,
          consentGrantedAt: new Date(),
          consentMethod: "guardian_invite_accept",
          updatedAt: new Date(),
        })
        .where(eq(guardianLinks.id, link.id))
        .returning();
      await syncParentIdMirror(link.childId, tx);
      return row;
    });
    if (!updated) return apiError(res, 404, "Invitation not found");

    // Surface the child's teams on the new guardian's profile (best-effort).
    try {
      await backfillTeamFollowsForLinkedChild(me.id, link.childId);
    } catch (err) {
      logger.error({ err }, "Failed to backfill team follows for new guardian");
    }

    await logGuardianLinkEvent({
      event: "guardian_link_accepted",
      childUserId: link.childId,
      actorEmail: me.email ?? null,
      actorIp: clientIp(req),
    });

    // Tell the inviter their invite was accepted.
    if (updated.invitedByUserId && updated.invitedByUserId !== me.id) {
      await db.insert(notifications).values({
        userId: updated.invitedByUserId,
        kind: "guardian_link_accepted",
        message: `${displayName(me)} accepted your guardian invitation.`,
        link: `/family`,
        actorUserId: me.id,
      });
    }

    res.json(
      toGuardianLinkResponse(updated, {
        id: me.id,
        name: me.name,
        avatarUrl: me.avatarUrl,
      }),
    );
  }),
);

// ---------------------------------------------------------------------------
// POST /guardian-links/:linkId/decline
// ---------------------------------------------------------------------------

router.post(
  "/guardian-links/:linkId/decline",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    if (req.isMasquerading) return apiError(res, 403, "Not allowed while masquerading");
    const link = await loadLiveLink(String(req.params.linkId));
    if (!link || link.status !== "pending" || !linkAddressedToMe(link, me)) {
      return apiError(res, 404, "Invitation not found");
    }
    await db
      .update(guardianLinks)
      .set({ status: "revoked", isPrimary: false, updatedAt: new Date() })
      .where(and(eq(guardianLinks.id, link.id), eq(guardianLinks.status, "pending")));
    await logGuardianLinkEvent({
      event: "guardian_link_declined",
      childUserId: link.childId,
      actorEmail: me.email ?? null,
      actorIp: clientIp(req),
    });
    res.status(204).send();
  }),
);

// ---------------------------------------------------------------------------
// DELETE /guardian-links/:linkId
// ---------------------------------------------------------------------------

router.delete(
  "/guardian-links/:linkId",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const link = await loadLiveLink(String(req.params.linkId));
    if (!link) return apiError(res, 404, "Link not found");

    // Who may remove: the link's own guardian, the child, the child's
    // primary guardian (cancelling a co-parent), or a platform admin.
    const isChildSelf = me.id === link.childId;
    const isLinkGuardian = !!link.guardianId && link.guardianId === me.id;
    const allowed =
      isChildSelf ||
      (!req.isMasquerading &&
        (isLinkGuardian ||
          isAdmin(me) ||
          (await isPrimaryActiveGuardian(me.id, link.childId))));
    if (!allowed) return apiError(res, 404, "Link not found");

    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${link.childId}))`);
      const [fresh] = await tx
        .select()
        .from(guardianLinks)
        .where(eq(guardianLinks.id, link.id))
        .limit(1);
      if (!fresh || fresh.status === "revoked") return { ok: false as const, reason: "gone" as const };
      if (fresh.status === "active") {
        const [{ n }] = (await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(guardianLinks)
          .where(
            and(
              eq(guardianLinks.childId, link.childId),
              eq(guardianLinks.status, "active"),
              ne(guardianLinks.id, link.id),
            ),
          )) as [{ n: number }];
        if (n === 0) return { ok: false as const, reason: "last" as const };
      }
      await tx
        .update(guardianLinks)
        .set({ status: "revoked", isPrimary: false, updatedAt: new Date() })
        .where(eq(guardianLinks.id, link.id));
      await syncParentIdMirror(link.childId, tx);
      return { ok: true as const, wasActive: fresh.status === "active" };
    });

    if (!result.ok) {
      if (result.reason === "last") {
        return apiError(res, 403, "Cannot remove the last guardian", {
          code: "LAST_GUARDIAN",
        });
      }
      return apiError(res, 404, "Link not found");
    }

    if (result.wasActive && link.guardianId) {
      try {
        await cleanupTeamFollowsForUnlinkedChild(link.guardianId, link.childId);
      } catch (err) {
        logger.error({ err }, "Failed to clean up team follows for removed guardian");
      }
    }

    await logGuardianLinkEvent({
      event: "guardian_link_removed",
      childUserId: link.childId,
      actorEmail: me.email ?? null,
      actorIp: clientIp(req),
      details: link.isPrimary ? "was_primary" : null,
    });
    res.status(204).send();
  }),
);

// ---------------------------------------------------------------------------
// POST /guardian-links/:linkId/transfer-primary
// ---------------------------------------------------------------------------

router.post(
  "/guardian-links/:linkId/transfer-primary",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    if (req.isMasquerading) return apiError(res, 403, "Not allowed while masquerading");
    const link = await loadLiveLink(String(req.params.linkId));
    if (!link) return apiError(res, 404, "Link not found");
    const allowed =
      isAdmin(me) || (await isPrimaryActiveGuardian(me.id, link.childId));
    if (!allowed) return apiError(res, 403, "Only the current primary guardian can transfer the primary role");
    if (link.status !== "active" || !link.guardianId) {
      return apiError(res, 403, "Primary can only be transferred to an active guardian");
    }
    if (link.isPrimary) {
      // Already primary — idempotent no-op.
      const [g] = await db
        .select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl })
        .from(users)
        .where(eq(users.id, link.guardianId))
        .limit(1);
      return res.json(toGuardianLinkResponse(link, g ?? null));
    }

    const updated = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${link.childId}))`);
      const [fresh] = await tx
        .select()
        .from(guardianLinks)
        .where(eq(guardianLinks.id, link.id))
        .limit(1);
      if (!fresh || fresh.status !== "active") return null;
      // Demote first so the one-primary-per-child partial unique index
      // never sees two primaries.
      await tx
        .update(guardianLinks)
        .set({ isPrimary: false, updatedAt: new Date() })
        .where(
          and(
            eq(guardianLinks.childId, link.childId),
            eq(guardianLinks.status, "active"),
            eq(guardianLinks.isPrimary, true),
          ),
        );
      const [row] = await tx
        .update(guardianLinks)
        .set({ isPrimary: true, updatedAt: new Date() })
        .where(eq(guardianLinks.id, link.id))
        .returning();
      await syncParentIdMirror(link.childId, tx);
      return row;
    });
    if (!updated) return apiError(res, 404, "Link not found");

    await logGuardianLinkEvent({
      event: "guardian_link_primary_transferred",
      childUserId: link.childId,
      actorEmail: me.email ?? null,
      actorIp: clientIp(req),
    });

    const [g] = await db
      .select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl })
      .from(users)
      .where(eq(users.id, updated.guardianId!))
      .limit(1);
    res.json(toGuardianLinkResponse(updated, g ?? null));
  }),
);

export default router;
