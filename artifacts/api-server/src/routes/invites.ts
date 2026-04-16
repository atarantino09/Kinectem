import { Router, type IRouter } from "express";
import { db, rosterInvites, rosterEntries, teams, organizations, users, notifications } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { asyncHandler } from "../lib/async-handler";
import { requireAuth, createSession, setSessionCookie } from "../lib/auth";
import { CreateTeamInviteBody, AcceptInviteBody } from "@workspace/api-zod";
import { toRosterInvite, toTeam, toOrganization, toUser, toRosterEntry } from "../lib/serializers";
import { canManageTeam } from "../lib/permissions";
import { randomUUID } from "crypto";

const router: IRouter = Router();

router.get(
  "/teams/:teamId/invites",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { teamId } = req.params;
    const rows = await db
      .select()
      .from(rosterInvites)
      .where(eq(rosterInvites.teamId, teamId))
      .orderBy(desc(rosterInvites.createdAt));
    res.json(rows.map(toRosterInvite));
  }),
);

router.post(
  "/teams/:teamId/invites",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { teamId } = req.params;
    const body = CreateTeamInviteBody.parse(req.body);

    const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
    if (!team) {
      res.status(404).json({ error: "Team not found" });
      return;
    }

    if (!(await canManageTeam(req.sessionUser!.id, team))) {
      res.status(403).json({ error: "Not allowed to manage this team" });
      return;
    }

    // If a user with that email already exists, add them directly to roster (pending) + notify
    const [existing] = await db.select().from(users).where(eq(users.email, body.invitedEmail)).limit(1);
    if (existing) {
      const [entry] = await db
        .insert(rosterEntries)
        .values({
          teamId,
          userId: existing.id,
          role: body.role,
          status: "pending",
          position: body.position ?? undefined,
          jerseyNumber: body.jerseyNumber ?? undefined,
        })
        .returning();
      await db.insert(notifications).values({
        userId: existing.id,
        kind: "roster_invite",
        message: `You've been invited to join ${team.name}. Accept your roster spot to make it active.`,
        link: `/u/${existing.id}`,
      });
      // Return as an invite-shaped record by also storing it
      const [invite] = await db
        .insert(rosterInvites)
        .values({
          token: randomUUID(),
          teamId,
          invitedEmail: body.invitedEmail,
          invitedName: body.invitedName ?? existing.name,
          role: body.role,
          position: body.position ?? undefined,
          jerseyNumber: body.jerseyNumber ?? undefined,
          grade: body.grade ?? undefined,
          status: "pending",
          invitedById: req.sessionUser!.id,
        })
        .returning();
      res.status(201).json(toRosterInvite(invite));
      return;
    }

    // Otherwise create invite for new user
    const [invite] = await db
      .insert(rosterInvites)
      .values({
        token: randomUUID(),
        teamId,
        invitedEmail: body.invitedEmail,
        invitedName: body.invitedName ?? undefined,
        role: body.role,
        position: body.position ?? undefined,
        jerseyNumber: body.jerseyNumber ?? undefined,
        grade: body.grade ?? undefined,
        status: "pending",
        invitedById: req.sessionUser!.id,
      })
      .returning();
    res.status(201).json(toRosterInvite(invite));
  }),
);

router.get(
  "/invites/:token",
  asyncHandler(async (req, res) => {
    const { token } = req.params;
    const [invite] = await db.select().from(rosterInvites).where(eq(rosterInvites.token, token));
    if (!invite) {
      res.status(404).json({ error: "Invite not found" });
      return;
    }
    const [team] = await db.select().from(teams).where(eq(teams.id, invite.teamId));
    const [org] = team ? await db.select().from(organizations).where(eq(organizations.id, team.organizationId)) : [];
    const [invitedBy] = invite.invitedById
      ? await db.select().from(users).where(eq(users.id, invite.invitedById))
      : [];
    res.json({
      invite: toRosterInvite(invite),
      team: team ? toTeam(team) : undefined,
      organization: org ? toOrganization(org) : undefined,
      invitedBy: invitedBy ? toUser(invitedBy) : undefined,
    });
  }),
);

router.post(
  "/invites/:token/accept",
  asyncHandler(async (req, res) => {
    const { token } = req.params;
    const body = req.body ? AcceptInviteBody.parse(req.body) : { name: undefined, dateOfBirth: undefined };

    const [invite] = await db.select().from(rosterInvites).where(eq(rosterInvites.token, token));
    if (!invite || invite.status !== "pending") {
      res.status(404).json({ error: "Invite not available" });
      return;
    }

    let userId = req.sessionUser?.id;

    if (!userId) {
      // Find existing user by email or create new
      const [existing] = await db.select().from(users).where(eq(users.email, invite.invitedEmail)).limit(1);
      if (existing) {
        userId = existing.id;
      } else {
        const [created] = await db
          .insert(users)
          .values({
            email: invite.invitedEmail,
            name: body.name ?? invite.invitedName ?? invite.invitedEmail,
            role: invite.role === "coach" ? "coach" : "athlete",
            position: invite.position ?? undefined,
            jerseyNumber: invite.jerseyNumber ?? undefined,
            grade: invite.grade ?? undefined,
            dateOfBirth: body.dateOfBirth ?? undefined,
          })
          .returning();
        userId = created.id;
      }
      const sess = await createSession(userId);
      setSessionCookie(res, sess.id, sess.expiresAt);
    }

    // Add to roster as accepted (since user explicitly accepted)
    const [entry] = await db
      .insert(rosterEntries)
      .values({
        teamId: invite.teamId,
        userId,
        role: invite.role,
        status: "accepted",
        position: invite.position ?? undefined,
        jerseyNumber: invite.jerseyNumber ?? undefined,
      })
      .returning();
    await db.update(rosterInvites).set({ status: "accepted" }).where(eq(rosterInvites.id, invite.id));

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    res.json(toRosterEntry(entry, toUser(user)));
  }),
);

// Accept a pending direct-add roster entry (used for "in-app notification → accept")
router.post(
  "/roster/:entryId/accept",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { entryId } = req.params;
    const [entry] = await db.select().from(rosterEntries).where(eq(rosterEntries.id, entryId));
    if (!entry || entry.userId !== req.sessionUser!.id) {
      res.status(404).json({ error: "Entry not found" });
      return;
    }
    const [updated] = await db.update(rosterEntries).set({ status: "accepted" }).where(eq(rosterEntries.id, entryId)).returning();
    const [user] = await db.select().from(users).where(eq(users.id, updated.userId));
    res.json(toRosterEntry(updated, toUser(user)));
  }),
);

router.post(
  "/roster/:entryId/decline",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { entryId } = req.params;
    const [entry] = await db.select().from(rosterEntries).where(eq(rosterEntries.id, entryId));
    if (!entry || entry.userId !== req.sessionUser!.id) {
      res.status(404).json({ error: "Entry not found" });
      return;
    }
    const [updated] = await db.update(rosterEntries).set({ status: "declined" }).where(eq(rosterEntries.id, entryId)).returning();
    const [user] = await db.select().from(users).where(eq(users.id, updated.userId));
    res.json(toRosterEntry(updated, toUser(user)));
  }),
);

export default router;
