import { db, notifications, organizationAdmins } from "@workspace/db";
import { and, eq, inArray, ne } from "drizzle-orm";
import { highlightPostId } from "./spec-helpers";

// Roles in `organization_admins` that count as a "team admin" for the
// purpose of moderation-style fan-out notifications. Plain "member" is
// excluded — they do not moderate the team's content.
const ADMIN_ROLES = ["owner", "admin"] as const;

export const HIGHLIGHT_ADMIN_NOTIF_KIND = "team_highlight_created";

// Task #306 — When a non-admin roster member posts a team-scoped
// highlight, fan out an in-app notification to every owner / admin
// of the team's organization so they can moderate or amplify the new
// content. Suppressed when the poster is themselves an org admin
// (the team is already in their own moderation queue) and skipped
// for any caller listed as the actor (they don't notify themselves
// even if they happen to be an admin too).
export async function notifyAdminsOfTeamHighlight(args: {
  organizationId: string;
  teamName: string | null;
  highlightId: string;
  highlightTitle: string | null;
  actorUserId: string;
  actorDisplayName: string;
}): Promise<void> {
  const link = `/posts/${highlightPostId(args.highlightId)}`;
  const adminRows = await db
    .select({ userId: organizationAdmins.userId })
    .from(organizationAdmins)
    .where(
      and(
        eq(organizationAdmins.organizationId, args.organizationId),
        inArray(organizationAdmins.role, [...ADMIN_ROLES]),
        ne(organizationAdmins.userId, args.actorUserId),
      ),
    );
  const recipients = Array.from(new Set(adminRows.map((r) => r.userId)));
  if (recipients.length === 0) return;
  const title = args.highlightTitle?.trim() ? args.highlightTitle.trim() : "Untitled";
  const teamLabel = args.teamName?.trim() ? args.teamName.trim() : "the team";
  const message = `${args.actorDisplayName} posted a new highlight to ${teamLabel}: "${title}"`;
  await db.insert(notifications).values(
    recipients.map((userId) => ({
      userId,
      kind: HIGHLIGHT_ADMIN_NOTIF_KIND,
      message,
      link,
      actorUserId: args.actorUserId,
    })),
  );
}
