import { Router, type IRouter, type Request } from "express";
import {
  db,
  users,
  organizations,
  organizationAdmins,
  teamFollowers,
  teams,
  rosterEntries,
  rosterInvites,
  notifications,
  adminActivityLog,
} from "@workspace/db";
import {
  and,
  desc,
  eq,
  inArray,
  isNull,
  sql,
} from "drizzle-orm";
import { hashPassword, verifyPassword, generateToken, hashToken } from "../lib/passwords";
import { rateLimit, ipKey, emailKey } from "../middlewares/rate-limit";
import { asyncHandler } from "../lib/async-handler";
import { sendGuardianConfirmationEmail, sendGuardianExpiredEmail, sendPasswordResetEmail } from "../lib/email";
import {
  canManageOrganization,
  isTeamMember,
  canManageTeam,
  canCreateRecap,
  getOrgRole,
} from "../lib/permissions";
import {
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  SESSION_COOKIE,
} from "../lib/auth";
import {
  displayName,
  displayNameForViewer,
  maskedDisplayName,
  buildMinorNameContext,
  toTeam,
  toTeamMember,
  toInvite,
  paginate,
  apiError,
  safeAvatarUrl,
  notFound,
} from "../lib/spec-helpers";
import {
  loadPostStats,
  statsFor,
  loadPostOwnerId,
  type PostStats,
  type StatsKind,
} from "../lib/post-stats";
import { applyArticleTagFanout, notifyNewlyTaggedInRecap, TAG_NOTIF_THROTTLE_MS } from "../lib/article-tagging";
import {
  ensureOrgFollowedForTeam,
  ensureTeamFollowed,
  ensureTeamFollowedAsGuardian,
} from "../lib/team-follow";
import { notifyTeamArchived, notifyTeamUnarchived } from "../lib/notifications";
import { normalizeWebsite } from "../lib/normalize-website";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

router.post(
  "/organizations/:orgId/teams",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, req.params.orgId))
      .limit(1);
    if (!org) return notFound(res);
    // Lock down team creation to org owners and admins. The "Add team"
    // button on the Organization page is already gated on the same role
    // check; this guards the API path so a plain member, follower, or
    // unrelated signed-in user can't create a team by hitting the
    // endpoint directly. canManageOrganization returns true only for
    // role in ('owner','admin') (see permissions.ts MANAGE_ROLES).
    if (!(await canManageOrganization(me.id, org.id))) {
      return apiError(res, 403, "Only organization admins can create teams");
    }
    const name = String(req.body?.name ?? "").trim();
    if (!name) return apiError(res, 400, "name required");
    const ALLOWED_GENDERS = ["boys", "girls", "coed"] as const;
    let gender: "boys" | "girls" | "coed" | null = null;
    if (req.body?.gender != null) {
      const g = String(req.body.gender).toLowerCase();
      if (!(ALLOWED_GENDERS as readonly string[]).includes(g)) {
        return apiError(res, 400, "invalid gender");
      }
      gender = g as "boys" | "girls" | "coed";
    }
    // Task #293 — Optional team website on creation. Same normalization
    // pattern as the org-website handling added in #290: undefined / null
    // / empty string leave it null; a string is run through
    // normalizeWebsite() (bare domains gain a https:// prefix). Obvious
    // garbage like "not a url" or "ftp://..." → 400.
    let website: string | null = null;
    if (req.body?.website != null && req.body.website !== "") {
      const websiteResult = normalizeWebsite(req.body.website);
      if (!websiteResult.ok) return apiError(res, 400, websiteResult.error);
      website = websiteResult.value || null;
    }
    // Wrap the team insert and the creator's auto-staff entry in a single
    // transaction so a team is never persisted without its creator on the
    // roster as Admin. We deliberately skip the "you were invited to a
    // team" notification here — the creator just made the team and would
    // find a self-invite confusing.
    const team = await db.transaction(async (tx) => {
      const [t] = await tx
        .insert(teams)
        .values({
          organizationId: org.id,
          name,
          sport: req.body?.sport ?? undefined,
          level: req.body?.level ?? undefined,
          gender: gender ?? undefined,
          website: website ?? undefined,
          season: req.body?.season?.name ?? undefined,
          bannerUrl:
            typeof req.body?.bannerUrl === "string"
              ? req.body.bannerUrl
              : undefined,
        })
        .returning();
      await tx.insert(rosterEntries).values({
        teamId: t.id,
        userId: me.id,
        role: "coach",
        status: "accepted",
        position: "admin",
        invitedById: me.id,
      });
      return t;
    });
    res.status(201).json(toTeam(team, org, { memberCount: 1 }));
  }),
);

router.get(
  "/teams/:teamId",
  asyncHandler(async (req, res) => {
    const [t] = await db.select().from(teams).where(eq(teams.id, req.params.teamId)).limit(1);
    if (!t) return notFound(res);
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, t.organizationId))
      .limit(1);
    if (!org) return notFound(res);
    // Task #472 — archived teams are invisible to non-managers. Owners
    // and admins of the parent org still get the row back so they can
    // open the page to unarchive it; everyone else (anonymous, plain
    // members, followers) gets a 404 indistinguishable from a deleted
    // team. We do this check after the org lookup so we can use the
    // existing `canManageOrganization` helper.
    if (t.archivedAt) {
      const me = req.sessionUser;
      const canSeeArchived = me
        ? await canManageOrganization(me.id, org.id)
        : false;
      if (!canSeeArchived) return notFound(res);
    }
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(rosterEntries)
      .where(eq(rosterEntries.teamId, t.id));
    const me = req.sessionUser;
    const [{ followerCount }] = await db
      .select({ followerCount: sql<number>`count(*)::int` })
      .from(teamFollowers)
      .where(eq(teamFollowers.teamId, t.id));
    let isFollowing = false;
    if (me) {
      const [f] = await db
        .select()
        .from(teamFollowers)
        .where(
          and(eq(teamFollowers.teamId, t.id), eq(teamFollowers.userId, me.id)),
        )
        .limit(1);
      isFollowing = !!f;
    }
    // Server-derived authoring capability: drives the team page's
    // "Create Game Recap" affordance and the "Waiting for approval"
    // pending-recaps section. Mirrors the same `canCreateRecap` rule
    // POST /posts uses to gate recap creation, so the client never
    // duplicates the permission logic.
    const canAuthorRecaps = me ? await canCreateRecap(me.id, t) : false;
    res.json(
      toTeam(t, org, {
        memberCount: count,
        followerCount,
        isFollowing,
        canAuthorRecaps,
      }),
    );
  }),
);

router.patch(
  "/teams/:teamId",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "unauthorized");
    const [existing] = await db
      .select()
      .from(teams)
      .where(eq(teams.id, req.params.teamId))
      .limit(1);
    if (!existing) return notFound(res);
    const [adminRow] = await db
      .select()
      .from(organizationAdmins)
      .where(
        and(
          eq(organizationAdmins.organizationId, existing.organizationId),
          eq(organizationAdmins.userId, me.id),
          inArray(organizationAdmins.role, ["owner", "admin"]),
        ),
      )
      .limit(1);
    if (!adminRow) return apiError(res, 403, "forbidden");
    const body = req.body ?? {};
    const patch: Record<string, unknown> = {};
    if (typeof body.name === "string") patch.name = body.name.trim();
    if (typeof body.sport === "string") patch.sport = body.sport;
    if (typeof body.level === "string") patch.level = body.level;
    if (typeof body.description === "string") patch.description = body.description;
    // Task #293 — Team website. Mirrors the org-website behavior added in
    // #290: explicit null clears, empty string clears, a string is run
    // through normalizeWebsite() (bare domains get a https:// prefix),
    // and obvious garbage is rejected with a 400.
    if (body.website === null) {
      patch.website = null;
    } else if (typeof body.website === "string") {
      const websiteResult = normalizeWebsite(body.website);
      if (!websiteResult.ok) return apiError(res, 400, websiteResult.error);
      patch.website = websiteResult.value === "" ? null : websiteResult.value;
    } else if (body.website !== undefined) {
      return apiError(res, 400, "website must be a string or null");
    }
    if (typeof body.logoUrl === "string") patch.logoUrl = body.logoUrl;
    if (typeof body.bannerUrl === "string") patch.bannerUrl = body.bannerUrl;
    else if (body.bannerUrl === null) patch.bannerUrl = null;
    if (body.gender === null) {
      patch.gender = null;
    } else if (typeof body.gender === "string") {
      const g = body.gender.toLowerCase();
      if (!["boys", "girls", "coed"].includes(g)) {
        return apiError(res, 400, "invalid gender");
      }
      patch.gender = g;
    }
    if (Object.keys(patch).length === 0) {
      return apiError(res, 400, "no updatable fields");
    }
    const [t] = await db
      .update(teams)
      .set(patch)
      .where(eq(teams.id, req.params.teamId))
      .returning();
    if (!t) return notFound(res);
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, t.organizationId))
      .limit(1);
    if (!org) return notFound(res);
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(rosterEntries)
      .where(eq(rosterEntries.teamId, t.id));
    res.json(toTeam(t, org, { memberCount: count }));
  }),
);

router.get(
  "/teams/:teamId/members",
  asyncHandler(async (req, res) => {
    const rows = await db
      .select({ r: rosterEntries, u: users })
      .from(rosterEntries)
      .innerJoin(users, eq(rosterEntries.userId, users.id))
      .where(eq(rosterEntries.teamId, req.params.teamId));
    const parentIds = Array.from(
      new Set(
        rows
          .map((r) => r.u.parentId)
          .filter((x): x is string => typeof x === "string"),
      ),
    );
    const parentRows = parentIds.length
      ? await db.select().from(users).where(inArray(users.id, parentIds))
      : [];
    const parentMap = new Map(parentRows.map((p) => [p.id, p]));
    const me = req.sessionUser;
    const [team] = await db
      .select()
      .from(teams)
      .where(eq(teams.id, req.params.teamId))
      .limit(1);
    let canSeeParentEmail = false;
    if (me && team) {
      canSeeParentEmail =
        (await canManageOrganization(me.id, team.organizationId)) ||
        (await isTeamMember(me.id, team.id));
    }
    const data = rows.map((r) => {
      const base = toTeamMember(r.r, r.u);
      const parent = r.u.parentId ? parentMap.get(r.u.parentId) : null;
      return {
        ...base,
        parents: parent
          ? [
              {
                id: parent.id,
                displayName: parent.name || "Parent",
                email: canSeeParentEmail ? (parent.email ?? null) : null,
                avatarUrl: safeAvatarUrl(parent.avatarUrl),
              },
            ]
          : [],
      };
    });
    res.json(paginate(data));
  }),
);

router.get(
  "/teams/:teamId/invites",
  asyncHandler(async (req, res) => {
    // Pending-invite metadata (specifically the invited email) is PII
    // that only managers should see. Mirror the create/withdraw paths
    // by gating this list behind canManageTeam so non-managers can't
    // enumerate invitees via the network even when the UI hides the
    // tab from them.
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const teamId = req.params.teamId;
    const [t] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
    if (!t) return notFound(res);
    if (!(await canManageTeam(me.id, t)))
      return apiError(res, 403, "Team coaches or org admins only");
    const rows = await db
      .select({ i: rosterInvites, u: users })
      .from(rosterInvites)
      .leftJoin(users, eq(rosterInvites.invitedById, users.id))
      .where(eq(rosterInvites.teamId, teamId));
    const data = rows.map((r) => toInvite(r.i, r.u));
    res.json(paginate(data));
  }),
);

// Add a known Kinectem user directly to the roster (in pending state by default).
router.post(
  "/teams/:teamId/members",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const teamId = req.params.teamId;
    const userId = String(req.body?.userId ?? "");
    if (!userId) return apiError(res, 400, "userId required");
    const [t] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
    if (!t) return notFound(res);
    if (!(await canManageTeam(me.id, t)))
      return apiError(res, 403, "Team coaches or org admins only");
    // Task #472 — archived teams are read-only. Block roster additions
    // so managers don't accidentally invite someone to a team that's
    // about to disappear from the user-facing surfaces.
    if (t.archivedAt)
      return apiError(res, 409, "Team is archived", { code: "team_archived" });
    const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!u) return notFound(res);
    const positionRaw = String(req.body?.position ?? "player");
    const dbRole: "player" | "coach" =
      positionRaw === "coach" ||
      positionRaw === "assistant_coach" ||
      positionRaw === "admin"
        ? "coach"
        : "player";
    const [existing] = await db
      .select()
      .from(rosterEntries)
      .where(and(eq(rosterEntries.teamId, teamId), eq(rosterEntries.userId, userId)))
      .limit(1);
    let entry = existing;
    if (!entry) {
      [entry] = await db
        .insert(rosterEntries)
        .values({
          teamId,
          userId,
          role: dbRole,
          status: "pending",
          position: positionRaw === "coach" ? null : positionRaw,
          invitedById: me.id,
        })
        .returning();
      await ensureOrgFollowedForTeam(userId, teamId);
      // If the added member is a minor with a linked guardian, auto-follow
      // the team on the parent's behalf so it surfaces under the parent's
      // profile Teams section (rendered as a `position: "parent"` row).
      // Task #434 — also auto-follow on the added user's own behalf so the
      // team appears in their feed without an extra Follow click. Both
      // best-effort.
      try {
        await ensureTeamFollowed(userId, teamId);
        if (u.parentId) {
          await ensureTeamFollowedAsGuardian(u.parentId, teamId);
        }
      } catch (err) {
        req.log.warn(
          { err, userId, teamId },
          "auto-follow on direct-add failed",
        );
      }
      // Task #414 — `message` is persisted into the recipient's bell
      // and read back as-is. Recipient is the invitee (a stranger to
      // the inviter under the masking model), so when the inviter is
      // a minor, mask at write time. Adult inviters keep full name.
      // Render-time viewer-aware notification text is Task #415.
      const actorName = me.isMinor ? maskedDisplayName(me) : displayName(me);
      await db.insert(notifications).values({
        userId,
        kind: "roster_invite",
        message: `${actorName} added you to ${t.name}. Tap to accept or decline.`,
        // Carry the roster entry id so the team page can open straight to
        // the Roster panel and scroll/highlight the invitee's pending row.
        link: `/teams/${teamId}?roster=1&entryId=${entry.id}`,
        actorUserId: me.id,
      });
      // Fan out to the linked guardian, if any. A parent managing an
      // under-13 athlete needs to see the invite in their own bell and
      // be able to accept on the child's behalf from /family.
      if (u.parentId) {
        const childFirstName =
          (u.name?.trim().split(/\s+/)[0] ?? "").length > 0
            ? u.name!.trim().split(/\s+/)[0]
            : "your child";
        // Task #414 — same write-time mask: guardian is privileged
        // for `u` (their child) but not necessarily for `me`.
        await db.insert(notifications).values({
          userId: u.parentId,
          kind: "roster_invite_for_child",
          message: `${actorName} invited ${childFirstName} to join ${t.name}.`,
          link: `/family?childId=${u.id}&entryId=${entry.id}&teamId=${teamId}`,
          actorUserId: me.id,
        });
      }
    }
    res.status(201).json(toTeamMember(entry, u));
  }),
);

// Count accepted Admins (position = 'admin', status = 'accepted') currently
// on a team. Used by both PATCH and DELETE on /members/:memberId to enforce
// the "a team must always have at least one Admin" rule, so a manager can
// never demote or remove the very last Admin and accidentally lock everyone
// out of team management.
async function countAcceptedAdmins(teamId: string): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(rosterEntries)
    .where(
      and(
        eq(rosterEntries.teamId, teamId),
        eq(rosterEntries.position, "admin"),
        eq(rosterEntries.status, "accepted"),
      ),
    );
  return Number(count) || 0;
}

const ALLOWED_POSITIONS = new Set([
  "player",
  "coach",
  "assistant_coach",
  "admin",
  "manager",
  "parent",
  "author",
]);

// Map a spec-level position string to the (role, position) pair we persist
// in `roster_entries`. Mirrors the logic used by the add-member and
// email-invite endpoints so every write path stores the same shape.
function positionToRosterFields(positionRaw: string): {
  role: "player" | "coach";
  position: string | null;
} {
  const role: "player" | "coach" =
    positionRaw === "coach" ||
    positionRaw === "assistant_coach" ||
    positionRaw === "admin"
      ? "coach"
      : "player";
  return {
    role,
    position: positionRaw === "coach" ? null : positionRaw,
  };
}

router.patch(
  "/teams/:teamId/members/:memberId",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const teamId = req.params.teamId;
    const memberId = req.params.memberId;
    const [t] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
    if (!t) return notFound(res);
    if (!(await canManageTeam(me.id, t)))
      return apiError(res, 403, "Team coaches or org admins only");
    const [entry] = await db
      .select()
      .from(rosterEntries)
      .where(
        and(eq(rosterEntries.id, memberId), eq(rosterEntries.teamId, teamId)),
      )
      .limit(1);
    if (!entry) return notFound(res);

    const positionRaw = req.body?.position;
    const positionProvided = positionRaw !== undefined;
    if (positionProvided) {
      if (typeof positionRaw !== "string" || !ALLOWED_POSITIONS.has(positionRaw)) {
        return apiError(res, 400, "valid position required");
      }
    }

    // jerseyNumber is optional. Accept an integer in [0, 999] to set, or
    // explicit `null` to clear. Anything else is rejected up front so the
    // dialog can show a clear inline error rather than a silent no-op.
    const jerseyRaw = req.body?.jerseyNumber;
    const jerseyProvided = jerseyRaw !== undefined;
    let jerseyValue: number | null = null;
    if (jerseyProvided) {
      if (jerseyRaw === null) {
        jerseyValue = null;
      } else if (
        typeof jerseyRaw === "number" &&
        Number.isInteger(jerseyRaw) &&
        jerseyRaw >= 0 &&
        jerseyRaw <= 999
      ) {
        jerseyValue = jerseyRaw;
      } else {
        return apiError(
          res,
          400,
          "jerseyNumber must be an integer between 0 and 999",
        );
      }
    }

    if (!positionProvided && !jerseyProvided) {
      return apiError(res, 400, "no fields to update");
    }

    const updates: Partial<typeof rosterEntries.$inferInsert> = {};
    let newPosition: string | null = entry.position;
    if (positionProvided) {
      const { role: dbRole, position: nextPosition } =
        positionToRosterFields(positionRaw as string);
      newPosition = nextPosition;
      updates.position = nextPosition;
      updates.role = dbRole;
    }
    if (jerseyProvided) {
      updates.jerseyNumber = jerseyValue;
    }

    // Refuse to demote the very last accepted Admin away from "admin": a
    // team must always have someone who can manage it. The UI surfaces
    // this message inline in the Edit dialog. Only relevant when the
    // caller is actually changing position.
    if (positionProvided) {
      const wasAdmin =
        entry.position === "admin" && entry.status === "accepted";
      const willBeAdmin = newPosition === "admin";
      if (wasAdmin && !willBeAdmin) {
        const adminCount = await countAcceptedAdmins(teamId);
        if (adminCount <= 1) {
          return apiError(
            res,
            422,
            "A team must have at least one Admin. Promote another member to Admin first.",
          );
        }
      }
    }

    const [updated] = await db
      .update(rosterEntries)
      .set(updates)
      .where(eq(rosterEntries.id, entry.id))
      .returning();
    const [u] = await db
      .select()
      .from(users)
      .where(eq(users.id, entry.userId))
      .limit(1);
    if (!u) return notFound(res);
    res.json(toTeamMember(updated, u));
  }),
);

router.delete(
  "/teams/:teamId/members/:memberId",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const teamId = req.params.teamId;
    const memberId = req.params.memberId;
    const [t] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
    if (!t) return notFound(res);
    if (!(await canManageTeam(me.id, t)))
      return apiError(res, 403, "Team coaches or org admins only");
    const [entry] = await db
      .select()
      .from(rosterEntries)
      .where(
        and(eq(rosterEntries.id, memberId), eq(rosterEntries.teamId, teamId)),
      )
      .limit(1);
    if (!entry) {
      // Idempotent: nothing to do, the row is already gone.
      return res.status(204).end();
    }
    // Same "last Admin" guard as the PATCH path — removing the last
    // accepted Admin would leave the team with no one able to manage it.
    if (entry.position === "admin" && entry.status === "accepted") {
      const adminCount = await countAcceptedAdmins(teamId);
      if (adminCount <= 1) {
        return apiError(
          res,
          422,
          "A team must have at least one Admin. Promote another member to Admin first.",
        );
      }
    }
    await db.delete(rosterEntries).where(eq(rosterEntries.id, entry.id));
    res.status(204).end();
  }),
);

// A roster spot can be acted on by either the entry's user themselves
// (real, non-masquerading session) or the entry user's linked guardian
// acting from a real (non-masquerading) parent session. This lets a
// parent accept/decline a child's roster spot from /family or the
// notifications bell on the child's behalf, without giving admins or
// strangers the same power even if they impersonate.
async function rosterEntryActor(
  req: Request,
  entryUserId: string,
): Promise<{ allowed: boolean; actor: typeof users.$inferSelect | null }> {
  const me = req.sessionUser;
  if (!me) return { allowed: false, actor: null };
  if (entryUserId === me.id && !req.isMasquerading) {
    const [self] = await db.select().from(users).where(eq(users.id, me.id)).limit(1);
    return { allowed: true, actor: self ?? null };
  }
  if (req.isMasquerading) return { allowed: false, actor: null };
  const [child] = await db
    .select({ parentId: users.parentId })
    .from(users)
    .where(eq(users.id, entryUserId))
    .limit(1);
  if (child && child.parentId === me.id) {
    const [target] = await db.select().from(users).where(eq(users.id, entryUserId)).limit(1);
    return { allowed: true, actor: target ?? null };
  }
  return { allowed: false, actor: null };
}

router.post(
  "/teams/:teamId/members/:memberId/accept",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [entry] = await db
      .select()
      .from(rosterEntries)
      .where(
        and(
          eq(rosterEntries.id, req.params.memberId),
          eq(rosterEntries.teamId, req.params.teamId),
        ),
      )
      .limit(1);
    if (!entry) return notFound(res);
    const { allowed, actor } = await rosterEntryActor(req, entry.userId);
    if (!allowed || !actor) return apiError(res, 403, "Forbidden");
    const [updated] = await db
      .update(rosterEntries)
      .set({ status: "accepted" })
      .where(eq(rosterEntries.id, entry.id))
      .returning();
    // Task #434 — auto-follow the team for the accepter and any linked
    // parent so the team appears in their feed / profile without an
    // extra Follow click. Wrapped in try/catch so a failure here can
    // never bubble up and turn a successful accept into a 5xx.
    try {
      await ensureTeamFollowed(entry.userId, entry.teamId);
      const [accepter] = await db
        .select({ parentId: users.parentId })
        .from(users)
        .where(eq(users.id, entry.userId))
        .limit(1);
      if (accepter?.parentId) {
        await ensureTeamFollowedAsGuardian(accepter.parentId, entry.teamId);
      }
    } catch (err) {
      req.log.warn(
        { err, userId: entry.userId, teamId: entry.teamId },
        "auto-follow on accept failed",
      );
    }
    res.json(toTeamMember(updated, actor));
  }),
);

router.post(
  "/teams/:teamId/members/:memberId/decline",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [entry] = await db
      .select()
      .from(rosterEntries)
      .where(
        and(
          eq(rosterEntries.id, req.params.memberId),
          eq(rosterEntries.teamId, req.params.teamId),
        ),
      )
      .limit(1);
    if (!entry) return notFound(res);
    const { allowed } = await rosterEntryActor(req, entry.userId);
    if (!allowed) return apiError(res, 403, "Forbidden");
    await db.delete(rosterEntries).where(eq(rosterEntries.id, entry.id));
    res.status(204).end();
  }),
);

// Email invite — creates a pending rosterInvite with a token.
router.post(
  "/teams/:teamId/invites",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const teamId = req.params.teamId;
    const [t] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
    if (!t) return notFound(res);
    if (!(await canManageTeam(me.id, t)))
      return apiError(res, 403, "Team coaches or org admins only");
    // Task #472 — block new email invites on an archived team. Mirrors
    // the direct-add block above; an archived team should not be able
    // to accumulate fresh pending invitees.
    if (t.archivedAt)
      return apiError(res, 409, "Team is archived", { code: "team_archived" });
    const email = String(req.body?.email ?? "").trim();
    if (!email) return apiError(res, 400, "email required");
    const positionRaw = String(req.body?.position ?? "player");
    const dbRole: "player" | "coach" =
      positionRaw === "coach" ||
      positionRaw === "assistant_coach" ||
      positionRaw === "admin"
        ? "coach"
        : "player";
    const token = `inv-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
    const [invite] = await db
      .insert(rosterInvites)
      .values({
        token,
        teamId,
        invitedEmail: email,
        invitedName: req.body?.name ?? null,
        role: dbRole,
        position: positionRaw === "coach" ? null : positionRaw,
        invitedById: me.id,
      })
      .returning();

    // If a Kinectem account already exists for this email, also place that
    // user on the roster as pending so they (and their linked guardian, if
    // any) can accept the spot in-app without waiting for the email link.
    // This mirrors the direct-add path's notification fan-out so that
    // parents of children invited by email get the same /family deep-link
    // they get from the direct-add path.
    const [existingUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, email.toLowerCase()))
      .limit(1);
    if (existingUser) {
      const [existingEntry] = await db
        .select()
        .from(rosterEntries)
        .where(
          and(
            eq(rosterEntries.teamId, teamId),
            eq(rosterEntries.userId, existingUser.id),
          ),
        )
        .limit(1);
      if (!existingEntry) {
        const [entry] = await db
          .insert(rosterEntries)
          .values({
            teamId,
            userId: existingUser.id,
            role: dbRole,
            status: "pending",
            position: positionRaw === "coach" ? null : positionRaw,
            invitedById: me.id,
          })
          .returning();
        await ensureOrgFollowedForTeam(existingUser.id, teamId);
        // Task #434 — auto-follow on the invited user's own behalf in
        // addition to the existing parent-side follow. Best-effort.
        try {
          await ensureTeamFollowed(existingUser.id, teamId);
          if (existingUser.parentId) {
            await ensureTeamFollowedAsGuardian(existingUser.parentId, teamId);
          }
        } catch (err) {
          req.log.warn(
            { err, userId: existingUser.id, teamId },
            "auto-follow on email-invite failed",
          );
        }
        // Task #414 — write-time mask when the inviter is a minor.
        // See identical comment on the direct-add path above.
        const actorName = me.isMinor ? maskedDisplayName(me) : displayName(me);
        await db.insert(notifications).values({
          userId: existingUser.id,
          kind: "roster_invite",
          message: `${actorName} invited you to ${t.name}. Tap to accept or decline.`,
          // Carry the roster entry id so the team page can open straight
          // to the Roster panel and scroll/highlight the invitee's row.
          link: `/teams/${teamId}?roster=1&entryId=${entry.id}`,
          actorUserId: me.id,
        });
        if (existingUser.parentId) {
          const childFirstName =
            (existingUser.name?.trim().split(/\s+/)[0] ?? "").length > 0
              ? existingUser.name!.trim().split(/\s+/)[0]
              : "your child";
          await db.insert(notifications).values({
            userId: existingUser.parentId,
            kind: "roster_invite_for_child",
            message: `${actorName} invited ${childFirstName} to join ${t.name}.`,
            link: `/family?childId=${existingUser.id}&entryId=${entry.id}&teamId=${teamId}`,
            actorUserId: me.id,
          });
        }
      }
    }

    res.status(201).json(toInvite(invite, me));
  }),
);

// Withdraw a still-pending email invite. Managers (org admins/owners or a
// team coach) need to be able to cancel an outstanding invitation from the
// team page so a mistakenly-invited address doesn't sit forever in the
// pending list. Idempotent on already-resolved invites: returns the
// current status either way so the UI can refresh.
router.delete(
  "/teams/:teamId/invites/:inviteId",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const teamId = req.params.teamId;
    const inviteId = req.params.inviteId;
    const [t] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
    if (!t) return notFound(res);
    if (!(await canManageTeam(me.id, t)))
      return apiError(res, 403, "Team coaches or org admins only");
    const [invite] = await db
      .select()
      .from(rosterInvites)
      .where(
        and(
          eq(rosterInvites.id, inviteId),
          eq(rosterInvites.teamId, teamId),
        ),
      )
      .limit(1);
    if (!invite) return notFound(res);
    // Only flip pending -> revoked. Anything else (already accepted /
    // expired) is left alone so we don't lose history. The DB enum
    // calls this state "revoked" but the OpenAPI surface exposes it as
    // "withdrawn" — translate at the boundary so spec consumers see a
    // single, consistent vocabulary.
    if (invite.status === "pending") {
      await db
        .update(rosterInvites)
        .set({ status: "revoked" })
        .where(eq(rosterInvites.id, invite.id));
      return res.json({ id: invite.id, status: "withdrawn" });
    }
    res.json({
      id: invite.id,
      status: invite.status === "revoked" ? "withdrawn" : invite.status,
    });
  }),
);

// Pending team-invites for a guardian-managed child. The parent (or a real
// admin) needs a single endpoint that returns every team that has invited
// this child but isn't accepted yet, plus enough metadata to render the
// row without follow-up round-trips.
router.get(
  "/users/me/children/:childId/pending-team-invites",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const childId = req.params.childId;
    const [child] = await db
      .select()
      .from(users)
      .where(eq(users.id, childId))
      .limit(1);
    if (!child) return notFound(res);

    // Same authorization shape as GET /users/:userId/teams: the linked
    // guardian on a real (non-masquerading) parent session, or a real admin.
    const isRealAdmin =
      req.realUser?.role === "admin" && !req.isMasquerading;
    const isGuardian =
      child.parentId === me.id && !req.isMasquerading;
    if (!isGuardian && !isRealAdmin) {
      return apiError(res, 403, "Forbidden");
    }

    const rows = await db
      .select({ entry: rosterEntries, team: teams, org: organizations })
      .from(rosterEntries)
      .innerJoin(teams, eq(rosterEntries.teamId, teams.id))
      .innerJoin(organizations, eq(teams.organizationId, organizations.id))
      .where(
        and(
          eq(rosterEntries.userId, childId),
          eq(rosterEntries.status, "pending"),
        ),
      )
      .orderBy(desc(rosterEntries.createdAt));

    // Resolve "who invited" directly from `rosterEntries.invitedById`,
    // which both the direct-add and email-invite paths populate.
    const inviterIds = Array.from(
      new Set(
        rows
          .map((r) => r.entry.invitedById)
          .filter((id): id is string => !!id),
      ),
    );
    const inviterMap = new Map<string, typeof users.$inferSelect>();
    if (inviterIds.length > 0) {
      const inviterRows = await db
        .select()
        .from(users)
        .where(inArray(users.id, inviterIds));
      for (const u of inviterRows) inviterMap.set(u.id, u);
    }

    // Task #414 — viewer is the linked guardian (or a real admin).
    // Inviters are usually adult coaches but may technically be a
    // teen captain. Mask minor inviters unless this guardian is
    // privileged for that specific minor (linked-guardian or shared
    // accepted-roster team via `buildMinorNameContext`).
    const pendingInviteMinorCtx = await buildMinorNameContext(
      { id: me.id, role: req.realUser?.role ?? null },
      Array.from(inviterMap.values())
        .filter((u) => u.isMinor)
        .map((u) => u.id),
    );
    const data = rows.map((r) => {
      const inviter = r.entry.invitedById
        ? inviterMap.get(r.entry.invitedById) ?? null
        : null;
      return {
        entryId: r.entry.id,
        teamId: r.team.id,
        teamName: r.team.name,
        teamLogoUrl: r.team.logoUrl ?? null,
        organization: { id: r.org.id, name: r.org.name },
        role: r.entry.role === "coach" ? "coach" : "player",
        position: r.entry.position ?? null,
        invitedAt: r.entry.createdAt.toISOString(),
        invitedBy: inviter
          ? {
              id: inviter.id,
              displayName: displayNameForViewer(inviter, pendingInviteMinorCtx),
              avatarUrl: safeAvatarUrl(inviter.avatarUrl),
            }
          : null,
      };
    });

    res.json({ data });
  }),
);

// ---------------------------------------------------------------------------
// Task #472 — Archive / unarchive a team.
//
// Owner-only on purpose: archiving hides the team across the whole product
// and blocks writes, so it sits at the same level of authority as deleting
// the team. Org admins can do most other team admin (edit, manage roster,
// approve recaps) but explicitly NOT this — the UI shows them a disabled
// button with a "Only the org owner can archive a team" hint, and the
// server returns the same forbid with `code: "owner_only"` so a hand-rolled
// request gets the same answer.
//
// Both endpoints are idempotent. Each archive/unarchive transition writes a
// row to `admin_activity_log` so the org has a paper trail; we insert the
// row inline here rather than going through `logAdminAction` because the
// helper's typed action union does not include team archive/unarchive
// actions and widening that union would touch unrelated admin flows.
// ---------------------------------------------------------------------------

async function loadTeamForArchiveAction(
  req: Request,
  res: Parameters<typeof apiError>[0],
): Promise<{ team: typeof teams.$inferSelect; ownerId: string } | null> {
  const me = req.sessionUser;
  if (!me) {
    apiError(res, 401, "Not authenticated");
    return null;
  }
  const teamId = String(req.params.teamId);
  const [t] = await db
    .select()
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  if (!t) {
    notFound(res);
    return null;
  }
  const role = await getOrgRole(me.id, t.organizationId);
  if (role === "owner") return { team: t, ownerId: me.id };
  if (role === "admin" || role === "member") {
    apiError(
      res,
      403,
      "Only the org owner can archive a team",
      { code: "owner_only" },
    );
    return null;
  }
  // Not a member of the org at all → opaque 404 so we don't leak the
  // team's existence to drive-by callers.
  notFound(res);
  return null;
}

router.post(
  "/teams/:teamId/archive",
  asyncHandler(async (req, res) => {
    const ctx = await loadTeamForArchiveAction(req, res);
    if (!ctx) return undefined;
    const { team, ownerId } = ctx;
    let updated = team;
    if (!team.archivedAt) {
      const [row] = await db
        .update(teams)
        .set({ archivedAt: new Date(), archivedByUserId: ownerId })
        .where(eq(teams.id, team.id))
        .returning();
      updated = row ?? team;
      await db.insert(adminActivityLog).values({
        adminUserId: ownerId,
        actionType: "archive_team",
        targetType: "team",
        targetId: team.id,
        metadata: JSON.stringify({
          organizationId: team.organizationId,
          teamName: team.name,
        }),
      });
      await notifyTeamArchived({
        teamId: updated.id,
        organizationId: updated.organizationId,
        teamName: updated.name,
        actorUserId: ownerId,
      });
    }
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, updated.organizationId))
      .limit(1);
    if (!org) return notFound(res);
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(rosterEntries)
      .where(eq(rosterEntries.teamId, updated.id));
    return res.json(toTeam(updated, org, { memberCount: count }));
  }),
);

router.post(
  "/teams/:teamId/unarchive",
  asyncHandler(async (req, res) => {
    const ctx = await loadTeamForArchiveAction(req, res);
    if (!ctx) return undefined;
    const { team, ownerId } = ctx;
    let updated = team;
    if (team.archivedAt) {
      const [row] = await db
        .update(teams)
        .set({ archivedAt: null, archivedByUserId: null })
        .where(eq(teams.id, team.id))
        .returning();
      updated = row ?? team;
      await db.insert(adminActivityLog).values({
        adminUserId: ownerId,
        actionType: "unarchive_team",
        targetType: "team",
        targetId: team.id,
        metadata: JSON.stringify({
          organizationId: team.organizationId,
          teamName: team.name,
        }),
      });
      await notifyTeamUnarchived({
        teamId: updated.id,
        organizationId: updated.organizationId,
        teamName: updated.name,
        actorUserId: ownerId,
      });
    }
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, updated.organizationId))
      .limit(1);
    if (!org) return notFound(res);
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(rosterEntries)
      .where(eq(rosterEntries.teamId, updated.id));
    return res.json(toTeam(updated, org, { memberCount: count }));
  }),
);

export default router;
