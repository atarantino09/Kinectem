import { db, users, notifications } from "@workspace/db";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { sendGuardianExpiredEmail } from "./email";
import { logger } from "./logger";

// Creates a notification on the parent's account for each linked child whose
// guardian-confirmation token has expired without being confirmed. Existing
// notifications for the same child are not duplicated. Also sends one expired
// email per child per expiry cycle (resend clears the dedupe flag).
export async function notifyExpiredGuardianConfirmations(
  parentUserId: string,
): Promise<void> {
  const expiredChildren = await db
    .select({
      id: users.id,
      name: users.name,
      guardianEmail: users.guardianEmail,
      guardianExpiredEmailSentAt: users.guardianExpiredEmailSentAt,
    })
    .from(users)
    .where(
      and(
        eq(users.parentId, parentUserId),
        isNull(users.guardianConfirmedAt),
        sql`${users.guardianConfirmTokenExpiresAt} IS NOT NULL`,
        lt(users.guardianConfirmTokenExpiresAt, new Date()),
      ),
    );
  if (expiredChildren.length === 0) return;

  const notifiableChildren = expiredChildren.filter((c) => c.guardianEmail);
  if (notifiableChildren.length > 0) {
    const links = notifiableChildren.map((c) => `/guardian?childId=${c.id}`);
    const existing = await db
      .select({ link: notifications.link })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, parentUserId),
          eq(notifications.kind, "guardian_expired"),
          inArray(notifications.link, links),
        ),
      );
    const alreadyNotified = new Set(
      existing.map((n) => n.link).filter((l): l is string => !!l),
    );

    const toInsert = notifiableChildren
      .filter((c) => !alreadyNotified.has(`/guardian?childId=${c.id}`))
      .map((c) => {
        const [first] = c.name.split(" ");
        return {
          userId: parentUserId,
          kind: "guardian_expired",
          message: `${first ?? c.name}'s guardian confirmation link has expired. Send a new one so they don't lose access.`,
          link: `/guardian?childId=${c.id}`,
        };
      });
    if (toInsert.length > 0) {
      await db.insert(notifications).values(toInsert);
    }
  }

  const parentRow = await db
    .select({
      email: users.email,
      optOut: users.guardianExpiredEmailOptOut,
    })
    .from(users)
    .where(eq(users.id, parentUserId))
    .limit(1);
  const parentEmail = parentRow[0]?.email ?? null;
  const parentOptedOut = !!parentRow[0]?.optOut;

  if (parentOptedOut) return;

  for (const child of expiredChildren) {
    if (child.guardianExpiredEmailSentAt) continue;
    const to = child.guardianEmail ?? parentEmail;
    if (!to) continue;
    try {
      await sendGuardianExpiredEmail(to, child.name);
    } catch (err) {
      logger.error(
        { err, childId: child.id },
        "Failed to send guardian-expired email",
      );
      continue;
    }
    await db
      .update(users)
      .set({ guardianExpiredEmailSentAt: new Date() })
      .where(eq(users.id, child.id));
  }
}
