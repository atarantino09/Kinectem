import { Router, type IRouter } from "express";
import {
  db,
  broadcasts,
  broadcastRecipients,
  broadcastReplies,
  broadcastAssets,
  assets,
  notifications,
  organizations,
  teams,
  rosterEntries,
  users,
} from "@workspace/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { apiError, notFound, paginate, safeAvatarUrl, displayName } from "../lib/spec-helpers";
import { canManageOrganization, canManageTeam } from "../lib/permissions";
import {
  enumerateOrgAudience,
  enumerateTeamAudience,
} from "../lib/broadcasts";
import { rateLimit, ipKey } from "../middlewares/rate-limit";

const router: IRouter = Router();

// Writes (send a broadcast / post a reply) are already role-gated; the limiter
// is a per-user abuse backstop. A single send fans out to many recipients, so
// the cap is modest.
const broadcastWriteLimiter = rateLimit({
  name: "broadcast_write",
  windowMs: 15 * 60 * 1000,
  max: 60,
  keys: (req) => [ipKey(req), req.sessionUser?.id],
});

const MAX_BODY_LEN = 4000;
const bodyZ = z.object({
  body: z.string().trim().min(1, "Message body is required").max(MAX_BODY_LEN),
});

// Org announcements may carry file attachments (e.g. camp/tryout flyers).
// Allowlist: images (jpeg/png/webp) + PDF. Enforced server-side too — the
// asset pipeline accepts a broader set, so an admin could otherwise confirm a
// disallowed asset and attach it by id, bypassing the client picker.
const MAX_ATTACHMENTS = 5;
const ALLOWED_ATTACHMENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);
const orgBroadcastZ = bodyZ.extend({
  assetIds: z.array(z.string().uuid()).max(MAX_ATTACHMENTS).optional(),
});

// Validate that every requested asset is owned by the sender, confirmed, and of
// an allowed type, preserving the caller's order. Surfaces a 400-style message
// via the returned `error` so the route can relay it. De-dupes ids defensively.
async function validateOwnedAssets(
  assetIds: string[] | undefined,
  ownerId: string,
): Promise<{ ids: string[]; error: string | null }> {
  if (!assetIds || assetIds.length === 0) return { ids: [], error: null };
  const unique = Array.from(new Set(assetIds));
  const rows = await db
    .select({ id: assets.id, fileType: assets.fileType })
    .from(assets)
    .where(
      and(
        inArray(assets.id, unique),
        eq(assets.ownerId, ownerId),
        eq(assets.status, "confirmed"),
      ),
    );
  const byId = new Map(rows.map((r) => [r.id, r.fileType]));
  const missing = unique.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    return { ids: [], error: "One or more attachments are invalid or not yet uploaded" };
  }
  const badType = unique.some((id) => !ALLOWED_ATTACHMENT_TYPES.has(byId.get(id) ?? ""));
  if (badType) {
    return { ids: [], error: "Attachments must be a JPEG, PNG, WebP, or PDF" };
  }
  // Preserve the caller's ordering (deduped).
  return { ids: unique, error: null };
}

// Load attachments for a set of broadcast ids, grouped by broadcast id and
// ordered by `displayOrder`. Includes the inline data URL (the bytes), so use
// this only for a single opened broadcast — never the full inbox list.
type BroadcastAttachment = {
  id: string;
  fileName: string | null;
  fileType: string;
  fileSize: number | null;
  url: string | null;
};
async function loadAttachments(
  broadcastIds: string[],
): Promise<Map<string, BroadcastAttachment[]>> {
  const out = new Map<string, BroadcastAttachment[]>();
  if (broadcastIds.length === 0) return out;
  const rows = await db
    .select({
      broadcastId: broadcastAssets.broadcastId,
      displayOrder: broadcastAssets.displayOrder,
      id: assets.id,
      fileName: assets.fileName,
      fileType: assets.fileType,
      fileSize: assets.fileSize,
      url: assets.url,
    })
    .from(broadcastAssets)
    .innerJoin(assets, eq(assets.id, broadcastAssets.assetId))
    .where(inArray(broadcastAssets.broadcastId, broadcastIds))
    .orderBy(broadcastAssets.displayOrder);
  for (const r of rows) {
    const list = out.get(r.broadcastId) ?? [];
    list.push({
      id: r.id,
      fileName: r.fileName,
      fileType: r.fileType,
      fileSize: r.fileSize,
      url: r.url,
    });
    out.set(r.broadcastId, list);
  }
  return out;
}

async function loadTeam(teamId: string) {
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
  return team ?? null;
}

async function loadOrganization(orgId: string) {
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  return org ?? null;
}

// Team broadcast senders: org admins + team coaches (both `canManageTeam`)
// plus the team's accepted `manager`-position staff.
async function canSendTeamBroadcast(
  userId: string,
  team: typeof teams.$inferSelect,
): Promise<boolean> {
  if (await canManageTeam(userId, team)) return true;
  const [mgr] = await db
    .select({ id: rosterEntries.id })
    .from(rosterEntries)
    .where(
      and(
        eq(rosterEntries.teamId, team.id),
        eq(rosterEntries.userId, userId),
        eq(rosterEntries.status, "accepted"),
        eq(rosterEntries.position, "manager"),
      ),
    )
    .limit(1);
  return Boolean(mgr);
}

type Recipient = { userId: string; recipientRole: "coach" | "player" | "parent"; childUserId: string | null };

// Persist a broadcast + its recipient rows + fan out notifications in one
// transaction. Returns the new broadcast id.
async function persistBroadcast(opts: {
  scope: "organization" | "team";
  organizationId: string | null;
  teamId: string | null;
  senderUserId: string;
  body: string;
  allowReplies: boolean;
  recipients: Recipient[];
  notifMessage: string;
  assetIds?: string[];
}): Promise<string> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(broadcasts)
      .values({
        scope: opts.scope,
        organizationId: opts.organizationId,
        teamId: opts.teamId,
        senderUserId: opts.senderUserId,
        body: opts.body,
        allowReplies: opts.allowReplies,
      })
      .returning({ id: broadcasts.id });
    const broadcastId = row.id;

    if (opts.assetIds && opts.assetIds.length > 0) {
      await tx.insert(broadcastAssets).values(
        opts.assetIds.map((assetId, i) => ({
          broadcastId,
          assetId,
          displayOrder: i,
        })),
      );
    }

    if (opts.recipients.length > 0) {
      await tx.insert(broadcastRecipients).values(
        opts.recipients.map((r) => ({
          broadcastId,
          userId: r.userId,
          recipientRole: r.recipientRole,
          childUserId: r.childUserId,
        })),
      );
      // In-app notification per recipient (the sender never notifies self).
      const notifTargets = opts.recipients.filter((r) => r.userId !== opts.senderUserId);
      if (notifTargets.length > 0) {
        await tx.insert(notifications).values(
          notifTargets.map((r) => ({
            userId: r.userId,
            kind: "broadcast",
            message: opts.notifMessage,
            link: `/announcements?b=${broadcastId}`,
            actorUserId: opts.senderUserId,
          })),
        );
      }
    }
    return broadcastId;
  });
}

// ---------------------------------------------------------------------------
// POST /organizations/:orgId/broadcasts — org owner/admin → all teams'
// coaches + accepted players + their parents. No replies.
// ---------------------------------------------------------------------------
router.post(
  "/organizations/:orgId/broadcasts",
  broadcastWriteLimiter,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const org = await loadOrganization(req.params.orgId);
    if (!org) return notFound(res);
    if (!(await canManageOrganization(me.id, org.id))) {
      return apiError(res, 403, "Organization owners or admins only");
    }
    const parsed = orgBroadcastZ.safeParse(req.body);
    if (!parsed.success) {
      return apiError(res, 400, parsed.error.issues[0]?.message ?? "Invalid body");
    }
    const { ids: assetIds, error: assetError } = await validateOwnedAssets(
      parsed.data.assetIds,
      me.id,
    );
    if (assetError) return apiError(res, 400, assetError);
    const recipients = await enumerateOrgAudience(org.id);
    const broadcastId = await persistBroadcast({
      scope: "organization",
      organizationId: org.id,
      teamId: null,
      senderUserId: me.id,
      body: parsed.data.body,
      allowReplies: false,
      recipients,
      notifMessage: `New announcement from ${org.name}`,
      assetIds,
    });
    req.log.info(
      { broadcastId, orgId: org.id, recipients: recipients.length, attachments: assetIds.length },
      "broadcast: org announcement sent",
    );
    res.status(201).json({ id: broadcastId, recipientCount: recipients.length });
  }),
);

// ---------------------------------------------------------------------------
// POST /teams/:teamId/broadcasts — team admin/coach/manager → team's accepted
// players + their parents. Parents may reply (private per-family threads).
// ---------------------------------------------------------------------------
router.post(
  "/teams/:teamId/broadcasts",
  broadcastWriteLimiter,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const team = await loadTeam(req.params.teamId);
    if (!team) return notFound(res);
    if (!(await canSendTeamBroadcast(me.id, team))) {
      return apiError(res, 403, "Team admins, coaches, or managers only");
    }
    const parsed = bodyZ.safeParse(req.body);
    if (!parsed.success) {
      return apiError(res, 400, parsed.error.issues[0]?.message ?? "Invalid body");
    }
    const recipients = await enumerateTeamAudience(team.id);
    const broadcastId = await persistBroadcast({
      scope: "team",
      organizationId: team.organizationId ?? null,
      teamId: team.id,
      senderUserId: me.id,
      body: parsed.data.body,
      allowReplies: true,
      recipients,
      notifMessage: `New message from ${team.name}`,
    });
    req.log.info(
      { broadcastId, teamId: team.id, recipients: recipients.length },
      "broadcast: team message sent",
    );
    res.status(201).json({ id: broadcastId, recipientCount: recipients.length });
  }),
);

// Shared sender embed for list/detail responses.
function senderEmbed(u: { id: string; name: string; avatarUrl: string | null } | null) {
  if (!u) return null;
  return { id: u.id, displayName: u.name, avatarUrl: safeAvatarUrl(u.avatarUrl) };
}

// ---------------------------------------------------------------------------
// GET /me/broadcasts — inbox: broadcasts where I'm a recipient, newest first.
// ---------------------------------------------------------------------------
router.get(
  "/me/broadcasts",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");

    const rows = await db
      .select({
        id: broadcasts.id,
        scope: broadcasts.scope,
        body: broadcasts.body,
        allowReplies: broadcasts.allowReplies,
        createdAt: broadcasts.createdAt,
        organizationId: broadcasts.organizationId,
        teamId: broadcasts.teamId,
        orgName: organizations.name,
        teamName: teams.name,
        senderId: users.id,
        senderName: users.name,
        senderAvatar: users.avatarUrl,
        recipientRole: broadcastRecipients.recipientRole,
        readAt: broadcastRecipients.readAt,
        // Cheap count only — the inbox never embeds the (data-URL) bytes.
        attachmentCount: sql<number>`(
          SELECT count(*)::int FROM ${broadcastAssets}
          WHERE ${broadcastAssets.broadcastId} = ${broadcasts.id}
        )`,
      })
      .from(broadcastRecipients)
      .innerJoin(broadcasts, eq(broadcasts.id, broadcastRecipients.broadcastId))
      .leftJoin(organizations, eq(organizations.id, broadcasts.organizationId))
      .leftJoin(teams, eq(teams.id, broadcasts.teamId))
      .leftJoin(users, eq(users.id, broadcasts.senderUserId))
      .where(eq(broadcastRecipients.userId, me.id))
      .orderBy(desc(broadcasts.createdAt))
      .limit(100);

    const data = rows.map((r) => ({
      id: r.id,
      scope: r.scope,
      body: r.body,
      allowReplies: r.allowReplies,
      createdAt: r.createdAt.toISOString(),
      sourceName: r.scope === "organization" ? r.orgName : r.teamName,
      teamId: r.teamId,
      organizationId: r.organizationId,
      sender: senderEmbed(
        r.senderId ? { id: r.senderId, name: r.senderName ?? "", avatarUrl: r.senderAvatar } : null,
      ),
      recipientRole: r.recipientRole,
      read: r.readAt != null,
      canReply: r.scope === "team" && r.allowReplies && r.recipientRole === "parent",
      attachmentCount: r.attachmentCount ?? 0,
    }));
    res.json(paginate(data));
  }),
);

// ---------------------------------------------------------------------------
// GET /me/broadcasts/unread-count — for the nav badge.
// ---------------------------------------------------------------------------
router.get(
  "/me/broadcasts/unread-count",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(broadcastRecipients)
      .where(
        and(
          eq(broadcastRecipients.userId, me.id),
          sql`${broadcastRecipients.readAt} IS NULL`,
        ),
      );
    res.json({ count: row?.count ?? 0 });
  }),
);

// Resolve the caller's relationship to a broadcast: are they the sender, a
// privileged staff viewer (sees every reply thread), or a recipient?
async function loadAccess(broadcastId: string, userId: string) {
  const [b] = await db
    .select()
    .from(broadcasts)
    .where(eq(broadcasts.id, broadcastId))
    .limit(1);
  if (!b) return null;

  const [recipient] = await db
    .select()
    .from(broadcastRecipients)
    .where(
      and(
        eq(broadcastRecipients.broadcastId, broadcastId),
        eq(broadcastRecipients.userId, userId),
      ),
    )
    .limit(1);

  const isSender = b.senderUserId === userId;
  let isStaff = isSender;
  if (!isStaff) {
    // Team staff (admin/coach/manager) can administer the broadcast's threads
    // even if they weren't an original recipient.
    if (b.scope === "team" && b.teamId) {
      const team = await loadTeam(b.teamId);
      if (team) isStaff = await canSendTeamBroadcast(userId, team);
    } else if (b.scope === "organization" && b.organizationId) {
      isStaff = await canManageOrganization(userId, b.organizationId);
    }
  }
  if (!recipient && !isStaff) return null;
  return { broadcast: b, recipient: recipient ?? null, isStaff };
}

// ---------------------------------------------------------------------------
// GET /broadcasts/:id — detail + reply threads (visibility-scoped).
//   - staff: every family thread
//   - parent recipient: only their own thread
// ---------------------------------------------------------------------------
router.get(
  "/broadcasts/:id",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const access = await loadAccess(req.params.id, me.id);
    if (!access) return notFound(res);
    const { broadcast: b, recipient, isStaff } = access;

    const [senderRow] = b.senderUserId
      ? await db
          .select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl })
          .from(users)
          .where(eq(users.id, b.senderUserId))
          .limit(1)
      : [];

    let source: { name: string | null } = { name: null };
    if (b.scope === "organization" && b.organizationId) {
      const [o] = await db
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, b.organizationId))
        .limit(1);
      source = { name: o?.name ?? null };
    } else if (b.scope === "team" && b.teamId) {
      const [t] = await db
        .select({ name: teams.name })
        .from(teams)
        .where(eq(teams.id, b.teamId))
        .limit(1);
      source = { name: t?.name ?? null };
    }

    const canReply =
      b.scope === "team" && b.allowReplies && recipient?.recipientRole === "parent";

    const attachments = (await loadAttachments([b.id])).get(b.id) ?? [];

    // Reply thread(s). Staff see all; a parent sees only their own family thread.
    type ThreadReply = {
      id: string;
      body: string;
      createdAt: string;
      sender: { id: string; displayName: string; avatarUrl: string | null } | null;
      isMine: boolean;
    };
    const threads: Array<{
      familyParentUserId: string;
      familyName: string | null;
      replies: ThreadReply[];
    }> = [];

    if (b.scope === "team" && b.allowReplies) {
      const whereThread = isStaff
        ? eq(broadcastReplies.broadcastId, b.id)
        : and(
            eq(broadcastReplies.broadcastId, b.id),
            eq(broadcastReplies.familyParentUserId, me.id),
          );
      const replyRows = await db
        .select({
          id: broadcastReplies.id,
          familyParentUserId: broadcastReplies.familyParentUserId,
          body: broadcastReplies.body,
          createdAt: broadcastReplies.createdAt,
          senderId: users.id,
          senderName: users.name,
          senderAvatar: users.avatarUrl,
        })
        .from(broadcastReplies)
        .leftJoin(users, eq(users.id, broadcastReplies.senderUserId))
        .where(whereThread)
        .orderBy(broadcastReplies.createdAt);

      // Resolve a friendly family label (the parent's name) for staff view.
      const parentIds = Array.from(new Set(replyRows.map((r) => r.familyParentUserId)));
      const parentNames = parentIds.length
        ? await db
            .select({ id: users.id, name: users.name })
            .from(users)
            .where(inArray(users.id, parentIds))
        : [];
      const nameById = new Map(parentNames.map((p) => [p.id, p.name]));

      const byThread = new Map<string, ThreadReply[]>();
      for (const r of replyRows) {
        const list = byThread.get(r.familyParentUserId) ?? [];
        list.push({
          id: r.id,
          body: r.body,
          createdAt: r.createdAt.toISOString(),
          sender: r.senderId
            ? { id: r.senderId, displayName: r.senderName ?? "", avatarUrl: safeAvatarUrl(r.senderAvatar) }
            : null,
          isMine: r.senderId === me.id,
        });
        byThread.set(r.familyParentUserId, list);
      }
      for (const [familyParentUserId, replies] of byThread) {
        threads.push({
          familyParentUserId,
          familyName: nameById.get(familyParentUserId) ?? null,
          replies,
        });
      }
    }

    res.json({
      id: b.id,
      scope: b.scope,
      body: b.body,
      allowReplies: b.allowReplies,
      createdAt: b.createdAt.toISOString(),
      sourceName: source.name,
      teamId: b.teamId,
      organizationId: b.organizationId,
      sender: senderEmbed(
        senderRow ? { id: senderRow.id, name: senderRow.name, avatarUrl: senderRow.avatarUrl } : null,
      ),
      recipientRole: recipient?.recipientRole ?? null,
      read: recipient?.readAt != null,
      isStaff,
      canReply,
      threads,
      attachments,
    });
  }),
);

// ---------------------------------------------------------------------------
// POST /broadcasts/:id/read — mark my recipient copy read.
// ---------------------------------------------------------------------------
router.post(
  "/broadcasts/:id/read",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    await db
      .update(broadcastRecipients)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(broadcastRecipients.broadcastId, req.params.id),
          eq(broadcastRecipients.userId, me.id),
          sql`${broadcastRecipients.readAt} IS NULL`,
        ),
      );
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------
// POST /broadcasts/:id/replies — post into a private family thread.
//   - parent recipient: posts into their own thread (familyParentUserId = me)
//   - staff: must target an existing family thread via `familyParentUserId`
// ---------------------------------------------------------------------------
const replyZ = bodyZ.extend({
  familyParentUserId: z.string().uuid().optional(),
});

router.post(
  "/broadcasts/:id/replies",
  broadcastWriteLimiter,
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const access = await loadAccess(req.params.id, me.id);
    if (!access) return notFound(res);
    const { broadcast: b, recipient, isStaff } = access;

    if (b.scope !== "team" || !b.allowReplies) {
      return apiError(res, 403, "Replies are not allowed on this broadcast");
    }
    const parsed = replyZ.safeParse(req.body);
    if (!parsed.success) {
      return apiError(res, 400, parsed.error.issues[0]?.message ?? "Invalid body");
    }

    // Resolve the family thread + the user to notify on the other side.
    let familyParentUserId: string;
    let notifyUserId: string | null;
    if (recipient?.recipientRole === "parent") {
      // A parent always posts into their own thread.
      familyParentUserId = me.id;
      notifyUserId = b.senderUserId;
    } else if (isStaff) {
      // Staff must name the family thread they're replying into, and it must
      // belong to an actual parent recipient of this broadcast.
      const target = parsed.data.familyParentUserId;
      if (!target) {
        return apiError(res, 400, "familyParentUserId is required for staff replies");
      }
      const [parentRecipient] = await db
        .select({ userId: broadcastRecipients.userId })
        .from(broadcastRecipients)
        .where(
          and(
            eq(broadcastRecipients.broadcastId, b.id),
            eq(broadcastRecipients.userId, target),
            eq(broadcastRecipients.recipientRole, "parent"),
          ),
        )
        .limit(1);
      if (!parentRecipient) {
        return apiError(res, 404, "No such family thread on this broadcast");
      }
      familyParentUserId = target;
      notifyUserId = target;
    } else {
      return apiError(res, 403, "Only parents or team staff may reply");
    }

    const replyId = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(broadcastReplies)
        .values({
          broadcastId: b.id,
          familyParentUserId,
          senderUserId: me.id,
          body: parsed.data.body,
        })
        .returning({ id: broadcastReplies.id });
      if (notifyUserId && notifyUserId !== me.id) {
        const senderName = displayName({ name: req.sessionUser?.name ?? "" });
        await tx.insert(notifications).values({
          userId: notifyUserId,
          kind: "broadcast_reply",
          message: `${senderName} replied to a team message`,
          link: `/announcements?b=${b.id}`,
          actorUserId: me.id,
        });
      }
      return row.id;
    });

    res.status(201).json({ id: replyId });
  }),
);

export default router;
