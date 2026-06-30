import {
  db,
  notifications,
  organizationAdmins,
  rosterEntries,
  teamFollowers,
} from "@workspace/db";
import { and, eq, inArray, ne, or } from "drizzle-orm";
import { articlePostId, highlightPostId } from "./spec-helpers";
import { dispatchNotificationEmailToMany } from "./notification-email";
import {
  appBaseUrl,
  buildGameRecapReminderEmail,
  buildTeamContentEmail,
} from "./email";

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

export const PENDING_POST_APPROVAL_NOTIF_KIND = "team_post_pending_approval";

// Task #455 — When a non-admin author submits a long-form recap that
// lands in `pending_approval` (either via `POST /posts` long-form or
// via publishing a draft), fan out an in-app notification to every
// owner / admin of the team's organization so they know there is a
// post waiting on their review. Mirrors `notifyAdminsOfTeamHighlight`:
// the actor is excluded from the recipient list, and minor actors are
// expected to be passed in pre-masked (`maskedDisplayName(me)`) by the
// caller so a minor's last name never leaks into a non-privileged
// admin's notification row. The link points at the org page that
// hosts `OrgAdminPanel` (the approval queue UI).
export async function notifyAdminsOfPendingPostApproval(args: {
  organizationId: string;
  teamName: string | null;
  articleId: string;
  articleTitle: string | null;
  actorUserId: string;
  actorDisplayName: string;
}): Promise<void> {
  const link = `/organizations/${args.organizationId}`;
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
  const title = args.articleTitle?.trim() ? args.articleTitle.trim() : "Untitled";
  const teamLabel = args.teamName?.trim() ? args.teamName.trim() : "the team";
  const message = `${args.actorDisplayName} submitted a recap for the ${teamLabel} and is awaiting your approval: "${title}"`;
  await db.insert(notifications).values(
    recipients.map((userId) => ({
      userId,
      kind: PENDING_POST_APPROVAL_NOTIF_KIND,
      message,
      link,
      actorUserId: args.actorUserId,
    })),
  );
}

export const PENDING_HIGHLIGHT_APPROVAL_NOTIF_KIND = "team_highlight_pending_approval";
export const HIGHLIGHT_APPROVED_NOTIF_KIND = "highlight_approved";
export const HIGHLIGHT_DECLINED_NOTIF_KIND = "highlight_declined";

// Task #559 — When a player or parent uploads a highlight to a team,
// it lands in `pending` and is hidden from public read paths until a
// staff approver (org admin/owner, head/assistant coach, manager, or
// "author") approves it. Fan out a bell notification to every staff
// approver on the team so the queue is visible without polling. The
// uploader is excluded (they already know they submitted). Mirrors
// `notifyAdminsOfPendingPostApproval`: minor actors are expected to
// be passed pre-masked. Link points at the team page's pending
// highlights drawer.
export async function notifyStaffOfPendingHighlight(args: {
  teamId: string;
  organizationId: string;
  teamName: string | null;
  highlightId: string;
  highlightTitle: string | null;
  actorUserId: string;
  actorDisplayName: string;
}): Promise<void> {
  const link = `/teams/${args.teamId}?pendingHighlights=1`;
  const [adminRows, staffRosterRows] = await Promise.all([
    db
      .select({ userId: organizationAdmins.userId })
      .from(organizationAdmins)
      .where(
        and(
          eq(organizationAdmins.organizationId, args.organizationId),
          inArray(organizationAdmins.role, [...ADMIN_ROLES]),
          ne(organizationAdmins.userId, args.actorUserId),
        ),
      ),
    db
      .select({ userId: rosterEntries.userId })
      .from(rosterEntries)
      .where(
        and(
          eq(rosterEntries.teamId, args.teamId),
          eq(rosterEntries.status, "accepted"),
          ne(rosterEntries.userId, args.actorUserId),
          // Coach role (head/assistant) OR position author/manager.
          // These mirror canCreateRecap / canApproveTeamHighlight.
          or(
            eq(rosterEntries.role, "coach"),
            inArray(rosterEntries.position, ["author", "manager"]),
          ),
        ),
      ),
  ]);
  const recipients = Array.from(
    new Set([...adminRows, ...staffRosterRows].map((r) => r.userId)),
  );
  if (recipients.length === 0) return;
  const title = args.highlightTitle?.trim() ? args.highlightTitle.trim() : "Untitled";
  const teamLabel = args.teamName?.trim() ? args.teamName.trim() : "the team";
  const message = `${args.actorDisplayName} uploaded a highlight to ${teamLabel} and is awaiting your approval: "${title}"`;
  await db.insert(notifications).values(
    recipients.map((userId) => ({
      userId,
      kind: PENDING_HIGHLIGHT_APPROVAL_NOTIF_KIND,
      message,
      link,
      actorUserId: args.actorUserId,
    })),
  );
}

// Task #559 — Notify the uploader after a staff approver decides on
// their pending highlight. Skip when the approver is the uploader
// (shouldn't happen since staff uploads bypass approval, but defensive).
export async function notifyHighlightDecision(args: {
  uploaderId: string;
  highlightId: string;
  highlightTitle: string | null;
  decidedBy: string;
  decision: "approved" | "declined";
  // Optional staff-supplied decline note. Trimmed by the caller and
  // ignored on approvals.
  reason?: string | null;
}): Promise<void> {
  if (args.uploaderId === args.decidedBy) return;
  const title = args.highlightTitle?.trim() ? args.highlightTitle.trim() : "your highlight";
  const link = `/posts/${highlightPostId(args.highlightId)}`;
  const reason =
    args.decision === "declined" && args.reason?.trim()
      ? args.reason.trim()
      : null;
  const declineMessage = reason
    ? `Your highlight "${title}" was declined: ${reason}`
    : `Your highlight "${title}" was declined.`;
  await db.insert(notifications).values({
    userId: args.uploaderId,
    kind:
      args.decision === "approved"
        ? HIGHLIGHT_APPROVED_NOTIF_KIND
        : HIGHLIGHT_DECLINED_NOTIF_KIND,
    message:
      args.decision === "approved"
        ? `Your highlight "${title}" was approved.`
        : declineMessage,
    link,
    actorUserId: args.decidedBy,
  });
}

export const GAME_RECAP_REMINDER_NOTIF_KIND = "game_recap_reminder";

// When a game's start time is a couple hours behind us and no recap has been
// linked yet, nudge the team's recap-writing staff to write one. Recipients
// mirror `notifyStaffOfPendingHighlight` (org owners/admins + coach-role
// roster + author/manager positions) — the same people who see the "Write
// game recap" prompt on the event. Returns the number of rows inserted so the
// caller can log it. There is no actor (system-generated), so `actorUserId`
// is left null.
export async function notifyStaffOfGameRecapReminder(args: {
  teamId: string;
  organizationId: string;
  teamName: string | null;
  opponent: string | null;
  eventId: string;
}): Promise<number> {
  const link = `/teams/${args.teamId}`;
  const [adminRows, staffRosterRows] = await Promise.all([
    db
      .select({ userId: organizationAdmins.userId })
      .from(organizationAdmins)
      .where(
        and(
          eq(organizationAdmins.organizationId, args.organizationId),
          inArray(organizationAdmins.role, [...ADMIN_ROLES]),
        ),
      ),
    db
      .select({ userId: rosterEntries.userId })
      .from(rosterEntries)
      .where(
        and(
          eq(rosterEntries.teamId, args.teamId),
          eq(rosterEntries.status, "accepted"),
          or(
            eq(rosterEntries.role, "coach"),
            inArray(rosterEntries.position, ["author", "manager"]),
          ),
        ),
      ),
  ]);
  const recipients = Array.from(
    new Set([...adminRows, ...staffRosterRows].map((r) => r.userId)),
  );
  if (recipients.length === 0) return 0;
  const teamLabel = args.teamName?.trim() ? args.teamName.trim() : "your team";
  const opponentLabel = args.opponent?.trim()
    ? ` vs ${args.opponent.trim()}`
    : "";
  const message = `${teamLabel}'s game${opponentLabel} has wrapped up — don't forget to write the game recap.`;
  await db.insert(notifications).values(
    recipients.map((userId) => ({
      userId,
      kind: GAME_RECAP_REMINDER_NOTIF_KIND,
      message,
      link,
    })),
  );
  // Task #633 — also nudge by email (gated by prefs; minors -> guardian).
  const teamUrl = `${appBaseUrl()}/teams/${args.teamId}`;
  await dispatchNotificationEmailToMany({
    userIds: recipients,
    category: "reminder_game_recap",
    build: (ctx) =>
      buildGameRecapReminderEmail(ctx, {
        teamName: args.teamName,
        opponent: args.opponent,
        teamUrl,
      }),
  });
  return recipients.length;
}

export const TEAM_ARCHIVED_NOTIF_KIND = "team_archived";
export const TEAM_UNARCHIVED_NOTIF_KIND = "team_unarchived";

// Task #473 — When a team owner archives (or unarchives) a team, fan out
// an in-app notification to everyone with a meaningful relationship to
// it: accepted roster members, opt-in team followers, and the team's
// org admins/owners. Without this they only discover the change when a
// write action fails or they happen to revisit the team page. The link
// always points at `/teams/<teamId>` so the recipient lands on the page
// that now renders the archived banner. Recipients are deduped (a coach
// who is also a follower receives one row, not two) and the actor is
// excluded — owners don't notify themselves about their own action.
async function fanOutTeamArchiveNotification(args: {
  teamId: string;
  organizationId: string;
  teamName: string | null;
  actorUserId: string;
  kind: typeof TEAM_ARCHIVED_NOTIF_KIND | typeof TEAM_UNARCHIVED_NOTIF_KIND;
}): Promise<void> {
  const [rosterRows, followerRows, adminRows] = await Promise.all([
    db
      .select({ userId: rosterEntries.userId })
      .from(rosterEntries)
      .where(
        and(
          eq(rosterEntries.teamId, args.teamId),
          eq(rosterEntries.status, "accepted"),
          ne(rosterEntries.userId, args.actorUserId),
        ),
      ),
    db
      .select({ userId: teamFollowers.userId })
      .from(teamFollowers)
      .where(
        and(
          eq(teamFollowers.teamId, args.teamId),
          ne(teamFollowers.userId, args.actorUserId),
        ),
      ),
    db
      .select({ userId: organizationAdmins.userId })
      .from(organizationAdmins)
      .where(
        and(
          eq(organizationAdmins.organizationId, args.organizationId),
          inArray(organizationAdmins.role, [...ADMIN_ROLES]),
          ne(organizationAdmins.userId, args.actorUserId),
        ),
      ),
  ]);
  const recipients = Array.from(
    new Set(
      [...rosterRows, ...followerRows, ...adminRows].map((r) => r.userId),
    ),
  );
  if (recipients.length === 0) return;
  const teamLabel = args.teamName?.trim() ? args.teamName.trim() : "A team";
  const message =
    args.kind === TEAM_ARCHIVED_NOTIF_KIND
      ? `${teamLabel} has been archived. It is now read-only.`
      : `${teamLabel} has been unarchived and is active again.`;
  const link = `/teams/${args.teamId}`;
  await db.insert(notifications).values(
    recipients.map((userId) => ({
      userId,
      kind: args.kind,
      message,
      link,
      actorUserId: args.actorUserId,
    })),
  );
}

export async function notifyTeamArchived(args: {
  teamId: string;
  organizationId: string;
  teamName: string | null;
  actorUserId: string;
}): Promise<void> {
  await fanOutTeamArchiveNotification({
    ...args,
    kind: TEAM_ARCHIVED_NOTIF_KIND,
  });
}

export async function notifyTeamUnarchived(args: {
  teamId: string;
  organizationId: string;
  teamName: string | null;
  actorUserId: string;
}): Promise<void> {
  await fanOutTeamArchiveNotification({
    ...args,
    kind: TEAM_UNARCHIVED_NOTIF_KIND,
  });
}

// Task #633 — Email-only fan-out to a team's followers when a new game recap
// is published. There is no in-app bell for this (followers already see new
// recaps in their feed); the email is the opt-in `team_recap` channel. The
// dispatch gate handles per-recipient preferences, the no-login unsubscribe
// link, and COPPA minor->guardian routing, so minors never receive it
// directly. The author is always excluded.
export async function notifyTeamFollowersOfNewRecap(args: {
  teamId: string;
  teamName: string | null;
  articleId: string;
  articleTitle: string;
  actorName: string;
  actorUserId: string;
}): Promise<void> {
  const rows = await db
    .select({ userId: teamFollowers.userId })
    .from(teamFollowers)
    .where(eq(teamFollowers.teamId, args.teamId));
  const recipientIds = rows
    .map((r) => r.userId)
    .filter((id) => id !== args.actorUserId);
  if (recipientIds.length === 0) return;
  const postUrl = `${appBaseUrl()}/posts/${articlePostId(args.articleId)}`;
  await dispatchNotificationEmailToMany({
    userIds: recipientIds,
    excludeRecipientUserId: args.actorUserId,
    category: "team_recap",
    build: (ctx) =>
      buildTeamContentEmail(ctx, {
        teamName: args.teamName,
        actorName: args.actorName,
        title: args.articleTitle,
        postUrl,
        contentLabel: "recap",
      }),
  });
}

// Task #633 — the highlight counterpart of `notifyTeamFollowersOfNewRecap`.
// Highlights are the other half of a team's post feed alongside recaps, so a
// newly-published one fans out to the team's followers via the same email-only
// `team_recap` channel (no in-app bell — followers see it in their feed). The
// dispatch gate handles per-recipient preferences, the no-login unsubscribe
// link, and COPPA minor->guardian routing. The uploader is always excluded.
export async function notifyTeamFollowersOfNewHighlight(args: {
  teamId: string;
  teamName: string | null;
  highlightId: string;
  highlightTitle: string;
  actorName: string;
  actorUserId: string | null;
}): Promise<void> {
  const rows = await db
    .select({ userId: teamFollowers.userId })
    .from(teamFollowers)
    .where(eq(teamFollowers.teamId, args.teamId));
  const recipientIds = rows
    .map((r) => r.userId)
    .filter((id) => id !== args.actorUserId);
  if (recipientIds.length === 0) return;
  const postUrl = `${appBaseUrl()}/posts/${highlightPostId(args.highlightId)}`;
  await dispatchNotificationEmailToMany({
    userIds: recipientIds,
    excludeRecipientUserId: args.actorUserId ?? undefined,
    category: "team_recap",
    build: (ctx) =>
      buildTeamContentEmail(ctx, {
        teamName: args.teamName,
        actorName: args.actorName,
        title: args.highlightTitle,
        postUrl,
        contentLabel: "highlight",
      }),
  });
}
