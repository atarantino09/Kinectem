// Task #633 — Central COPPA-aware email-dispatch gate.
//
// Decides whether to email a user for a given (non-essential) notification
// category, applying minor->guardian routing and the recipient's preferences,
// then builds + sends via the email.ts helper.
//
// `userId` is the in-app notification target ("about whom"). For a minor we
// never email their own inbox: the engagement email is routed to the linked
// guardian and gated on the GUARDIAN's preferences (they are the recipient).
// Essential/transactional emails (password reset, guardian/parental consent,
// guardian-confirm) do NOT go through this gate — callers send them directly.

import { db, users } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import { appBaseUrl, sendEmail, type EmailMessage } from "./email";
import {
  getOrCreatePreferences,
  wantsCategory,
  type EmailCategory,
} from "./notification-prefs";

export interface DispatchBuildContext {
  // The address the email will be sent to (guardian's when routed).
  to: string;
  // Display name of the actual recipient (guardian for a minor, else the user).
  recipientName: string;
  // Display name of the original in-app notification target. Equals
  // `recipientName` for adults; the minor's name when `isGuardianCopy`.
  subjectName: string;
  // True when the notification was about a minor and we routed the email to
  // their linked guardian instead of the minor's own inbox.
  isGuardianCopy: boolean;
  // Ready-to-embed one-click unsubscribe link for this category.
  unsubscribeUrl: string;
}

export function buildUnsubscribeUrl(
  token: string,
  category: EmailCategory | "all",
): string {
  const params = new URLSearchParams({ token, cat: category });
  return `${appBaseUrl()}/api/v1/notifications/unsubscribe?${params.toString()}`;
}

// The actual email recipient after COPPA minor->guardian routing.
interface ResolvedRecipient {
  recipientId: string;
  recipientEmail: string;
  recipientName: string;
  subjectName: string;
  isGuardianCopy: boolean;
}

// Resolve an in-app notification target to the address we may email, applying
// COPPA minor->guardian routing. Returns null when the email must be
// suppressed (no such user, a minor with no linked guardian, or no address).
async function resolveEmailRecipient(
  userId: string,
): Promise<ResolvedRecipient | null> {
  const [target] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      isMinor: users.isMinor,
      parentId: users.parentId,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!target) return null;

  let recipientId = target.id;
  let recipientEmail = target.email;
  let recipientName = target.name;
  let isGuardianCopy = false;
  const subjectName = target.name;

  if (target.isMinor) {
    // COPPA — never email a minor's own inbox for engagement. Route to the
    // linked guardian; if there is none, suppress entirely.
    if (!target.parentId) return null;
    const [guardian] = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, target.parentId))
      .limit(1);
    if (!guardian?.email) return null;
    recipientId = guardian.id;
    recipientEmail = guardian.email;
    recipientName = guardian.name;
    isGuardianCopy = true;
  }

  if (!recipientEmail) return null;
  return { recipientId, recipientEmail, recipientName, subjectName, isGuardianCopy };
}

// Gate on the resolved recipient's preferences, then build + send.
async function sendToResolved(
  resolved: ResolvedRecipient,
  category: EmailCategory,
  build: (ctx: DispatchBuildContext) => EmailMessage,
): Promise<void> {
  const prefs = await getOrCreatePreferences(resolved.recipientId);
  if (!wantsCategory(prefs, category)) return;
  const message = build({
    to: resolved.recipientEmail,
    recipientName: resolved.recipientName,
    subjectName: resolved.subjectName,
    isGuardianCopy: resolved.isGuardianCopy,
    unsubscribeUrl: buildUnsubscribeUrl(prefs.unsubscribeToken, category),
  });
  // The resolved recipient always wins, regardless of what build() set.
  await sendEmail({ ...message, to: resolved.recipientEmail });
}

// Dispatch a single category email to one in-app notification target.
// `excludeRecipientUserId` suppresses the send when the RESOLVED recipient is
// that user — e.g. a guardian who is also the actor (commented on their own
// child's post), so they never get notified about their own action.
export async function dispatchNotificationEmail(args: {
  userId: string;
  category: EmailCategory;
  build: (ctx: DispatchBuildContext) => EmailMessage;
  excludeRecipientUserId?: string;
}): Promise<void> {
  const { userId, category, build, excludeRecipientUserId } = args;
  try {
    const resolved = await resolveEmailRecipient(userId);
    if (!resolved) return;
    if (excludeRecipientUserId && resolved.recipientId === excludeRecipientUserId)
      return;
    await sendToResolved(resolved, category, build);
  } catch (err) {
    // Email is best-effort; never let it break the originating request.
    logger.warn({ err, category }, "dispatchNotificationEmail failed");
  }
}

// Fan-out helper: dispatch the same category email to many targets. Deduped by
// the RESOLVED recipient (not the raw target): guardians auto-follow their
// child's teams, so a child-follower row and the guardian's own follower row
// both resolve to the guardian — they must collapse to a single email.
// `excludeRecipientUserId` drops the actor even when reached via routing.
export async function dispatchNotificationEmailToMany(args: {
  userIds: ReadonlyArray<string>;
  category: EmailCategory;
  build: (ctx: DispatchBuildContext) => EmailMessage;
  excludeRecipientUserId?: string;
}): Promise<void> {
  const uniqueIds = Array.from(new Set(args.userIds));
  const byRecipient = new Map<string, ResolvedRecipient>();
  await Promise.allSettled(
    uniqueIds.map(async (userId) => {
      try {
        const resolved = await resolveEmailRecipient(userId);
        if (!resolved) return;
        if (
          args.excludeRecipientUserId &&
          resolved.recipientId === args.excludeRecipientUserId
        )
          return;
        if (!byRecipient.has(resolved.recipientId)) {
          byRecipient.set(resolved.recipientId, resolved);
        }
      } catch (err) {
        logger.warn(
          { err, category: args.category },
          "dispatchNotificationEmailToMany resolve failed",
        );
      }
    }),
  );
  await Promise.allSettled(
    Array.from(byRecipient.values()).map(async (resolved) => {
      try {
        await sendToResolved(resolved, args.category, args.build);
      } catch (err) {
        logger.warn(
          { err, category: args.category },
          "dispatchNotificationEmailToMany send failed",
        );
      }
    }),
  );
}
