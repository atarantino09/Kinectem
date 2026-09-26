import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import {
  db,
  familyContacts,
  guardianLinks,
  notifications,
  rosterEntries,
  teams,
  users,
} from "@workspace/db";
import { asyncHandler } from "../lib/async-handler";
import { apiError, displayName, safeAvatarUrl } from "../lib/spec-helpers";
import { isActiveGuardian } from "../lib/guardian-links";
import { sendFamilyContactInviteEmail } from "../lib/email";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function familyContactName(contact: {
  firstName: string;
  lastName: string;
}): string {
  return `${contact.firstName} ${contact.lastName}`.trim();
}

function contactResponse(
  row: typeof familyContacts.$inferSelect,
  childName: string,
  inviterName: string | null,
  childAvatarUrl: string | null = null,
) {
  return {
    id: row.id,
    child: {
      id: row.childId,
      displayName: childName,
      avatarUrl: safeAvatarUrl(childAvatarUrl),
    },
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.inviteEmail,
    status: row.status,
    ...(inviterName ? { invitedBy: { displayName: inviterName } } : {}),
    createdAt: row.createdAt.toISOString(),
    invitedAt: row.createdAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
  };
}

async function loadChildAndInviter(
  row: typeof familyContacts.$inferSelect,
): Promise<{
  childName: string;
  childAvatarUrl: string | null;
  inviterName: string | null;
}> {
  const [child] = await db
    .select({ name: users.name, avatarUrl: users.avatarUrl })
    .from(users)
    .where(eq(users.id, row.childId))
    .limit(1);
  const [inviter] = row.invitedByGuardianId
    ? await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(eq(users.id, row.invitedByGuardianId))
        .limit(1)
    : [];
  return {
    childName: child?.name ?? "your family member",
    childAvatarUrl: child?.avatarUrl ?? null,
    inviterName: inviter ? displayName(inviter) : null,
  };
}

// Parents manage contacts only while they are actively linked guardians.
router.get(
  "/users/:childId/family-contacts",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) {
      apiError(res, 401, "Not authenticated");
      return;
    }
    const childId = String(req.params.childId);
    if (!(await isActiveGuardian(me.id, childId))) {
      apiError(res, 403, "Only an active guardian may view family contacts");
      return;
    }
    const rows = await db
      .select()
      .from(familyContacts)
      .where(
        and(
          eq(familyContacts.childId, childId),
          inArray(familyContacts.status, ["pending", "active"]),
        ),
      )
      .orderBy(familyContacts.createdAt);
    const childInviters = Array.from(
      new Set(
        rows
          .map((row) => row.invitedByGuardianId)
          .filter((id): id is string => !!id),
      ),
    );
    const inviterRows = childInviters.length
      ? await db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, childInviters))
      : [];
    const inviterNames = new Map(inviterRows.map((row) => [row.id, displayName(row)]));
    const [child] = await db
      .select({ name: users.name, avatarUrl: users.avatarUrl })
      .from(users)
      .where(eq(users.id, childId))
      .limit(1);
    res.json({
      data: rows.map((row) =>
        contactResponse(
          row,
          child?.name ?? "Family member",
          row.invitedByGuardianId
            ? inviterNames.get(row.invitedByGuardianId) ?? null
            : null,
          child?.avatarUrl ?? null,
        ),
      ),
    });
  }),
);

router.post(
  "/users/:childId/family-contacts",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) {
      apiError(res, 401, "Not authenticated");
      return;
    }
    if (req.isMasquerading) {
      apiError(res, 403, "Not allowed while masquerading");
      return;
    }
    const childId = String(req.params.childId);
    if (!(await isActiveGuardian(me.id, childId))) {
      apiError(res, 403, "Only an active guardian may invite a family contact");
      return;
    }
    const firstName =
      typeof req.body?.firstName === "string" ? req.body.firstName.trim() : "";
    const lastName =
      typeof req.body?.lastName === "string" ? req.body.lastName.trim() : "";
    const email =
      typeof req.body?.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";
    if (!firstName || !lastName || !email) {
      apiError(res, 400, "firstName, lastName, and email are required");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      apiError(res, 400, "A valid email is required");
      return;
    }
    const [child] = await db
      .select({ id: users.id, name: users.name, email: users.email, avatarUrl: users.avatarUrl })
      .from(users)
      .where(eq(users.id, childId))
      .limit(1);
    if (!child) {
      apiError(res, 404, "Child not found");
      return;
    }
    if (
      email === me.email?.trim().toLowerCase() ||
      email === child.email?.trim().toLowerCase()
    ) {
      apiError(res, 400, "You cannot invite yourself or the child");
      return;
    }
    const creation = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${childId}))`);
      const [guardianLink] = await tx
        .select({ id: guardianLinks.id })
        .from(guardianLinks)
        .where(
          and(
            eq(guardianLinks.childId, childId),
            eq(guardianLinks.guardianId, me.id),
            eq(guardianLinks.status, "active"),
          ),
        )
        .limit(1);
      if (!guardianLink) return { kind: "not_guardian" as const };
      const [existing] = await tx
        .select({ id: familyContacts.id })
        .from(familyContacts)
        .where(
          and(
            eq(familyContacts.childId, childId),
            sql`lower(${familyContacts.inviteEmail}) = ${email}`,
            inArray(familyContacts.status, ["pending", "active"]),
          ),
        )
        .limit(1);
      if (existing) return { kind: "duplicate" as const };
      const [created] = await tx
        .insert(familyContacts)
        .values({
          childId,
          inviteEmail: email,
          firstName,
          lastName,
          invitedByGuardianId: me.id,
        })
        .returning();
      return created
        ? { kind: "created" as const, contact: created }
        : { kind: "duplicate" as const };
    });
    if (creation.kind === "not_guardian") {
      apiError(res, 403, "Only an active guardian may invite a family contact");
      return;
    }
    if (creation.kind === "duplicate") {
      res.json({ message: "Invite processed." });
      return;
    }
    const contact = creation.contact;

    // Any account notification carries the same generic success behavior as
    // email delivery; callers never learn whether the address is registered.
    const [invitee] = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1);
    if (invitee) {
      await db.insert(notifications).values({
        userId: invitee.id,
        kind: "family_contact_invite",
        message: `${displayName(me)} invited you to receive updates about ${child.name} on Kinectem.`,
        link: "/family",
        actorUserId: me.id,
      });
    }
    try {
      await sendFamilyContactInviteEmail(email, {
        inviteId: contact.id,
        childName: child.name,
        inviterName: displayName(me),
        inviteeName: familyContactName(contact),
      });
    } catch (err) {
      logger.error({ err }, "Failed to send family contact invite email");
    }
    res.status(201).json({
      data: contactResponse(contact, child.name, displayName(me), child.avatarUrl),
    });
  }),
);

// One invitation at a time. No child details are returned until the
// authenticated account matches the address to which the email was sent.
router.get(
  "/family-invitations/:kind/:id",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const kind = String(req.params.kind);
    const id = String(req.params.id);
    if (!["guardian", "contact"].includes(kind) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ||
        !me.email) return apiError(res, 404, "Invitation unavailable");
    const address = me.email.trim().toLowerCase();
    if (kind === "contact") {
      const [row] = await db.select().from(familyContacts).where(
        and(eq(familyContacts.id, id), sql`lower(${familyContacts.inviteEmail}) = ${address}`),
      ).limit(1);
      if (!row || row.status === "revoked") return apiError(res, 404, "Invitation unavailable");
      const details = await loadChildAndInviter(row);
      return res.json({
        kind, status: row.status, child: { id: row.childId, displayName: details.childName },
        invitedBy: details.inviterName, access: "updates-only",
      });
    }
    const [row] = await db.select().from(guardianLinks).where(
      and(eq(guardianLinks.id, id), sql`lower(${guardianLinks.inviteEmail}) = ${address}`),
    ).limit(1);
    if (!row || row.status === "revoked") return apiError(res, 404, "Invitation unavailable");
    const [child] = await db.select({ name: users.name }).from(users).where(eq(users.id, row.childId)).limit(1);
    const [inviter] = row.invitedByUserId
      ? await db.select({ name: users.name }).from(users).where(eq(users.id, row.invitedByUserId)).limit(1)
      : [];
    return res.json({
      kind, status: row.status, child: { id: row.childId, displayName: child?.name ?? "your family member" },
      invitedBy: inviter?.name ?? null, access: row.relationshipType,
    });
  }),
);

// Invitee-facing route deliberately keys solely off the authenticated,
// verified-by-login email. Pending rows do not require an account claim step.
router.get(
  "/family-contacts/invitations",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) {
      apiError(res, 401, "Not authenticated");
      return;
    }
    if (!me.email) {
      res.json({ data: [] });
      return;
    }
    const rows = await db
      .select()
      .from(familyContacts)
      .where(
        and(
          inArray(familyContacts.status, ["pending", "active"]),
          // Active relationships are addressed by the accepted user id; the
          // email condition keeps pre-signup pending invitations visible.
          or(
            eq(familyContacts.invitedUserId, me.id),
            and(
              eq(familyContacts.status, "pending"),
              sql`lower(${familyContacts.inviteEmail}) = ${me.email.trim().toLowerCase()}`,
            ),
          ),
        ),
      )
      .orderBy(familyContacts.createdAt);
    const data: Array<ReturnType<typeof contactResponse> & {
      teams: Array<{ id: string; name: string }>;
    }> = [];
    for (const row of rows) {
      const related = await loadChildAndInviter(row);
      let contactTeams: Array<{ id: string; name: string }> = [];
      if (row.status === "active") {
        const teamRows = await db
          .select({ id: teams.id, name: teams.name })
          .from(rosterEntries)
          .innerJoin(teams, eq(teams.id, rosterEntries.teamId))
          .where(
            and(
              eq(rosterEntries.userId, row.childId),
              eq(rosterEntries.status, "accepted"),
            ),
          )
          .orderBy(teams.name);
        contactTeams = teamRows;
      }
      data.push({
        ...contactResponse(
          row,
          related.childName,
          related.inviterName,
          related.childAvatarUrl,
        ),
        teams: contactTeams,
      });
    }
    res.json({ data });
  }),
);

async function decideInvitation(
  req: Request,
  res: Response,
  decision: "active" | "declined",
): Promise<void> {
  const me = req.sessionUser;
  if (!me) {
    apiError(res, 401, "Not authenticated");
    return;
  }
  if (req.isMasquerading) {
    apiError(res, 403, "Not allowed while masquerading");
    return;
  }
  if (!me.email) {
    apiError(res, 404, "Invitation not found");
    return;
  }
  const id = String(req.params.id);
  const [candidate] = await db
    .select()
    .from(familyContacts)
    .where(
      and(
        eq(familyContacts.id, id),
        eq(familyContacts.status, "pending"),
        sql`lower(${familyContacts.inviteEmail}) = ${me.email.trim().toLowerCase()}`,
      ),
    )
    .limit(1);
  if (!candidate) {
    apiError(res, 404, "Invitation not found");
    return;
  }
  const updated = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${candidate.childId}))`);
    const [row] = await tx
      .update(familyContacts)
      .set({
        status: decision,
        invitedUserId: decision === "active" ? me.id : null,
        acceptedAt: decision === "active" ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(familyContacts.id, candidate.id),
          eq(familyContacts.status, "pending"),
          sql`lower(${familyContacts.inviteEmail}) = ${me.email!.trim().toLowerCase()}`,
        ),
      )
      .returning();
    return row ?? null;
  });
  if (!updated) {
    apiError(res, 404, "Invitation not found");
    return;
  }
  if (updated.invitedByGuardianId) {
    const [child] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, updated.childId))
      .limit(1);
    await db.insert(notifications).values({
      userId: updated.invitedByGuardianId,
      kind: decision === "active" ? "family_contact_accepted" : "family_contact_declined",
      message:
        decision === "active"
          ? `${displayName(me)} accepted the updates-only invitation for ${child?.name ?? "your family member"}.`
          : `${displayName(me)} declined the updates-only invitation for ${child?.name ?? "your family member"}.`,
      link: "/family",
      actorUserId: me.id,
    });
  }
  if (decision === "declined") {
    res.status(204).send();
    return;
  }
  const related = await loadChildAndInviter(updated);
  res.json(
    contactResponse(
      updated,
      related.childName,
      related.inviterName,
      related.childAvatarUrl,
    ),
  );
}

router.post(
  "/family-contacts/:id/accept",
  asyncHandler(async (req, res) => {
    await decideInvitation(req, res, "active");
  }),
);

router.post(
  "/family-contacts/:id/decline",
  asyncHandler(async (req, res) => {
    await decideInvitation(req, res, "declined");
  }),
);

router.delete(
  "/family-contacts/:id",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) {
      apiError(res, 401, "Not authenticated");
      return;
    }
    if (req.isMasquerading) {
      apiError(res, 403, "Not allowed while masquerading");
      return;
    }
    const id = String(req.params.id);
    const [candidate] = await db
      .select()
      .from(familyContacts)
      .where(
        and(
          eq(familyContacts.id, id),
          inArray(familyContacts.status, ["pending", "active"]),
        ),
      )
      .limit(1);
    if (!candidate || !(await isActiveGuardian(me.id, candidate.childId))) {
      apiError(res, 404, "Family contact not found");
      return;
    }
    const revokeResult = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${candidate.childId}))`);
      const [guardianLink] = await tx
        .select({ id: guardianLinks.id })
        .from(guardianLinks)
        .where(
          and(
            eq(guardianLinks.childId, candidate.childId),
            eq(guardianLinks.guardianId, me.id),
            eq(guardianLinks.status, "active"),
          ),
        )
        .limit(1);
      if (!guardianLink) return { kind: "not_guardian" as const };
      const [row] = await tx
        .update(familyContacts)
        .set({ status: "revoked", updatedAt: new Date() })
        .where(
          and(
            eq(familyContacts.id, candidate.id),
            inArray(familyContacts.status, ["pending", "active"]),
          ),
        )
        .returning({ id: familyContacts.id });
      return row
        ? { kind: "revoked" as const }
        : { kind: "gone" as const };
    });
    if (revokeResult.kind === "not_guardian" || revokeResult.kind === "gone") {
      apiError(res, 404, "Family contact not found");
      return;
    }
    res.status(204).send();
  }),
);

export default router;