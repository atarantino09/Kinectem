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
  articles,
  teamNewsLinks,
} from "@workspace/db";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  isNotNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { hashPassword, verifyPassword, generateToken, hashToken } from "../lib/passwords";
import {
  isStaffInvitePosition,
  staffInviteRoleLabel,
} from "@workspace/invite-copy";
import { rateLimit, ipKey, emailKey } from "../middlewares/rate-limit";
import { findAccountByEmail, findPendingInvite, findRosterEntry, isOrganizationManager, lockRosterTeam, reconcileOrganizationSelfInvites, revokeRedundantInvites, revokeSelfInvites } from "../lib/roster-invite-consistency";
import { asyncHandler } from "../lib/async-handler";
import { getActiveGuardianIds, getActiveGuardianIdsForChildren, isActiveGuardian } from "../lib/guardian-links";
import {
  sendGuardianConfirmationEmail,
  sendGuardianExpiredEmail,
  sendPasswordResetEmail,
  appBaseUrl,
  buildRosterEmail,
  sendCoachInviteEmail,
  sendStaffInviteEmail,
  buildInviteAcceptUrl,
} from "../lib/email";
import { dispatchNotificationEmail } from "../lib/notification-email";
import {
  canManageOrganization,
  isTeamMember,
  canManageTeam,
  canCreateRecap,
  canAuthorRecapAnywhere,
  getOrgRole,
  isPlatformAdmin,
} from "../lib/permissions";
import { generateSeasonRecapText, AiNotConfiguredError } from "../lib/ai";
import { getOrgPlan, teamLimitForPlan } from "../lib/plan-limits";
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
  MAX_IMAGE_DATA_URL_LENGTH,
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
import { normalizeNewsGameDate } from "../lib/news-game-date";
import { fetchNewsArticleContext } from "../lib/news-article-content";

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
    // Resolve the org's plan team cap. Archived teams don't count; `null`
    // limit (Elite) is unlimited. Orgs without a selected subscription fall
    // back to the entry tier (see plan-limits.ts). The authoritative
    // count + enforcement happens inside the insert transaction below
    // (behind a per-org advisory lock) so the cap can't be overrun by
    // concurrent create requests.
    const plan = await getOrgPlan(org.id);
    const teamLimit = teamLimitForPlan(plan);
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
    // Platform admins setting up teams for a hand-off never join the
    // roster themselves (see the roster insert below).
    const creatorIsPlatformAdmin = await isPlatformAdmin(me.id);
    // Wrap the team insert and the creator's auto-staff entry in a single
    // transaction so a team is never persisted without its creator on the
    // roster as Admin. We deliberately skip the "you were invited to a
    // team" notification here — the creator just made the team and would
    // find a self-invite confusing.
    const result = await db.transaction(async (tx) => {
      // Enforce the plan team cap atomically. A transaction-scoped advisory
      // lock keyed by orgId serializes concurrent creates for the same org,
      // so the re-count below can't race another insert (TOCTOU). Unlimited
      // (Elite) tiers skip the lock + count. The limited branch does no
      // writes, so committing simply releases the lock.
      if (teamLimit != null) {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${org.id}))`,
        );
        const [row] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(teams)
          .where(
            and(eq(teams.organizationId, org.id), isNull(teams.archivedAt)),
          );
        if ((row?.count ?? 0) >= teamLimit) {
          return { limited: true as const };
        }
      }
      const [t] = await tx
        .insert(teams)
        .values({
          organizationId: org.id,
          name,
          sport: org.sport ?? req.body?.sport ?? undefined,
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
      // Platform admins bulk-creating teams for an org hand-off must not
      // appear on any roster (they manage via the canManageTeam bypass);
      // everyone else joins their new team as its admin coach.
      if (!creatorIsPlatformAdmin) {
        await tx.insert(rosterEntries).values({
          teamId: t.id,
          userId: me.id,
          role: "coach",
          status: "accepted",
          position: "admin",
          invitedById: me.id,
        });
      }
      return { limited: false as const, team: t };
    });
    if (result.limited) {
      return apiError(
        res,
        403,
        `Your ${plan} plan allows up to ${teamLimit} teams. Upgrade your plan to add more.`,
        { code: "TEAM_LIMIT_REACHED", extras: { limit: teamLimit, plan } },
      );
    }
    res.status(201).json(
      toTeam(result.team, org, {
        memberCount: creatorIsPlatformAdmin ? 0 : 1,
      }),
    );
  }),
);

router.get(
  "/teams/:teamId",
  asyncHandler(async (req, res) => {
    const [t] = await db.select().from(teams).where(eq(teams.id, req.params.teamId)).limit(1);
    if (!t) return notFound(res);
    // Task #628 — solo teams have no parent org (org is null).
    let org: typeof organizations.$inferSelect | null = null;
    if (t.organizationId) {
      [org] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, t.organizationId))
        .limit(1);
      if (!org) return notFound(res);
    }
    // Task #472 — archived teams are invisible to non-managers. Owners
    // and admins of the parent org still get the row back so they can
    // open the page to unarchive it; everyone else (anonymous, plain
    // members, followers) gets a 404 indistinguishable from a deleted
    // team. We do this check after the org lookup so we can use the
    // existing `canManageOrganization` helper. Solo teams fall back to
    // `canManageTeam` (owner/coach) for the same purpose.
    if (t.archivedAt) {
      const me = req.sessionUser;
      const canSeeArchived = me
        ? org
          ? await canManageOrganization(me.id, org.id)
          : await canManageTeam(me.id, t)
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
    // Task #628 — solo teams (no org) are edited by their owner/coach via
    // canManageTeam; org-backed teams require an owner/admin of the parent org.
    if (!(await canManageTeam(me.id, existing))) {
      return apiError(res, 403, "forbidden");
    }
    const body = req.body ?? {};
    const patch: Record<string, unknown> = {};
    if (typeof body.name === "string") patch.name = body.name.trim();
    if (typeof body.sport === "string") {
      if (existing.organizationId) {
        const [parentOrg] = await db
          .select({ sport: organizations.sport })
          .from(organizations)
          .where(eq(organizations.id, existing.organizationId))
          .limit(1);
        patch.sport = parentOrg?.sport ?? body.sport;
      } else {
        patch.sport = body.sport;
      }
    }
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
    // Task #691 — logo/banner arrive inline as base64 `data:` URLs. Reject
    // over-cap values with a friendly 413 (mirrors the app.ts body-parser
    // limit) instead of letting them fail as an opaque parser error.
    if (typeof body.logoUrl === "string") {
      if (
        body.logoUrl.startsWith("data:") &&
        body.logoUrl.length > MAX_IMAGE_DATA_URL_LENGTH
      ) {
        return apiError(
          res,
          413,
          "That image is too large. Please choose a smaller photo.",
        );
      }
      patch.logoUrl = body.logoUrl;
    }
    if (typeof body.bannerUrl === "string") {
      if (
        body.bannerUrl.startsWith("data:") &&
        body.bannerUrl.length > MAX_IMAGE_DATA_URL_LENGTH
      ) {
        return apiError(
          res,
          413,
          "That image is too large. Please choose a smaller photo.",
        );
      }
      patch.bannerUrl = body.bannerUrl;
    } else if (body.bannerUrl === null) patch.bannerUrl = null;
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
    // Task #628 — solo teams have no parent org.
    let org: typeof organizations.$inferSelect | null = null;
    if (t.organizationId) {
      [org] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, t.organizationId))
        .limit(1);
      if (!org) return notFound(res);
    }
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(rosterEntries)
      .where(eq(rosterEntries.teamId, t.id));
    res.json(toTeam(t, org, { memberCount: count }));
  }),
);

router.delete(
  "/teams/:teamId",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const teamId = String(req.params.teamId);
    const [existing] = await db
      .select()
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1);
    if (!existing) return notFound(res);
    if (!(await canManageOrganization(me.id, existing.organizationId))) {
      return apiError(res, 403, "Only this team's organization owners/admins or platform admins can permanently delete its page.");
    }

    const result = await db.transaction(async (tx) => {
      const [lockedTeam] = await tx
        .select()
        .from(teams)
        .where(eq(teams.id, teamId))
        .for("update")
        .limit(1);
      if (!lockedTeam) return { kind: "not_found" as const };
      // Standalone teams are outside this organization-team removal flow.
      if (!lockedTeam.organizationId) return { kind: "forbidden" as const };

      // Check the canonical organization again under locks: a team can move
      // organizations or an administrator can lose their role after preflight.
      const [actor] = await tx
        .select({ role: users.role })
        .from(users)
        .where(eq(users.id, me.id))
        .for("share")
        .limit(1);
      const [orgAdmin] = lockedTeam.organizationId ? await tx
        .select({ role: organizationAdmins.role })
        .from(organizationAdmins)
        .where(and(
          eq(organizationAdmins.organizationId, lockedTeam.organizationId),
          eq(organizationAdmins.userId, me.id),
        ))
        .for("share")
        .limit(1) : [];
      if (actor?.role !== "admin" && orgAdmin?.role !== "owner" && orgAdmin?.role !== "admin") {
        return { kind: "forbidden" as const };
      }
      if (!lockedTeam.archivedAt) {
        return { kind: "not_archived" as const };
      }
      if (req.body?.confirmTeamName !== lockedTeam.name ||
          req.body?.acknowledgePermanentDeletion !== true) {
        return { kind: "not_confirmed" as const };
      }

      await tx.delete(teams).where(eq(teams.id, teamId));
      return { kind: "deleted" as const };
    });

    if (result.kind === "not_found") return notFound(res);
    if (result.kind === "forbidden") {
      return apiError(res, 403, "Only this team's organization owners/admins or platform admins can permanently delete its page.");
    }
    if (result.kind === "not_archived") {
      return apiError(
        res,
        409,
        "Archive the team first. Permanent deletion is a separate, irreversible step.",
        { code: "team_not_archived" },
      );
    }
    if (result.kind === "not_confirmed") {
      return apiError(res, 400, "Type the exact team name and confirm that permanent deletion cannot be undone.", { code: "team_delete_not_confirmed" });
    }
    res.status(204).end();
  }),
);

async function repairOrganizationSelfInvites(req: Request, team: typeof teams.$inferSelect) {
  const activated = await reconcileOrganizationSelfInvites(team.id, team.organizationId);
  for (const userId of activated) {
    try {
      await ensureOrgFollowedForTeam(userId, team.id);
      await ensureTeamFollowed(userId, team.id);
    } catch (err) {
      req.log.warn({ err, userId, teamId: team.id }, "auto-follow on self-invite repair failed");
    }
  }
}

router.get(
  "/teams/:teamId/members",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    const [repairTeam] = await db.select().from(teams)
      .where(eq(teams.id, req.params.teamId)).limit(1);
    if (me && repairTeam && await canManageTeam(me.id, repairTeam)) {
      await repairOrganizationSelfInvites(req, repairTeam);
    }
    const rows = await db
      .select({ r: rosterEntries, u: users })
      .from(rosterEntries)
      .innerJoin(users, eq(rosterEntries.userId, users.id))
      .where(eq(rosterEntries.teamId, req.params.teamId))
      // Task #667/#668 — sort by display name case-insensitively so the
      // roster never leaks the raw insertion order. `name` is NOT NULL but
      // can be empty/whitespace, which `nulls last` alone wouldn't push to
      // the end; collapse those to NULL first so nameless members always
      // sort last, matching the client render-time safety net.
      .orderBy(sql`nullif(btrim(lower(${users.name})), '') asc nulls last`);
    // Task #755 — list ALL active guardians per member, not just the
    // primary mirrored in `parentId`.
    const guardianIdsByChild = await getActiveGuardianIdsForChildren(
      rows.map((r) => r.u.id),
    );
    const parentIds = Array.from(
      new Set([...guardianIdsByChild.values()].flat()),
    );
    const parentRows = parentIds.length
      ? await db.select().from(users).where(inArray(users.id, parentIds))
      : [];
    const parentMap = new Map(parentRows.map((p) => [p.id, p]));
    const [team] = await db.select().from(teams)
      .where(eq(teams.id, req.params.teamId)).limit(1);
    let canSeeParentEmail = false;
    if (me && team) {
      canSeeParentEmail =
        (await canManageOrganization(me.id, team.organizationId)) ||
        (await isTeamMember(me.id, team.id));
    }
    const data = rows.map((r) => {
      const base = toTeamMember(r.r, r.u);
      const parents = (guardianIdsByChild.get(r.u.id) ?? [])
        .map((gid) => parentMap.get(gid))
        .filter((p): p is NonNullable<typeof p> => !!p)
        .map((parent) => ({
          id: parent.id,
          displayName: parent.name || "Parent",
          email: canSeeParentEmail ? (parent.email ?? null) : null,
          avatarUrl: safeAvatarUrl(parent.avatarUrl),
        }));
      return {
        ...base,
        parents,
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
    await repairOrganizationSelfInvites(req, t);
    const rows = await db
      .select({ i: rosterInvites, u: users })
      .from(rosterInvites)
      .leftJoin(users, eq(rosterInvites.invitedById, users.id))
      .where(eq(rosterInvites.teamId, teamId))
      // Task #667/#668 — mirror the members ordering: case-insensitive by
      // invited name with nameless invites (NULL or empty) sorted last.
      .orderBy(
        sql`nullif(btrim(lower(${rosterInvites.invitedName})), '') asc nulls last`,
      );
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
    const teamId = req.params.teamId as string;
    const userId = String(req.body?.userId ?? "");
    if (!userId) return apiError(res, 400, "userId required");
    const [t] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
    if (!t) return notFound(res);
    // Platform admins may assign users to any team from the admin console.
    if (me.role !== "admin" && !(await canManageTeam(me.id, t)))
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
    const selfApproved = userId === me.id && await isOrganizationManager(me.id, t.organizationId);
    const { entry, outcome, created } = await db.transaction(async (tx) => {
      await lockRosterTeam(tx, teamId);
      const existing = await findRosterEntry(tx, teamId, userId);
      if (existing?.status === "accepted") {
        if (selfApproved && u.email)
          await revokeSelfInvites(tx, teamId, u.email, me.id);
        if (u.email && existing.role === "coach")
          await revokeRedundantInvites(tx, teamId, u.email);
        return { entry: existing, outcome: "already_active" as const, created: false };
      }
      if (existing && !selfApproved) {
        return { entry: existing, outcome: "already_pending" as const, created: false };
      }
      const [placed] = existing
        ? await tx.update(rosterEntries).set({
            role: dbRole, position: positionRaw === "coach" ? null : positionRaw,
            status: "accepted", invitedById: me.id,
          }).where(eq(rosterEntries.id, existing.id)).returning()
        : await tx.insert(rosterEntries).values({
            teamId, userId, role: dbRole,
            status: selfApproved ? "accepted" : "pending",
            position: positionRaw === "coach" ? null : positionRaw,
            invitedById: me.id,
          }).returning();
      if (selfApproved && u.email)
        await revokeSelfInvites(tx, teamId, u.email, me.id);
      return { entry: placed, outcome: selfApproved ? "auto_approved" as const : "invited" as const, created: true };
    });
    if (created || outcome === "already_pending") {
      await ensureOrgFollowedForTeam(userId, teamId);
      // If the added member is a minor with a linked guardian, auto-follow
      // the team on the parent's behalf so it surfaces under the parent's
      // profile Teams section (rendered as a `position: "parent"` row).
      // Task #434 — also auto-follow on the added user's own behalf so the
      // team appears in their feed without an extra Follow click. Both
      // best-effort.
      try {
        await ensureTeamFollowed(userId, teamId);
        // Task #755 — auto-follow for ALL active guardians.
        for (const gid of await getActiveGuardianIds(userId)) {
          await ensureTeamFollowedAsGuardian(gid, teamId);
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
      if (!selfApproved) {
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
      // Task #633 — `team_roster` email mirror. The dispatch gate routes a
      // minor invitee's copy to their guardian, so we do NOT also email the
      // parent bell below (that would double-send to the guardian inbox).
        await dispatchNotificationEmail({
        userId,
        // Suppress self-email when a guardian invites their own minor child
        // (the invitee's copy routes back to the actor guardian).
        excludeRecipientUserId: me.id,
        category: "team_roster",
        build: (ctx) =>
          buildRosterEmail(ctx, {
            subject: `You've been added to ${t.name}`,
            message: `${actorName} added you to ${t.name}. Tap to accept or decline.`,
            link: `${appBaseUrl()}/app/teams/${teamId}?roster=1&entryId=${entry.id}`,
          }),
        });
      // Fan out to the linked guardians, if any. A parent managing an
      // under-13 athlete needs to see the invite in their own bell and
      // be able to accept on the child's behalf from /family.
      // Task #755 — ALL active guardians, not just the primary.
        if (u.parentId) {
        const childFirstName =
          (u.name?.trim().split(/\s+/)[0] ?? "").length > 0
            ? u.name!.trim().split(/\s+/)[0]
            : "your child";
        // Task #414 — same write-time mask: guardian is privileged
        // for `u` (their child) but not necessarily for `me`.
        for (const gid of await getActiveGuardianIds(u.id)) {
          await db.insert(notifications).values({
            userId: gid,
            kind: "roster_invite_for_child",
            message: `${actorName} invited ${childFirstName} to join ${t.name}.`,
            link: `/family?childId=${u.id}&entryId=${entry.id}&teamId=${teamId}`,
            actorUserId: me.id,
          });
        }
        }
      }
    }
    res.status(201).json({ ...toTeamMember(entry, u), outcome });
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

// Viewer-friendly label for a stored `roster_entries.position` value.
// Persisted column may be `null` (which positionToRosterFields uses for
// plain "coach"), one of the canonical strings in ALLOWED_POSITIONS, or a
// legacy free-form string from earlier writes. Used by Task #536 to
// describe the new role in role-change bell notifications.
function positionDisplayLabel(position: string | null): string {
  if (!position || !position.trim()) return "Coach";
  const map: Record<string, string> = {
    player: "Player",
    coach: "Coach",
    assistant_coach: "Assistant Coach",
    admin: "Admin",
    manager: "Manager",
    parent: "Parent",
    author: "Author",
  };
  return map[position] ?? position;
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

    // Task #536 — Notify the affected member (and their guardian, if
    // any) when a coach/admin changes their position. The PATCH path is
    // otherwise silent, so users would only discover a promotion by
    // re-visiting the team page. Skipped when the position is unchanged
    // (jersey-only edit, or no-op write) and when the actor is editing
    // their own row.
    const oldPositionNorm = (entry.position ?? "").trim();
    const newPositionNorm = (newPosition ?? "").trim();
    const positionChanged =
      positionProvided && oldPositionNorm !== newPositionNorm;
    if (positionChanged && me.id !== u.id) {
      const actorName = me.isMinor ? maskedDisplayName(me) : displayName(me);
      const roleLabel = positionDisplayLabel(newPosition);
      await db.insert(notifications).values({
        userId: u.id,
        kind: "roster_role_changed",
        message: `${actorName} changed your role on ${t.name} to ${roleLabel}.`,
        link: `/teams/${teamId}?roster=1&entryId=${entry.id}`,
        actorUserId: me.id,
      });
      // Task #633 — `team_roster` email mirror. Gate routes a minor's copy to
      // the guardian, so the parent bell below is in-app only (no double-send).
      await dispatchNotificationEmail({
        userId: u.id,
        excludeRecipientUserId: me.id,
        category: "team_roster",
        build: (ctx) =>
          buildRosterEmail(ctx, {
            subject: `Your role on ${t.name} changed`,
            message: `${actorName} changed your role on ${t.name} to ${roleLabel}.`,
            link: `${appBaseUrl()}/app/teams/${teamId}?roster=1&entryId=${entry.id}`,
          }),
      });
      // Task #755 — notify ALL active guardians.
      if (u.parentId) {
        const childFirstName =
          (u.name?.trim().split(/\s+/)[0] ?? "").length > 0
            ? u.name!.trim().split(/\s+/)[0]
            : "your child";
        for (const gid of await getActiveGuardianIds(u.id)) {
          await db.insert(notifications).values({
            userId: gid,
            kind: "roster_role_changed_for_child",
            message: `${actorName} changed ${childFirstName}'s role on ${t.name} to ${roleLabel}.`,
            link: `/family?childId=${u.id}&entryId=${entry.id}&teamId=${teamId}`,
            actorUserId: me.id,
          });
        }
      }
    }

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
      return notFound(res);
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
    await db.transaction(async (tx) => {
      // Deliberately remove only the roster row. Guardian links describe a
      // family relationship, not team membership, and must survive removal.
      await tx.delete(rosterEntries).where(eq(rosterEntries.id, entry.id));
      await tx.insert(adminActivityLog).values({
        adminUserId: me.id,
        actionType: "moderation_remove",
        targetType: "roster_entry",
        targetId: entry.id,
        metadata: JSON.stringify({
          organizationId: t.organizationId,
          teamId: t.id,
          // No name/email/body is retained in moderation metadata.
          memberUserId: entry.userId,
        }),
      });
    });
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
  // Task #755 — any ACTIVE guardian may act, not just the primary.
  if (await isActiveGuardian(me.id, entryUserId)) {
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
      // Task #755 — auto-follow for ALL active guardians.
      for (const gid of await getActiveGuardianIds(entry.userId)) {
        await ensureTeamFollowedAsGuardian(gid, entry.teamId);
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
    const teamId = req.params.teamId as string;
    const [t] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
    if (!t) return notFound(res);
    // Platform admins may invite users to any team from the admin console.
    if (me.role !== "admin" && !(await canManageTeam(me.id, t)))
      return apiError(res, 403, "Team coaches or org admins only");
    // Task #472 — block new email invites on an archived team. Mirrors
    // the direct-add block above; an archived team should not be able
    // to accumulate fresh pending invitees.
    if (t.archivedAt)
      return apiError(res, 409, "Team is archived", { code: "team_archived" });
    const email = String(req.body?.email ?? "").trim();
    if (!email) return apiError(res, 400, "email required");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return apiError(res, 400, "Enter a complete email address, such as name@example.com.");
    const positionRaw = String(req.body?.position ?? "player");
    const dbRole: "player" | "coach" =
      positionRaw === "coach" ||
      positionRaw === "assistant_coach" ||
      positionRaw === "admin"
        ? "coach"
        : "player";
    const normalizedEmail = email.toLowerCase();
    // Only an actual org manager explicitly inviting themselves skips acceptance,
    // for every position. Other player invitations still use the child chooser.
    const selfApproved = normalizedEmail === me.email?.trim().toLowerCase() &&
      await isOrganizationManager(me.id, t.organizationId);
    const placement = await db.transaction(async (tx) => {
      await lockRosterTeam(tx, teamId);
      const existingUser = selfApproved
        ? (await tx.select().from(users).where(eq(users.id, me.id)).limit(1))[0]
        : await findAccountByEmail(tx, normalizedEmail);
      const existingEntry = existingUser
        ? await findRosterEntry(tx, teamId, existingUser.id) : undefined;
      // A player email invite can address the parent of a *different* child.
      // Only a staff invitation identifies the addressee as the member.
      if ((dbRole === "coach" || selfApproved) && existingEntry?.status === "accepted") {
        if (dbRole === "coach")
          await revokeRedundantInvites(tx, teamId, normalizedEmail, dbRole);
        if (selfApproved)
          await revokeSelfInvites(tx, teamId, normalizedEmail, me.id);
        return { outcome: "already_active" as const, existingUser, invite: null, entry: existingEntry };
      }
      if (selfApproved && existingUser) {
        const [entry] = existingEntry
          ? await tx.update(rosterEntries).set({
              status: "accepted", role: dbRole,
              position: positionRaw === "coach" ? null : positionRaw,
              invitedById: me.id,
            }).where(eq(rosterEntries.id, existingEntry.id)).returning()
          : await tx.insert(rosterEntries).values({
              teamId, userId: existingUser.id, role: dbRole, status: "accepted",
              position: positionRaw === "coach" ? null : positionRaw, invitedById: me.id,
            }).returning();
        await revokeSelfInvites(tx, teamId, normalizedEmail, me.id);
        return { outcome: "auto_approved" as const, existingUser, invite: null, entry };
      }
      const pendingInvite = dbRole === "coach"
        ? await findPendingInvite(tx, teamId, normalizedEmail, dbRole)
        : undefined;
      if (pendingInvite) {
        return { outcome: "already_pending" as const, existingUser, invite: pendingInvite, entry: existingEntry };
      }
      const token = `inv-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
      const [invite] = await tx.insert(rosterInvites).values({
        token, teamId, invitedEmail: normalizedEmail, invitedName: req.body?.name ?? null,
        role: dbRole, position: positionRaw === "coach" ? null : positionRaw, invitedById: me.id,
      }).returning();
      let entry = existingEntry;
      if (existingUser && dbRole === "coach") {
        [entry] = entry
          ? await tx.update(rosterEntries).set({
              role: dbRole, status: "pending",
              position: positionRaw === "coach" ? null : positionRaw, invitedById: me.id,
            }).where(eq(rosterEntries.id, entry.id)).returning()
          : await tx.insert(rosterEntries).values({
              teamId, userId: existingUser.id, role: dbRole, status: "pending",
              position: positionRaw === "coach" ? null : positionRaw, invitedById: me.id,
            }).returning();
      }
      return { outcome: "invited" as const, existingUser, invite, entry };
    });
    if (placement.outcome === "already_active" || placement.outcome === "auto_approved") {
      if (placement.outcome === "auto_approved") {
        await ensureOrgFollowedForTeam(me.id, teamId);
        await ensureTeamFollowed(me.id, teamId);
      }
      return res.status(200).json({ outcome: placement.outcome, emailSent: null });
    }
    // An explicit repeat submission reuses the invite and roster row but
    // sends another notification/email; pending is not a delivery no-op.
    const reminded = placement.outcome === "already_pending";
    const { invite, existingUser, entry } = placement;

    // If a Kinectem account already exists for this email, fan out an
    // in-app notification so they (and their linked guardian, if any) can
    // act without waiting for the email link.
    //
    // Coach/staff invites to an existing account place that user on the
    // roster as pending so they can accept the spot in-app, mirroring the
    // direct-add path's fan-out.
    //
    // Task #645 — Player invites are different: the matched account is
    // usually the *parent*, not the child who plays. We must NOT put that
    // account on the roster as the player. Instead we notify them and
    // route them to the invite acceptance screen, where they confirm and
    // pick the actual player via the existing chooser. No roster row,
    // team-follow, or org-follow is created until the chooser completes —
    // this aligns the existing-account fast path with the email-link flow.
    // Every new pending email invitation is emailed, including invitations
    // addressed to existing accounts that also receive an in-app alert.
    let emailSent: boolean | null = null;
    if (existingUser && dbRole === "coach") {
      if (entry) {
        await ensureOrgFollowedForTeam(existingUser.id, teamId);
        // Task #434 — auto-follow on the invited user's own behalf in
        // addition to the existing parent-side follow. Best-effort.
        try {
          await ensureTeamFollowed(existingUser.id, teamId);
          // Task #755 — auto-follow for ALL active guardians.
          for (const gid of await getActiveGuardianIds(existingUser.id)) {
            await ensureTeamFollowedAsGuardian(gid, teamId);
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
        // Task #755 — notify ALL active guardians.
        if (existingUser.parentId) {
          const childFirstName =
            (existingUser.name?.trim().split(/\s+/)[0] ?? "").length > 0
              ? existingUser.name!.trim().split(/\s+/)[0]
              : "your child";
          for (const gid of await getActiveGuardianIds(existingUser.id)) {
            await db.insert(notifications).values({
              userId: gid,
              kind: "roster_invite_for_child",
              message: `${actorName} invited ${childFirstName} to join ${t.name}.`,
              link: `/family?childId=${existingUser.id}&entryId=${entry.id}&teamId=${teamId}`,
              actorUserId: me.id,
            });
          }
        }
      } else {
        const actorName = me.isMinor ? maskedDisplayName(me) : displayName(me);
        await db.insert(notifications).values({
          userId: existingUser.id,
          kind: "roster_invite",
          message: `${actorName} invited you to ${t.name}. Tap to accept or decline.`,
          link: `/invites/${invite.token}`,
          actorUserId: me.id,
        });
      }
    } else if (existingUser) {
      // Task #645 — player invite to an existing account. Create NO roster
      // entry and run NO team/org auto-follow: the matched account is
      // usually the parent, who must not be rostered as the player.
      // Notify them (and their linked guardian, if any) with a deep-link to
      // the invite acceptance screen, where they pick the real player via
      // the existing chooser. We use the plain `roster_invite` kind (not
      // `roster_invite_for_child`) precisely because there is no roster
      // entry id to back the inline Accept/Decline buttons — the link must
      // lead into the chooser instead. Minor-actor masking mirrors the
      // coach path above.
      const actorName = me.isMinor ? maskedDisplayName(me) : displayName(me);
      await db.insert(notifications).values({
        userId: existingUser.id,
        kind: "roster_invite",
        message: `${actorName} invited you to ${t.name}. Tap to choose who's playing.`,
        link: `/invites/${invite.token}`,
        actorUserId: me.id,
      });
      // Task #755 — notify ALL active guardians.
      if (existingUser.parentId) {
        const childFirstName =
          (existingUser.name?.trim().split(/\s+/)[0] ?? "").length > 0
            ? existingUser.name!.trim().split(/\s+/)[0]
            : "your child";
        for (const gid of await getActiveGuardianIds(existingUser.id)) {
          await db.insert(notifications).values({
            userId: gid,
            kind: "roster_invite",
            message: `${actorName} invited ${childFirstName} to join ${t.name}.`,
            link: `/invites/${invite.token}`,
            actorUserId: me.id,
          });
        }
      }
    }
    {
      // Deliver the invite link by email whether or not the recipient has an
      // account. The in-app notification above is an additional channel, not
      // a substitute: existing users may not be signed in when invited.
      const actorName = me.isMinor ? maskedDisplayName(me) : displayName(me);
      try {
        // Task #837 — staff invitees (coach / assistant coach / manager) get
        // the staff-oriented invite email; everyone else keeps the
        // parent-oriented copy verbatim.
        if (isStaffInvitePosition(positionRaw)) {
          await sendStaffInviteEmail(email, {
            inviterName: actorName,
            teamName: t.name,
            roleLabel: staffInviteRoleLabel(positionRaw),
            token: invite.token,
            inviteId: invite.id,
          });
        } else {
          await sendCoachInviteEmail(email, {
            coachName: actorName,
            token: invite.token,
            inviteId: invite.id,
          });
        }
        emailSent = true;
        // Task #666 — record the successful hand-off to SendGrid. Later Event
        // Webhook events (delivered/bounced/etc) supersede this.
        await db
          .update(rosterInvites)
          .set({ deliveryStatus: "sent" })
          .where(eq(rosterInvites.id, invite.id));
      } catch (err) {
        // Task #654 — the pending invite is already persisted, so a delivery
        // failure must NOT fail the request. Instead report it so the coach
        // can fall back to copying the invite link and messaging directly.
        emailSent = false;
        req.log.warn(
          { err, teamId, kind: "coach_invite" },
          "coach invite email send failed",
        );
      }
    }

    // Task #654 — append the email-send outcome and the public accept URL
    // outside the locked openapi.yaml; the client reads them via a narrow cast
    // (mirrors the `hasOwner`/`myClaimStatus` pattern).
    res.status(reminded ? 200 : 201).json({
      ...toInvite(invite, me),
      outcome: reminded ? "reminded" : "invited",
      emailSent,
      acceptUrl: buildInviteAcceptUrl(invite.token),
    });
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
      // Task #646 — when the invited email belongs to an existing
      // account, the send-invite path also created a `pending`
      // roster_entries row. Revoking only the invite would leave that
      // entry behind, which then silently blocks any future re-invite
      // (the send path skips placement when an entry already exists).
      // Clean up the matching still-pending entry in the same
      // transaction so the two records stay consistent. An
      // already-accepted membership is never touched.
      const finalStatus = await db.transaction(async (tx) => {
        // The acceptance flow can race with a manager withdrawal. Claim the
        // state transition conditionally so the operation that commits first
        // wins; never report a successful withdrawal after acceptance did.
        const [revoked] = await tx
          .update(rosterInvites)
          .set({ status: "revoked" })
          .where(
            and(
              eq(rosterInvites.id, invite.id),
              eq(rosterInvites.status, "pending"),
            ),
          )
          .returning({ status: rosterInvites.status });
        if (!revoked) {
          const [latest] = await tx
            .select({ status: rosterInvites.status })
            .from(rosterInvites)
            .where(eq(rosterInvites.id, invite.id))
            .limit(1);
          return latest?.status ?? invite.status;
        }
        if (invite.invitedEmail) {
          const [invitedUser] = await tx
            .select()
            .from(users)
            .where(eq(users.email, invite.invitedEmail.toLowerCase()))
            .limit(1);
          if (invitedUser) {
            await tx
              .delete(rosterEntries)
              .where(
                and(
                  eq(rosterEntries.teamId, teamId),
                  eq(rosterEntries.userId, invitedUser.id),
                  eq(rosterEntries.status, "pending"),
                ),
              );
          }
        }
        return revoked.status;
      });
      return res.json({
        id: invite.id,
        status: finalStatus === "revoked" ? "withdrawn" : finalStatus,
      });
    }
    res.json({
      id: invite.id,
      status: invite.status === "revoked" ? "withdrawn" : invite.status,
    });
  }),
);

// Task #655 — re-send an invite that didn't arrive. A coach may need to
// retry the email for a still-pending invite that bounced or landed in
// spam. Keyed per inviter so one coach can't hammer the send path, and
// shared across the resend route below. Modest allowance covers a few
// honest retries while blocking abuse.
const inviteResendLimiter = rateLimit({
  name: "roster-invite-resend",
  windowMs: 60_000,
  max: 10,
  keys: (req) => [req.sessionUser?.id ?? ipKey(req)],
  message:
    "You're re-sending invites too quickly. Please wait a moment and try again.",
});

// Task #655 — re-trigger the invite for an existing pending invite without
// minting a new token or creating duplicate roster rows. Mirrors the
// create path's fan-out and reports the same `emailSent` outcome:
//   - no Kinectem account for the address → re-send the coach invite email
//     (emailSent true/false).
//   - account exists → re-fire the in-app notification (emailSent null),
//     reusing the roster entry that the original send already created.
// Idempotent on the persisted records (no new token / roster rows) and
// rate-limited via inviteResendLimiter.
router.post(
  "/teams/:teamId/invites/:inviteId/resend",
  inviteResendLimiter,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const teamId = req.params.teamId;
    const inviteId = req.params.inviteId;
    const [t] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
    if (!t) return notFound(res);
    if (!(await canManageTeam(me.id, t)))
      return apiError(res, 403, "Team coaches or org admins only");
    // An archived team is read-only; don't re-send invites into it
    // (mirrors the create path's archived guard).
    if (t.archivedAt)
      return apiError(res, 409, "Team is archived", { code: "team_archived" });
    const [invite] = await db
      .select()
      .from(rosterInvites)
      .where(
        and(eq(rosterInvites.id, inviteId), eq(rosterInvites.teamId, teamId)),
      )
      .limit(1);
    if (!invite) return notFound(res);
    // Only a still-pending invite can be re-sent. Anything terminal
    // (accepted / declined / expired / revoked) has nothing to re-deliver.
    if (invite.status !== "pending")
      return apiError(res, 409, "Invite is no longer pending", {
        code: "invite_not_pending",
      });
    if (!invite.invitedEmail)
      return apiError(res, 409, "Invite has no email to re-send", {
        code: "invite_no_email",
      });
    if (invite.role === "coach") {
      const accepted = await db.transaction(async (tx) => {
        await lockRosterTeam(tx, teamId as string);
        const account = await findAccountByEmail(tx, invite.invitedEmail!);
        const entry = account && await findRosterEntry(tx, teamId as string, account.id);
        if (entry?.status !== "accepted") return false;
        await revokeRedundantInvites(tx, teamId as string, invite.invitedEmail!);
        return true;
      });
      if (accepted) return apiError(res, 409, "Already active on this team", {
        code: "already_active",
      });
    }

    const email = invite.invitedEmail;
    const [existingUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, email.toLowerCase()))
      .limit(1);

    // A pending invitation is emailed even when the recipient already has an
    // account; the in-app notification below remains an additional channel.
    let emailSent: boolean | null = null;
    // Write-time mask when the actor is a minor (mirrors the create path).
    const actorName = me.isMinor ? maskedDisplayName(me) : displayName(me);

    if (existingUser) {
      // Re-fire the in-app notification too. We do NOT create or
      // modify roster_entries here: the original send already placed any
      // coach invitee, so re-sending must not duplicate roster rows.
      if (invite.role === "coach") {
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
        await db.insert(notifications).values({
          userId: existingUser.id,
          kind: "roster_invite",
          message: `${actorName} invited you to ${t.name}. Tap to accept or decline.`,
          link: existingEntry
            ? `/teams/${teamId}?roster=1&entryId=${existingEntry.id}`
            : `/invites/${invite.token}`,
          actorUserId: me.id,
        });
        // Task #755 — notify ALL active guardians.
        if (existingUser.parentId) {
          const childFirstName =
            (existingUser.name?.trim().split(/\s+/)[0] ?? "").length > 0
              ? existingUser.name!.trim().split(/\s+/)[0]
              : "your child";
          for (const gid of await getActiveGuardianIds(existingUser.id)) {
            await db.insert(notifications).values({
              userId: gid,
              kind: "roster_invite_for_child",
              message: `${actorName} invited ${childFirstName} to join ${t.name}.`,
              link: existingEntry
                ? `/family?childId=${existingUser.id}&entryId=${existingEntry.id}&teamId=${teamId}`
                : `/invites/${invite.token}`,
              actorUserId: me.id,
            });
          }
        }
      } else {
        // Player invite to an existing (usually parent) account — route to
        // the chooser via the token link, no roster row. Mirrors the
        // create path's player branch.
        await db.insert(notifications).values({
          userId: existingUser.id,
          kind: "roster_invite",
          message: `${actorName} invited you to ${t.name}. Tap to choose who's playing.`,
          link: `/invites/${invite.token}`,
          actorUserId: me.id,
        });
        // Task #755 — notify ALL active guardians.
        if (existingUser.parentId) {
          const childFirstName =
            (existingUser.name?.trim().split(/\s+/)[0] ?? "").length > 0
              ? existingUser.name!.trim().split(/\s+/)[0]
              : "your child";
          for (const gid of await getActiveGuardianIds(existingUser.id)) {
            await db.insert(notifications).values({
              userId: gid,
              kind: "roster_invite",
              message: `${actorName} invited ${childFirstName} to join ${t.name}.`,
              link: `/invites/${invite.token}`,
              actorUserId: me.id,
            });
          }
        }
      }
    }
    {
      // Re-send the existing token to the invited email whether or not the
      // address has an account. Failure is reported so the inviter can share
      // the link manually; it must not change the pending invite.
      try {
        // Task #837 — mirror the create path's role branching: a pending
        // staff invite re-sends the staff email, not the parent one. A null
        // position with role "coach" means plain head coach.
        const invitePosition =
          invite.position ?? (invite.role === "coach" ? "coach" : "player");
        if (isStaffInvitePosition(invitePosition)) {
          await sendStaffInviteEmail(email, {
            inviterName: actorName,
            teamName: t.name,
            roleLabel: staffInviteRoleLabel(invitePosition),
            token: invite.token,
            inviteId: invite.id,
          });
        } else {
          await sendCoachInviteEmail(email, {
            coachName: actorName,
            token: invite.token,
            inviteId: invite.id,
          });
        }
        emailSent = true;
        // Task #666 — record the successful hand-off to SendGrid. Later Event
        // Webhook events (delivered/bounced/etc) supersede this.
        await db
          .update(rosterInvites)
          .set({ deliveryStatus: "sent" })
          .where(eq(rosterInvites.id, invite.id));
      } catch (err) {
        emailSent = false;
        req.log.warn(
          { err, teamId, kind: "coach_invite_resend" },
          "coach invite resend email send failed",
        );
      }
    }

    // Mirror the create path: append the email-send outcome and accept URL
    // outside the locked openapi.yaml; the client reads them via a narrow
    // cast (same pattern as create).
    res.json({
      ...toInvite(invite, me),
      emailSent,
      acceptUrl: buildInviteAcceptUrl(invite.token),
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
    // Task #755 — any ACTIVE guardian qualifies, not just the primary.
    const isGuardian =
      !req.isMasquerading && (await isActiveGuardian(me.id, childId));
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
// Organization owners/admins and effective platform admins can archive or permanently delete
// these team pages. Deletion requires prior archival and explicit confirmation.
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
): Promise<{ team: typeof teams.$inferSelect; actorId: string } | null> {
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
  if (t.organizationId && (role === "owner" || role === "admin" || await isPlatformAdmin(me.id))) {
    return { team: t, actorId: me.id };
  }
  if (role === "member") {
    apiError(res, 403, "Only organization owners/admins or platform admins can archive or restore a team");
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
    const { team, actorId } = ctx;
    let updated = team;
    if (!team.archivedAt) {
      const [row] = await db
        .update(teams)
        .set({ archivedAt: new Date(), archivedByUserId: actorId })
        .where(eq(teams.id, team.id))
        .returning();
      updated = row ?? team;
      await db.insert(adminActivityLog).values({
        adminUserId: actorId,
        actionType: "archive_team",
        targetType: "team",
        targetId: team.id,
        metadata: JSON.stringify({
          organizationId: team.organizationId,
          teamName: team.name,
        }),
      });
      if (updated.organizationId)
        await notifyTeamArchived({
          teamId: updated.id,
          organizationId: updated.organizationId,
          teamName: updated.name,
          actorUserId: actorId,
      });
    }
    // Solo teams (no org) are rejected by loadTeamForArchiveAction, so by
    // here a team always has an org; guard keeps the nullable type honest.
    let org: typeof organizations.$inferSelect | null = null;
    if (updated.organizationId) {
      [org] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, updated.organizationId))
        .limit(1);
    }
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
    const { team, actorId } = ctx;
    let updated = team;
    if (team.archivedAt) {
      const [row] = await db
        .update(teams)
        .set({ archivedAt: null, archivedByUserId: null })
        .where(eq(teams.id, team.id))
        .returning();
      updated = row ?? team;
      await db.insert(adminActivityLog).values({
        adminUserId: actorId,
        actionType: "unarchive_team",
        targetType: "team",
        targetId: team.id,
        metadata: JSON.stringify({
          organizationId: team.organizationId,
          teamName: team.name,
        }),
      });
      if (updated.organizationId)
        await notifyTeamUnarchived({
          teamId: updated.id,
          organizationId: updated.organizationId,
          teamName: updated.name,
          actorUserId: actorId,
      });
    }
    // Task #628 — solo teams 403 earlier; guard keeps the nullable type honest.
    let org: typeof organizations.$inferSelect | null = null;
    if (updated.organizationId) {
      [org] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, updated.organizationId))
        .limit(1);
    }
    if (!org) return notFound(res);
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(rosterEntries)
      .where(eq(rosterEntries.teamId, updated.id));
    return res.json(toTeam(updated, org, { memberCount: count }));
  }),
);

// ---- Season / tournament recap (AI) ----
// Lets a coach/author weave a team's published game recaps over a date
// range into one cohesive long-form recap (a tournament's worth of games
// or a whole season). Mirrors the org newsletter endpoints, scoped to one
// team. openapi.yaml is locked, so the web client talks to these via
// customFetch + narrow casts (Newsletter/AI precedent).
const TEAM_SEASON_RECAP_MAX = 25;
const TEAM_SEASON_RECAP_NEWS_CONTEXT_MAX = 5;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Parse a `YYYY-MM-DD` (or any Date-parseable) string into epoch ms, or
// null. `endOfDay` pushes a bare date to 23:59:59.999 so the window is
// inclusive of the whole end day.
function parseSeasonDateParam(value: unknown, endOfDay = false): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const d = new Date(value.trim());
  if (Number.isNaN(d.getTime())) return null;
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    d.setHours(23, 59, 59, 999);
  }
  return d.getTime();
}

// Resolve a team's published recaps within an (inclusive) date window,
// keyed off the game date and falling back to the publish/create date.
// Ordered chronologically so the AI can narrate the games in order.
async function loadTeamSeasonRecaps(
  teamId: string,
  startMs: number | null,
  endMs: number | null,
  recapIds: string[] | null,
): Promise<
  Array<{
    id: string;
    title: string;
    gameDate: Date | null;
    opponentName: string | null;
    teamScore: number | null;
    opponentScore: number | null;
    summary: string | null;
  }>
> {
  const effDate = sql<Date>`coalesce(${articles.gameDate}, ${articles.publishedAt}, ${articles.createdAt})`;
  const conds = [
    eq(articles.teamId, teamId),
    eq(articles.status, "published"),
    or(isNull(articles.articleKind), eq(articles.articleKind, "recap")),
    isNull(articles.hiddenAt),
  ];
  if (startMs != null) conds.push(sql`${effDate} >= ${new Date(startMs)}`);
  if (endMs != null) conds.push(sql`${effDate} <= ${new Date(endMs)}`);
  if (recapIds != null) {
    if (recapIds.length === 0) return [];
    conds.push(inArray(articles.id, recapIds));
  }
  return db
    .select({
      id: articles.id,
      title: articles.title,
      gameDate: articles.gameDate,
      opponentName: articles.opponentName,
      teamScore: articles.teamScore,
      opponentScore: articles.opponentScore,
      summary: articles.summary,
    })
    .from(articles)
    .where(and(...conds))
    .orderBy(asc(effDate))
    .limit(200);
}

// Resolve dated "In the News" links for the same team-scoped period as the
// game recaps. Undated news cards are intentionally excluded: they describe
// the team but cannot be safely associated with a game-period recap.
async function loadTeamSeasonNews(
  teamId: string,
  startDate: string | null,
  endDate: string | null,
  newsIds: string[] | null,
): Promise<
  Array<{
    id: string;
    title: string;
    sourceName: string | null;
    gameDate: string;
    description: string | null;
      url: string;
  }>
> {
  const conds = [
    eq(teamNewsLinks.teamId, teamId),
    isNotNull(teamNewsLinks.gameDate),
  ];
  if (startDate) conds.push(gte(teamNewsLinks.gameDate, startDate));
  if (endDate) conds.push(lte(teamNewsLinks.gameDate, endDate));
  if (newsIds != null) {
    if (newsIds.length === 0) return [];
    conds.push(inArray(teamNewsLinks.id, newsIds));
  }
  const rows = await db
    .select({
      id: teamNewsLinks.id,
      title: teamNewsLinks.title,
      sourceName: teamNewsLinks.sourceName,
      gameDate: teamNewsLinks.gameDate,
      description: teamNewsLinks.description,
      url: teamNewsLinks.url,
    })
    .from(teamNewsLinks)
    .where(and(...conds))
    .orderBy(
      asc(teamNewsLinks.gameDate),
      asc(teamNewsLinks.createdAt),
      asc(teamNewsLinks.id),
    )
    .limit(TEAM_SEASON_RECAP_MAX);
  // Drizzle cannot infer the `IS NOT NULL` condition above into the select
  // type, although the database guarantees it for every returned row.
  return rows.map((row) => ({ ...row, gameDate: row.gameDate! }));
}

async function loadTeamSeasonNewsAvailability(teamId: string): Promise<{
  datedCount: number;
  undatedCount: number;
  earliestGameDate: string | null;
  latestGameDate: string | null;
}> {
  const [row] = await db
    .select({
      datedCount: sql<number>`count(*) filter (where ${teamNewsLinks.gameDate} is not null)::int`,
      undatedCount: sql<number>`count(*) filter (where ${teamNewsLinks.gameDate} is null)::int`,
      earliestGameDate: sql<string | null>`min(${teamNewsLinks.gameDate})`,
      latestGameDate: sql<string | null>`max(${teamNewsLinks.gameDate})`,
    })
    .from(teamNewsLinks)
    .where(eq(teamNewsLinks.teamId, teamId));
  return {
    datedCount: row?.datedCount ?? 0,
    undatedCount: row?.undatedCount ?? 0,
    earliestGameDate: row?.earliestGameDate ?? null,
    latestGameDate: row?.latestGameDate ?? null,
  };
}

const teamSeasonRecapLimiter = rateLimit({
  name: "team-season-recap",
  windowMs: 60_000,
  max: 20,
  keys: (req) => [req.sessionUser?.id ?? ipKey(req)],
  message:
    "You're generating recaps too quickly. Please wait a moment and try again.",
});

router.get(
  "/teams/:teamId/season-recap/recaps",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const teamId =
      typeof req.params.teamId === "string" ? req.params.teamId : req.params.teamId?.[0];
    if (!teamId) return notFound(res);
    const [team] = await db
      .select()
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1);
    if (!team) return notFound(res);
    if (!(await canCreateRecap(me.id, team))) {
      return apiError(
        res,
        403,
        "You don't have permission to author recaps for this team.",
      );
    }
    const startQuery =
      typeof req.query.start === "string" ? req.query.start : undefined;
    const endQuery =
      typeof req.query.end === "string" ? req.query.end : undefined;
    const startMs = parseSeasonDateParam(startQuery);
    const endMs = parseSeasonDateParam(endQuery, true);
    const startNewsDate = normalizeNewsGameDate(startQuery);
    const endNewsDate = normalizeNewsGameDate(endQuery);
    const [recaps, news, newsAvailability] = await Promise.all([
      loadTeamSeasonRecaps(teamId, startMs, endMs, null),
      loadTeamSeasonNews(
        teamId,
        typeof startNewsDate === "string" ? startNewsDate : null,
        typeof endNewsDate === "string" ? endNewsDate : null,
        null,
      ),
      loadTeamSeasonNewsAvailability(teamId),
    ]);
    res.json({
      data: recaps.map((r) => ({
        id: r.id,
        title: r.title,
        gameDate: r.gameDate ? r.gameDate.toISOString() : null,
        opponentName: r.opponentName,
        teamScore: r.teamScore,
        opponentScore: r.opponentScore,
      })),
      news: news.map((n) => ({
        id: n.id,
        title: n.title,
        sourceName: n.sourceName,
        gameDate: `${n.gameDate}T00:00:00.000Z`,
        description: n.description,
      })),
      newsAvailability,
    });
  }),
);

router.post(
  "/teams/:teamId/season-recap/generate",
  teamSeasonRecapLimiter,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const teamId =
      typeof req.params.teamId === "string" ? req.params.teamId : req.params.teamId?.[0];
    if (!teamId) return notFound(res);
    const [team] = await db
      .select()
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1);
    if (!team) return notFound(res);
    if (!(await canCreateRecap(me.id, team))) {
      return apiError(
        res,
        403,
        "You don't have permission to author recaps for this team.",
      );
    }
    // Mirror the COPPA egress boundary on POST /ai/assist: only users who
    // can author recaps anywhere may push content to the third-party AI
    // provider. Team staff always satisfy this, but the explicit check
    // keeps the guarantee local to the AI egress.
    if (!(await canAuthorRecapAnywhere(me.id))) {
      return apiError(res, 403, "You don't have permission to use AI Assist.", {
        code: "AI_FORBIDDEN",
      });
    }

    const body = req.body ?? {};
    const startMs = parseSeasonDateParam(body.startDate);
    const endMs = parseSeasonDateParam(body.endDate, true);
    const startNewsDate = normalizeNewsGameDate(body.startDate);
    const endNewsDate = normalizeNewsGameDate(body.endDate);
    if (startNewsDate === "invalid" || endNewsDate === "invalid") {
      return apiError(
        res,
        400,
        "startDate and endDate must be valid dates (YYYY-MM-DD).",
        { code: "VALIDATION_FAILED" },
      );
    }
    if (startMs != null && endMs != null && startMs > endMs) {
      return apiError(res, 400, "Start date must be before end date.", {
        code: "VALIDATION_FAILED",
      });
    }
    let recapIds: string[] | null = null;
    if (body.recapIds != null) {
      if (!Array.isArray(body.recapIds)) {
        return apiError(res, 400, "recapIds must be a list.", {
          code: "VALIDATION_FAILED",
        });
      }
      recapIds = Array.from(
        new Set(
          body.recapIds.filter(
            (x: unknown): x is string => typeof x === "string" && !!x,
          ),
        ),
      );
    }

    let newsIds: string[] | null = null;
    if (body.newsIds != null) {
      if (!Array.isArray(body.newsIds)) {
        return apiError(res, 400, "newsIds must be a list.", {
          code: "VALIDATION_FAILED",
        });
      }
      if (
        body.newsIds.some(
          (id: unknown) =>
            typeof id !== "string" ||
            !UUID_PATTERN.test(id.trim()),
        )
      ) {
        return apiError(
          res,
          400,
          "newsIds must contain valid news story IDs.",
          { code: "VALIDATION_FAILED" },
        );
      }
      newsIds = Array.from(
        new Set(body.newsIds.map((id: string) => id.trim())),
      );
      if (newsIds.length > TEAM_SEASON_RECAP_MAX) {
        return apiError(
          res,
          400,
          `Too many news stories selected (${newsIds.length}). Please narrow it down to ${TEAM_SEASON_RECAP_MAX} or fewer.`,
          { code: "SEASON_RECAP_NEWS_TOO_MANY" },
        );
      }
    }

    const recaps = await loadTeamSeasonRecaps(teamId, startMs, endMs, recapIds);
    const news = await loadTeamSeasonNews(
      teamId,
      startNewsDate,
      endNewsDate,
      newsIds,
    );
    if (newsIds != null && news.length !== newsIds.length) {
      return apiError(
        res,
        400,
        "One or more selected news stories is not part of this team's date range.",
        { code: "SEASON_RECAP_NEWS_INVALID" },
      );
    }
    if (news.length > TEAM_SEASON_RECAP_NEWS_CONTEXT_MAX) {
      return apiError(
        res,
        400,
        `Select ${TEAM_SEASON_RECAP_NEWS_CONTEXT_MAX} or fewer news stories so their article context can be analyzed.`,
        { code: "SEASON_RECAP_NEWS_CONTEXT_TOO_MANY" },
      );
    }
    if (recaps.length === 0 && news.length === 0) {
      return apiError(
        res,
        400,
        "No published recaps or dated news stories match your selection. Pick a wider date range or different sources.",
        { code: "SEASON_RECAP_EMPTY" },
      );
    }
    if (recaps.length > TEAM_SEASON_RECAP_MAX) {
      return apiError(
        res,
        400,
        `Too many recaps selected (${recaps.length}). Please narrow it down to ${TEAM_SEASON_RECAP_MAX} or fewer.`,
        { code: "SEASON_RECAP_TOO_MANY" },
      );
    }

    const fmtDate = (d: Date | null) =>
      d ? d.toISOString().slice(0, 10) : null;
    const recapInputs = recaps.map((r) => ({
      title: r.title,
      gameDate: fmtDate(r.gameDate),
      opponentName: r.opponentName,
      teamScore: r.teamScore,
      opponentScore: r.opponentScore,
      summary: r.summary,
    }));
    const newsInputs = await Promise.all(
      news.map(async (n) => {
        const articleContext = await fetchNewsArticleContext(n.url);
        return {
          id: n.id,
          title: n.title,
          sourceName: n.sourceName,
          url: n.url,
          gameDate: n.gameDate,
          description: n.description,
          articleText:
            articleContext.status === "analyzed" ? articleContext.text : null,
          articleContextStatus: articleContext.status,
        };
      }),
    );

    try {
      const text = await generateSeasonRecapText({
        teamName: team.name,
        startDate:
          typeof body.startDate === "string" && body.startDate.trim()
            ? body.startDate.trim()
            : null,
        endDate:
          typeof body.endDate === "string" && body.endDate.trim()
            ? body.endDate.trim()
            : null,
        recaps: recapInputs,
        news: newsInputs,
      });
      if (!text) {
        return apiError(
          res,
          502,
          "The AI returned an empty response. Please try again.",
          { code: "AI_EMPTY" },
        );
      }
      res.json({
        text,
        recapCount: recaps.length,
        newsCount: news.length,
        newsContext: newsInputs.map((n) => ({
          id: n.id,
          title: n.title,
          status: n.articleContextStatus,
        })),
      });
    } catch (err) {
      if (err instanceof AiNotConfiguredError) {
        return apiError(res, 503, err.message, { code: "AI_NOT_CONFIGURED" });
      }
      req.log.error({ err }, "Season recap generation failed");
      apiError(
        res,
        502,
        "AI request failed. An admin may need to check the API key in admin settings.",
        { code: "AI_REQUEST_FAILED" },
      );
    }
  }),
);

export default router;
