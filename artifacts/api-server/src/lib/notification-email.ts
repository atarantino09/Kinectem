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

// Dispatch a single category email to one in-app notification target.
export async function dispatchNotificationEmail(args: {
  userId: string;
  category: EmailCategory;
  build: (ctx: DispatchBuildContext) => EmailMessage;
}): Promise<void> {
  const { userId, category, build } = args;
  try {
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
    if (!target) return;

    let recipientId = target.id;
    let recipientEmail = target.email;
    let recipientName = target.name;
    let isGuardianCopy = false;
    const subjectName = target.name;

    if (target.isMinor) {
      // COPPA — never email a minor's own inbox for engagement. Route to the
      // linked guardian; if there is none, suppress entirely.
      if (!target.parentId) return;
      const [guardian] = await db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, target.parentId))
        .limit(1);
      if (!guardian?.email) return;
      recipientId = guardian.id;
      recipientEmail = guardian.email;
      recipientName = guardian.name;
      isGuardianCopy = true;
    }

    if (!recipientEmail) return;

    const prefs = await getOrCreatePreferences(recipientId);
    if (!wantsCategory(prefs, category)) return;

    const message = build({
      to: recipientEmail,
      recipientName,
      subjectName,
      isGuardianCopy,
      unsubscribeUrl: buildUnsubscribeUrl(prefs.unsubscribeToken, category),
    });
    // The resolved recipient always wins, regardless of what build() set.
    await sendEmail({ ...message, to: recipientEmail });
  } catch (err) {
    // Email is best-effort; never let it break the originating request.
    logger.warn({ err, category }, "dispatchNotificationEmail failed");
  }
}

// Fan-out helper: dispatch the same category email to many targets (deduped).
// Each recipient gets their own resolved address, preferences check, and
// unsubscribe link. Failures are swallowed per-recipient.
export async function dispatchNotificationEmailToMany(args: {
  userIds: ReadonlyArray<string>;
  category: EmailCategory;
  build: (ctx: DispatchBuildContext) => EmailMessage;
}): Promise<void> {
  const unique = Array.from(new Set(args.userIds));
  await Promise.allSettled(
    unique.map((userId) =>
      dispatchNotificationEmail({
        userId,
        category: args.category,
        build: args.build,
      }),
    ),
  );
}
