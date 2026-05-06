import { Router, type IRouter } from "express";
import {
  db,
  users,
  organizations,
  conversations,
  conversationParticipants,
  messages,
  messageAssets,
  assets,
  messageChildHides,
} from "@workspace/db";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { hashPassword, verifyPassword, generateToken, hashToken } from "../lib/passwords";
import { rateLimit, ipKey, emailKey } from "../middlewares/rate-limit";
import { asyncHandler } from "../lib/async-handler";
import { sendGuardianConfirmationEmail, sendGuardianExpiredEmail, sendPasswordResetEmail } from "../lib/email";
import { canCreateRecap, canManageOrganization, isTeamMember, canManageTeam } from "../lib/permissions";
import {
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  SESSION_COOKIE,
} from "../lib/auth";
import {
  displayName,
  paginate,
  toConversation,
  toMessage,
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
  blockIfEitherMinor,
  blockMinorAction,
  filterOutMinors,
  gateDmToRecipient,
  loadMinorLookup,
  logConsentEvent,
  notifyGuardianOfPendingItem,
} from "../lib/coppa";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Conversations / Messages (stubs)
// ---------------------------------------------------------------------------

async function getOtherParticipant(conversationId: string, meId: string) {
  const parts = await db
    .select()
    .from(conversationParticipants)
    .where(eq(conversationParticipants.conversationId, conversationId));
  const others = parts.filter(
    (p) => !(p.participantType === "user" && p.participantId === meId),
  );
  const other = others[0] ?? parts[0];
  if (!other) return null;
  if (other.participantType === "user") {
    const [u] = await db.select().from(users).where(eq(users.id, other.participantId)).limit(1);
    if (!u) return null;
    return {
      id: u.id,
      type: "user" as const,
      displayName: displayName(u),
      avatarUrl: safeAvatarUrl(u.avatarUrl),
    };
  }
  const [o] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, other.participantId))
    .limit(1);
  if (!o) return null;
  return {
    id: o.id,
    type: "organization" as const,
    displayName: o.name,
    avatarUrl: o.logoUrl ?? null,
  };
}

// Exported so /child-conversations routes (defined in routes/child-conversations.ts)
// can reuse the message-asset hydration logic without duplicating it.
export async function loadAssetsForMessages(
  messageIds: string[],
): Promise<Map<string, (typeof assets.$inferSelect)[]>> {
  const map = new Map<string, (typeof assets.$inferSelect)[]>();
  if (messageIds.length === 0) return map;
  const rows = await db
    .select({ ma: messageAssets, a: assets })
    .from(messageAssets)
    .innerJoin(assets, eq(messageAssets.assetId, assets.id))
    .where(inArray(messageAssets.messageId, messageIds))
    .orderBy(asc(messageAssets.displayOrder));
  for (const r of rows) {
    const list = map.get(r.ma.messageId) ?? [];
    list.push(r.a);
    map.set(r.ma.messageId, list);
  }
  return map;
}

// Exported so /child-conversations routes (defined in routes/child-conversations.ts)
// can render conversation list/detail views with the same shape used here.
export async function loadConversationView(conv: { id: string; type: string; createdAt: Date; updatedAt: Date }, meId: string) {
  const participant = await getOtherParticipant(conv.id, meId);
  if (!participant) return null;
  // Task #363 — never expose a pending message to anyone other than
  // its sender (the recipient + everyone else must wait for guardian
  // approval). The latest-message preview must respect this so a
  // minor's conversation row doesn't leak the body of an unmoderated
  // incoming DM.
  const [last] = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conv.id),
        sql`(${messages.moderationStatus} = 'approved' OR ${messages.senderUserId} = ${meId})`,
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(1);
  let lastSenderName: string | null = null;
  if (last?.senderUserId) {
    const [u] = await db.select().from(users).where(eq(users.id, last.senderUserId)).limit(1);
    lastSenderName = u ? displayName(u) : null;
  }
  let lastHasAttachments = false;
  if (last) {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(messageAssets)
      .where(eq(messageAssets.messageId, last.id));
    lastHasAttachments = Number(count) > 0;
  }
  const [myPart] = await db
    .select()
    .from(conversationParticipants)
    .where(
      and(
        eq(conversationParticipants.conversationId, conv.id),
        eq(conversationParticipants.participantType, "user"),
        eq(conversationParticipants.participantId, meId),
      ),
    )
    .limit(1);
  let unread = 0;
  if (myPart) {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conv.id),
          isNull(messages.deletedAt),
          ne(messages.senderUserId, meId),
          // Task #363 — pending DMs must not bump unread counts for the
          // recipient until their guardian approves them.
          eq(messages.moderationStatus, "approved"),
          myPart.lastReadAt
            ? gt(messages.createdAt, myPart.lastReadAt)
            : sql`true`,
        ),
      );
    unread = Number(count);
  }
  return toConversation(
    { id: conv.id, type: conv.type as "direct" | "user_to_org" | "org_to_org", createdAt: conv.createdAt, updatedAt: conv.updatedAt },
    participant,
    last ?? null,
    lastSenderName,
    unread,
    lastHasAttachments,
  );
}

router.get(
  "/conversations",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return res.json(paginate([]));
    const myParts = await db
      .select({ conv: conversations })
      .from(conversationParticipants)
      .innerJoin(conversations, eq(conversationParticipants.conversationId, conversations.id))
      .where(
        and(
          eq(conversationParticipants.participantType, "user"),
          eq(conversationParticipants.participantId, me.id),
          isNull(conversationParticipants.leftAt),
        ),
      )
      .orderBy(desc(conversations.updatedAt));
    const items = (
      await Promise.all(myParts.map((r) => loadConversationView(r.conv, me.id)))
    ).filter((c): c is NonNullable<typeof c> => c !== null);
    res.json(paginate(items));
  }),
);

router.get(
  "/conversations/unread-count",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return res.json({ unreadCount: 0 });
    const myParts = await db
      .select()
      .from(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.participantType, "user"),
          eq(conversationParticipants.participantId, me.id),
          isNull(conversationParticipants.leftAt),
        ),
      );
    let total = 0;
    for (const p of myParts) {
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, p.conversationId),
            isNull(messages.deletedAt),
            ne(messages.senderUserId, me.id),
            // Task #363 — exclude pending DMs from the global unread
            // count for the same reason as `loadConversationView`.
            eq(messages.moderationStatus, "approved"),
            p.lastReadAt ? gt(messages.createdAt, p.lastReadAt) : sql`true`,
          ),
        );
      total += Number(count);
    }
    res.json({ unreadCount: total });
  }),
);

router.post(
  "/conversations",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const recipientId: string | undefined = req.body?.recipientId;
    const recipientType: "user" | "organization" =
      req.body?.recipientType === "organization" ? "organization" : "user";
    if (!recipientId) return apiError(res, 400, "recipientId is required");
    if (recipientType === "user" && recipientId === me.id)
      return apiError(res, 400, "Cannot start a conversation with yourself");
    // Task #363 — Phase 2. Minors still cannot SEND DMs (Phase 1 rule),
    // so we block when `me` is a minor. Adults messaging a minor land
    // as `pending` per-message and the guardian moderates from the
    // family dashboard. Org conversations require adult-only.
    if (recipientType === "user") {
      if (blockMinorAction(res, me, "create_conversation")) {
        void logConsentEvent({
          event: "minor_blocked_action",
          childUserId: me.id,
          details: "create_conversation",
        });
        return;
      }
    } else if (blockMinorAction(res, me, "create_conversation")) {
      return;
    }
    // Resolve minor-recipient gating up front so the first-message
    // insert below can stamp `moderation_status` correctly.
    let dmGate: Awaited<ReturnType<typeof gateDmToRecipient>> | null = null;
    if (recipientType === "user") {
      dmGate = await gateDmToRecipient(me.id, recipientId);
    }

    // Look for an existing direct conversation
    const meParts = await db
      .select({ conversationId: conversationParticipants.conversationId })
      .from(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.participantType, "user"),
          eq(conversationParticipants.participantId, me.id),
        ),
      );
    let conv: typeof conversations.$inferSelect | undefined;
    let isNew = false;
    if (meParts.length > 0) {
      const existing = await db
        .select({ conv: conversations, part: conversationParticipants })
        .from(conversationParticipants)
        .innerJoin(conversations, eq(conversationParticipants.conversationId, conversations.id))
        .where(
          and(
            inArray(
              conversationParticipants.conversationId,
              meParts.map((p) => p.conversationId),
            ),
            eq(conversationParticipants.participantType, recipientType),
            eq(conversationParticipants.participantId, recipientId),
          ),
        )
        .limit(1);
      if (existing.length > 0) conv = existing[0].conv;
    }

    if (!conv) {
      const convType: "direct" | "user_to_org" | "org_to_org" =
        recipientType === "organization" ? "user_to_org" : "direct";
      const [created] = await db.insert(conversations).values({ type: convType }).returning();
      conv = created;
      isNew = true;
      await db.insert(conversationParticipants).values([
        { conversationId: conv.id, participantType: "user", participantId: me.id },
        { conversationId: conv.id, participantType: recipientType, participantId: recipientId },
      ]);
    }

    const firstBody = String(req.body?.message?.body ?? "").trim();
    const rawAssetIds = Array.isArray(req.body?.message?.assetIds)
      ? (req.body.message.assetIds as unknown[])
      : [];
    if (rawAssetIds.length > 10) {
      return apiError(res, 400, "A message can attach at most 10 assets");
    }
    const assetIds: string[] = [];
    for (const v of rawAssetIds) {
      if (typeof v === "string" && v.length > 0 && !assetIds.includes(v)) {
        assetIds.push(v);
      }
    }
    let validAssets: (typeof assets.$inferSelect)[] = [];
    if (assetIds.length > 0) {
      validAssets = await db
        .select()
        .from(assets)
        .where(and(inArray(assets.id, assetIds), eq(assets.ownerId, me.id)));
      if (validAssets.length !== assetIds.length) {
        return apiError(res, 400, "One or more assetIds are invalid or not owned by you");
      }
      const unconfirmed = validAssets.find((a) => a.status !== "confirmed");
      if (unconfirmed) {
        return apiError(res, 400, "All assets must be confirmed before attaching");
      }
    }

    if (firstBody || validAssets.length > 0) {
      const moderationStatus = dmGate?.status === "pending" ? "pending" : "approved";
      const [created] = await db
        .insert(messages)
        .values({
          conversationId: conv.id,
          senderUserId: me.id,
          body: firstBody || null,
          moderationStatus,
        })
        .returning();
      if (
        moderationStatus === "pending" &&
        dmGate?.recipient?.parentId
      ) {
        void logConsentEvent({
          event: "child_pending_dm",
          childUserId: dmGate.recipient.id,
          actorEmail: me.email ?? null,
          details: `message:${created.id}`,
        });
        await notifyGuardianOfPendingItem({
          guardianUserId: dmGate.recipient.parentId,
          childUserId: dmGate.recipient.id,
          kind: "dm",
          message: `New message is awaiting your approval`,
        });
      }
      if (validAssets.length > 0) {
        const orderById = new Map(assetIds.map((id, i) => [id, i] as const));
        await db.insert(messageAssets).values(
          validAssets.map((a) => ({
            messageId: created.id,
            assetId: a.id,
            displayOrder: orderById.get(a.id) ?? 0,
          })),
        );
      }
      conv = (
        await db
          .update(conversations)
          .set({ updatedAt: new Date() })
          .where(eq(conversations.id, conv.id))
          .returning()
      )[0];
    }

    const view = await loadConversationView(conv, me.id);
    if (!view) return apiError(res, 500, "Failed to load conversation");
    res.status(isNew ? 201 : 200).json(view);
  }),
);

router.get(
  "/conversations/search/contacts",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const q = String(req.query.q ?? "").trim();
    if (q.length < 1) {
      return apiError(res, 400, "q is required");
    }
    const limitRaw = Number(req.query.limit);
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(50, Math.floor(limitRaw)) : 20;
    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        avatarUrl: users.avatarUrl,
        isMinor: users.isMinor,
        parentId: users.parentId,
      })
      .from(users)
      .where(
        and(
          or(ilike(users.name, `%${q}%`), ilike(users.email, `%${q}%`)),
          ne(users.id, me.id),
        ),
      )
      .orderBy(asc(users.name))
      .limit(limit);
    // Task #359 — strangers cannot start a DM with a minor through the
    // contacts picker; the minor's linked guardian still sees them.
    const visible = filterOutMinors(rows, me.id);
    res.json({
      data: visible.map((u) => ({
        id: u.id,
        displayName: u.name,
        avatarUrl: safeAvatarUrl(u.avatarUrl),
      })),
    });
  }),
);

router.get(
  "/conversations/:id",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [conv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, req.params.id))
      .limit(1);
    if (!conv) return notFound(res);
    const [iAmIn] = await db
      .select()
      .from(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.conversationId, conv.id),
          eq(conversationParticipants.participantType, "user"),
          eq(conversationParticipants.participantId, me.id),
        ),
      )
      .limit(1);
    if (!iAmIn) return apiError(res, 403, "Not a participant");
    const view = await loadConversationView(conv, me.id);
    if (!view) return notFound(res);
    res.json(view);
  }),
);

router.delete(
  "/conversations/:id",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    await db
      .update(conversationParticipants)
      .set({ leftAt: new Date() })
      .where(
        and(
          eq(conversationParticipants.conversationId, req.params.id),
          eq(conversationParticipants.participantType, "user"),
          eq(conversationParticipants.participantId, me.id),
        ),
      );
    res.status(204).end();
  }),
);

router.get(
  "/conversations/:id/messages",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [iAmIn] = await db
      .select()
      .from(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.conversationId, req.params.id),
          eq(conversationParticipants.participantType, "user"),
          eq(conversationParticipants.participantId, me.id),
        ),
      )
      .limit(1);
    if (!iAmIn) return apiError(res, 403, "Not a participant");
    const rows = await db
      .select({ m: messages, sender: users })
      .from(messages)
      .leftJoin(users, eq(messages.senderUserId, users.id))
      .where(eq(messages.conversationId, req.params.id))
      .orderBy(asc(messages.createdAt));
    // Drop messages a guardian has hidden for *this* viewing user (only
    // applies when the viewer is a child whose parent removed a message
    // from the family stream).
    const hides = await db
      .select({ messageId: messageChildHides.messageId })
      .from(messageChildHides)
      .where(eq(messageChildHides.childId, me.id));
    const hiddenIds = new Set(hides.map((h) => h.messageId));
    // Task #363 — Phase 2 message gating. The minor recipient should
    // never see a `pending` or `declined` message; the sender always
    // sees their own (with a "pending review" indicator surfaced via
    // the `moderationStatus` field); the linked guardian sees them all
    // for moderation. We keep the filter cheap by inferring the
    // viewer's relationship to each message off `senderUserId` and the
    // child↔guardian map computed once for this conversation.
    const otherUsers = await db
      .select({
        userId: conversationParticipants.participantId,
        parentId: users.parentId,
      })
      .from(conversationParticipants)
      .innerJoin(users, eq(users.id, conversationParticipants.participantId))
      .where(
        and(
          eq(conversationParticipants.conversationId, req.params.id),
          eq(conversationParticipants.participantType, "user"),
        ),
      );
    const myChildren = new Set(
      otherUsers.filter((u) => u.parentId === me.id).map((u) => u.userId),
    );
    const isViewerGuardian = myChildren.size > 0;
    const visibleRows = rows.filter((r) => {
      if (hiddenIds.has(r.m.id)) return false;
      if (r.m.moderationStatus === "approved") return true;
      // Sender always sees their own message.
      if (r.m.senderUserId === me.id) return true;
      // Guardian sees pending — pending is only created when a minor
      // they parent is the recipient.
      if (isViewerGuardian && r.m.moderationStatus === "pending") return true;
      return false;
    });
    const assetsByMessage = await loadAssetsForMessages(
      visibleRows.map((r) => r.m.id),
    );
    res.json(
      paginate(
        visibleRows.map((r) =>
          toMessage(
            r.m,
            r.sender
              ? {
                  id: r.sender.id,
                  displayName: displayName(r.sender),
                  avatarUrl: safeAvatarUrl(r.sender.avatarUrl),
                }
              : null,
            assetsByMessage.get(r.m.id) ?? [],
          ),
        ),
      ),
    );
  }),
);

router.post(
  "/conversations/:id/messages",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    const [iAmIn] = await db
      .select()
      .from(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.conversationId, req.params.id),
          eq(conversationParticipants.participantType, "user"),
          eq(conversationParticipants.participantId, me.id),
        ),
      )
      .limit(1);
    if (!iAmIn) return apiError(res, 403, "Not a participant");
    // Task #359 — minors cannot post follow-up messages either.
    if (blockMinorAction(res, me, "send_message")) return;
    // Task #363 — Phase 2. Find any minor recipient on the other side
    // and gate the message: linked guardians + DM-allowlist senders go
    // through approved; everyone else lands `pending`.
    const otherUserParts = await db
      .select({
        userId: conversationParticipants.participantId,
        isMinor: users.isMinor,
        parentId: users.parentId,
      })
      .from(conversationParticipants)
      .innerJoin(users, eq(users.id, conversationParticipants.participantId))
      .where(
        and(
          eq(conversationParticipants.conversationId, req.params.id),
          eq(conversationParticipants.participantType, "user"),
          ne(conversationParticipants.participantId, me.id),
        ),
      );
    const minorRecipient = otherUserParts.find((p) => p.isMinor) ?? null;
    let messageGate: Awaited<ReturnType<typeof gateDmToRecipient>> | null = null;
    if (minorRecipient) {
      messageGate = await gateDmToRecipient(me.id, minorRecipient.userId);
    }
    const body = String(req.body?.body ?? "").trim();
    const rawAssetIds = Array.isArray(req.body?.assetIds)
      ? (req.body.assetIds as unknown[])
      : [];
    if (rawAssetIds.length > 10) {
      return apiError(res, 400, "A message can attach at most 10 assets");
    }
    const assetIds: string[] = [];
    for (const v of rawAssetIds) {
      if (typeof v === "string" && v.length > 0 && !assetIds.includes(v)) {
        assetIds.push(v);
      }
    }
    if (!body && assetIds.length === 0) {
      return apiError(res, 400, "Message body or assetIds required");
    }
    let validAssets: (typeof assets.$inferSelect)[] = [];
    if (assetIds.length > 0) {
      validAssets = await db
        .select()
        .from(assets)
        .where(and(inArray(assets.id, assetIds), eq(assets.ownerId, me.id)));
      if (validAssets.length !== assetIds.length) {
        return apiError(res, 400, "One or more assetIds are invalid or not owned by you");
      }
      const unconfirmed = validAssets.find((a) => a.status !== "confirmed");
      if (unconfirmed) {
        return apiError(res, 400, "All assets must be confirmed before attaching");
      }
    }
    const moderationStatus =
      messageGate?.status === "pending" ? "pending" : "approved";
    const [m] = await db
      .insert(messages)
      .values({
        conversationId: req.params.id,
        senderUserId: me.id,
        body: body || null,
        moderationStatus,
      })
      .returning();
    if (
      moderationStatus === "pending" &&
      messageGate?.recipient?.parentId
    ) {
      void logConsentEvent({
        event: "child_pending_dm",
        childUserId: messageGate.recipient.id,
        actorEmail: me.email ?? null,
        details: `message:${m.id}`,
      });
      await notifyGuardianOfPendingItem({
        guardianUserId: messageGate.recipient.parentId,
        childUserId: messageGate.recipient.id,
        kind: "dm",
        message: `New message is awaiting your approval`,
      });
    }
    if (validAssets.length > 0) {
      const orderById = new Map(assetIds.map((id, i) => [id, i] as const));
      await db.insert(messageAssets).values(
        validAssets.map((a) => ({
          messageId: m.id,
          assetId: a.id,
          displayOrder: orderById.get(a.id) ?? 0,
        })),
      );
    }
    await db
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(eq(conversations.id, req.params.id));
    res.status(201).json(
      toMessage(
        m,
        {
          id: me.id,
          displayName: displayName(me),
          avatarUrl: safeAvatarUrl(me.avatarUrl),
        },
        validAssets,
      ),
    );
  }),
);

router.post(
  "/conversations/:id/read",
  asyncHandler(async (req, res) => {
    const me = req.sessionUser;
    if (!me) return apiError(res, 401, "Not authenticated");
    await db
      .update(conversationParticipants)
      .set({ lastReadAt: new Date() })
      .where(
        and(
          eq(conversationParticipants.conversationId, req.params.id),
          eq(conversationParticipants.participantType, "user"),
          eq(conversationParticipants.participantId, me.id),
        ),
      );
    res.status(204).end();
  }),
);

export default router;
