import {
  db,
  articleAuthors,
  organizationAdmins,
  rosterEntries,
  teams,
  users,
  type teams as TeamsT,
} from "@workspace/db";
import { and, eq, inArray, or } from "drizzle-orm";

type Team = typeof TeamsT.$inferSelect;

// Roles that can act on behalf of the organization (edit, manage members,
// approve content, etc.). Plain "member" is intentionally excluded.
const MANAGE_ROLES = ["owner", "admin"] as const;

export async function canManageTeam(userId: string, team: Team): Promise<boolean> {
  const [orgAdmin] = await db
    .select()
    .from(organizationAdmins)
    .where(
      and(
        eq(organizationAdmins.organizationId, team.organizationId),
        eq(organizationAdmins.userId, userId),
        inArray(organizationAdmins.role, [...MANAGE_ROLES]),
      ),
    )
    .limit(1);
  if (orgAdmin) return true;

  const [coachEntry] = await db
    .select()
    .from(rosterEntries)
    .where(
      and(
        eq(rosterEntries.teamId, team.id),
        eq(rosterEntries.userId, userId),
        eq(rosterEntries.role, "coach"),
        eq(rosterEntries.status, "accepted"),
      ),
    )
    .limit(1);
  return Boolean(coachEntry);
}

export async function canManageOrganization(userId: string, organizationId: string): Promise<boolean> {
  const [row] = await db
    .select()
    .from(organizationAdmins)
    .where(
      and(
        eq(organizationAdmins.organizationId, organizationId),
        eq(organizationAdmins.userId, userId),
        inArray(organizationAdmins.role, [...MANAGE_ROLES]),
      ),
    )
    .limit(1);
  return Boolean(row);
}

// Returns the caller's stored role in the org, or null if they are not a
// member at all. Distinct from `canManageOrganization`, which collapses
// owner+admin into a single boolean — callers that need to check whether
// they are specifically the owner (e.g. transfer-ownership) use this.
export async function getOrgRole(
  userId: string,
  organizationId: string,
): Promise<"owner" | "admin" | "member" | null> {
  const [row] = await db
    .select({ role: organizationAdmins.role })
    .from(organizationAdmins)
    .where(
      and(
        eq(organizationAdmins.organizationId, organizationId),
        eq(organizationAdmins.userId, userId),
      ),
    )
    .limit(1);
  return row?.role ?? null;
}

export async function isTeamMember(userId: string, teamId: string): Promise<boolean> {
  const [row] = await db
    .select()
    .from(rosterEntries)
    .where(
      and(
        eq(rosterEntries.teamId, teamId),
        eq(rosterEntries.userId, userId),
        eq(rosterEntries.status, "accepted"),
      ),
    )
    .limit(1);
  return Boolean(row);
}

// Team Schedule — who may VIEW a team's schedule. Members-only by design
// (the schedule is never part of the public team page): org owners/admins,
// the team's coaches, accepted rostered athletes, and the parents of those
// athletes. Coaches and accepted players are both covered by `isTeamMember`
// (an accepted roster row); org managers by `canManageOrganization`; parents
// via the `users.parentId` link to an accepted child on this team.
export async function canViewTeamSchedule(
  userId: string,
  team: Team,
): Promise<boolean> {
  if (await canManageOrganization(userId, team.organizationId)) return true;
  if (await isTeamMember(userId, team.id)) return true;
  const [row] = await db
    .select({ id: rosterEntries.id })
    .from(rosterEntries)
    .innerJoin(users, eq(users.id, rosterEntries.userId))
    .where(
      and(
        eq(rosterEntries.teamId, team.id),
        eq(rosterEntries.status, "accepted"),
        eq(users.parentId, userId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function canCreateRecap(
  userId: string,
  team: Team,
): Promise<boolean> {
  // Org admins and team coaches can always author recaps.
  if (await canManageTeam(userId, team)) return true;
  // Parents/members granted the explicit "author" or "manager"
  // position can also author. Task #559 — team managers are part of
  // the staff set (admin / head coach / assistant coach / manager /
  // author) that may publish recaps and approve player/parent
  // highlight uploads.
  const [staffEntry] = await db
    .select()
    .from(rosterEntries)
    .where(
      and(
        eq(rosterEntries.teamId, team.id),
        eq(rosterEntries.userId, userId),
        eq(rosterEntries.status, "accepted"),
        inArray(rosterEntries.position, ["author", "manager"]),
      ),
    )
    .limit(1);
  return Boolean(staffEntry);
}

// Task #559 — `canCreateRecap` defines the same "team staff" set we use
// for highlight-approval rights (admin / head coach / assistant coach /
// manager / author). Re-export under a name that reads correctly at
// every call site without a fresh DB read.
export const canApproveTeamHighlight = canCreateRecap;

// Cheap "is this user allowed to author a recap on at least one team
// anywhere?" check. Mirrors the per-team `canCreateRecap` rules without
// requiring a target team — used by the web client (via /auth/whoami) to
// decide whether to show the "Game Recap" Create-menu item at all.
export async function canAuthorRecapAnywhere(userId: string): Promise<boolean> {
  // Org admins can always author recaps for any team in their org. Plain
  // members (added in task #208) are excluded.
  const [orgAdminRow] = await db
    .select({ userId: organizationAdmins.userId })
    .from(organizationAdmins)
    .where(
      and(
        eq(organizationAdmins.userId, userId),
        inArray(organizationAdmins.role, [...MANAGE_ROLES]),
      ),
    )
    .limit(1);
  if (orgAdminRow) return true;
  // Otherwise: any accepted roster entry where the user is either a coach
  // or holds the explicit "author" position is enough.
  const [rosterRow] = await db
    .select({ id: rosterEntries.id })
    .from(rosterEntries)
    .where(
      and(
        eq(rosterEntries.userId, userId),
        eq(rosterEntries.status, "accepted"),
        or(
          eq(rosterEntries.role, "coach"),
          // Task #559 — `manager` joins `author` as a staff position
          // that can author recaps + approve player/parent highlights.
          inArray(rosterEntries.position, ["author", "manager"]),
        ),
      ),
    )
    .limit(1);
  return Boolean(rosterRow);
}

// Batched "which of these orgs does the viewer have manage rights on?"
// lookup. List endpoints that need to know whether the viewer can edit
// each org's posts (e.g. Updates / org_post canEdit) call this once
// with every org id in the response and check membership per row.
// Returns an empty set for an anonymous viewer.
export async function loadAdminOrgIds(
  viewerId: string | null,
  orgIds: string[],
): Promise<Set<string>> {
  if (!viewerId || orgIds.length === 0) return new Set();
  const unique = Array.from(new Set(orgIds));
  const rows = await db
    .select({ orgId: organizationAdmins.organizationId })
    .from(organizationAdmins)
    .where(
      and(
        eq(organizationAdmins.userId, viewerId),
        inArray(organizationAdmins.organizationId, unique),
        inArray(organizationAdmins.role, [...MANAGE_ROLES]),
      ),
    );
  return new Set(rows.map((r) => r.orgId));
}

// Batched "can the viewer edit this article?" check for list endpoints.
//
// The single-post GET handler computes the same author / co-author /
// org-admin check inline; this helper exists so list endpoints (feed,
// team posts, profile posts, org posts) can answer the same question
// for many articles in two extra queries instead of three per row. A
// null viewerId (anonymous request) always resolves to false.
export async function computeArticleCanEditMap(
  viewerId: string | null,
  rows: Array<{ articleId: string; authorId: string | null; orgId: string }>,
): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>();
  for (const r of rows) result.set(r.articleId, false);
  if (!viewerId || rows.length === 0) return result;

  const articleIds = Array.from(new Set(rows.map((r) => r.articleId)));
  const orgIds = Array.from(new Set(rows.map((r) => r.orgId)));

  const [coAuthorRows, adminRows] = await Promise.all([
    db
      .select({ articleId: articleAuthors.articleId })
      .from(articleAuthors)
      .where(
        and(
          eq(articleAuthors.userId, viewerId),
          inArray(articleAuthors.articleId, articleIds),
        ),
      ),
    db
      .select({ orgId: organizationAdmins.organizationId })
      .from(organizationAdmins)
      .where(
        and(
          eq(organizationAdmins.userId, viewerId),
          inArray(organizationAdmins.organizationId, orgIds),
          inArray(organizationAdmins.role, [...MANAGE_ROLES]),
        ),
      ),
  ]);
  const coAuthorSet = new Set(coAuthorRows.map((r) => r.articleId));
  const adminOrgSet = new Set(adminRows.map((r) => r.orgId));

  for (const r of rows) {
    const isAuthor = r.authorId === viewerId;
    const isCoAuthor = coAuthorSet.has(r.articleId);
    const isOrgAdmin = adminOrgSet.has(r.orgId);
    if (isAuthor || isCoAuthor || isOrgAdmin) {
      result.set(r.articleId, true);
    }
  }
  return result;
}

// Labels surfaced next to a recap author's name. Mirrors the priority order
// used to resolve the strongest team-relevant role the author currently
// holds on the recap's team / parent org. Kept in sync with the
// `PostAuthor.authorRole` enum in the OpenAPI spec.
export type AuthorRoleLabel =
  | "Coach"
  | "Author"
  | "Manager"
  | "Owner"
  | "Admin";

// Batched "what role authorized this person to write the recap?" lookup.
//
// For each row we resolve the author's strongest role in this priority
// order: team coach → "Coach", roster "author" position → "Author",
// organization owner → "Owner", organization admin → "Admin". Anything
// else (incl. plain org members or authors who have since left the team)
// resolves to null and the client falls back to the name-only header.
//
// Only article-backed long-form posts use this; short-form (highlight)
// and org posts do not pass an authorRole at all.
export async function computeArticleAuthorRoleMap(
  rows: Array<{
    articleId: string;
    authorId: string | null;
    teamId: string;
    orgId: string;
  }>,
): Promise<Map<string, AuthorRoleLabel | null>> {
  const result = new Map<string, AuthorRoleLabel | null>();
  for (const r of rows) result.set(r.articleId, null);
  const candidates = rows.filter(
    (
      r,
    ): r is {
      articleId: string;
      authorId: string;
      teamId: string;
      orgId: string;
    } => r.authorId != null,
  );
  if (candidates.length === 0) return result;

  // Dedupe by (teamId, userId) and (orgId, userId) so the same author
  // appearing across multiple recaps on the same team only generates
  // one OR branch.
  const teamUserPairs = new Map<string, { teamId: string; userId: string }>();
  const orgUserPairs = new Map<string, { orgId: string; userId: string }>();
  for (const r of candidates) {
    teamUserPairs.set(`${r.teamId}|${r.authorId}`, {
      teamId: r.teamId,
      userId: r.authorId,
    });
    orgUserPairs.set(`${r.orgId}|${r.authorId}`, {
      orgId: r.orgId,
      userId: r.authorId,
    });
  }

  const teamConds = Array.from(teamUserPairs.values()).map((p) =>
    and(eq(rosterEntries.teamId, p.teamId), eq(rosterEntries.userId, p.userId)),
  );
  const orgConds = Array.from(orgUserPairs.values()).map((p) =>
    and(
      eq(organizationAdmins.organizationId, p.orgId),
      eq(organizationAdmins.userId, p.userId),
    ),
  );

  const [rosterRows, adminRows] = await Promise.all([
    db
      .select({
        teamId: rosterEntries.teamId,
        userId: rosterEntries.userId,
        role: rosterEntries.role,
        position: rosterEntries.position,
      })
      .from(rosterEntries)
      .where(and(eq(rosterEntries.status, "accepted"), or(...teamConds))),
    db
      .select({
        orgId: organizationAdmins.organizationId,
        userId: organizationAdmins.userId,
        role: organizationAdmins.role,
      })
      .from(organizationAdmins)
      .where(or(...orgConds)),
  ]);

  // A single roster entry can carry both a coach role and the explicit
  // "author" position (rare but legal), and a user can have multiple
  // entries on the same team across positions; collapse them per pair.
  const rosterByPair = new Map<
    string,
    { isCoach: boolean; isAuthor: boolean; isManager: boolean }
  >();
  for (const r of rosterRows) {
    const key = `${r.teamId}|${r.userId}`;
    const prev =
      rosterByPair.get(key) ?? {
        isCoach: false,
        isAuthor: false,
        isManager: false,
      };
    if (r.role === "coach") prev.isCoach = true;
    if (r.position === "author") prev.isAuthor = true;
    // Task #559 — team managers are also staff-grade recap authors.
    if (r.position === "manager") prev.isManager = true;
    rosterByPair.set(key, prev);
  }
  // Each (org, user) pair should have at most one row, but if the data
  // ever drifts prefer the strongest role (owner > admin > member).
  const adminByPair = new Map<string, "owner" | "admin" | "member">();
  for (const r of adminRows) {
    const key = `${r.orgId}|${r.userId}`;
    const prev = adminByPair.get(key);
    if (!prev) {
      adminByPair.set(key, r.role);
      continue;
    }
    if (prev !== "owner" && r.role === "owner") {
      adminByPair.set(key, r.role);
    } else if (prev === "member" && r.role === "admin") {
      adminByPair.set(key, r.role);
    }
  }

  for (const r of candidates) {
    const roster = rosterByPair.get(`${r.teamId}|${r.authorId}`);
    if (roster?.isCoach) {
      result.set(r.articleId, "Coach");
      continue;
    }
    if (roster?.isAuthor) {
      result.set(r.articleId, "Author");
      continue;
    }
    if (roster?.isManager) {
      result.set(r.articleId, "Manager");
      continue;
    }
    const admin = adminByPair.get(`${r.orgId}|${r.authorId}`);
    if (admin === "owner") {
      result.set(r.articleId, "Owner");
      continue;
    }
    if (admin === "admin") {
      result.set(r.articleId, "Admin");
      continue;
    }
  }
  return result;
}

export async function isOrgMember(userId: string, organizationId: string): Promise<boolean> {
  // Anyone in organization_admins (owner/admin/member) is a member.
  const [orgRow] = await db
    .select({ userId: organizationAdmins.userId })
    .from(organizationAdmins)
    .where(
      and(
        eq(organizationAdmins.organizationId, organizationId),
        eq(organizationAdmins.userId, userId),
      ),
    )
    .limit(1);
  if (orgRow) return true;
  const [row] = await db
    .select({ id: teams.id })
    .from(teams)
    .innerJoin(rosterEntries, eq(rosterEntries.teamId, teams.id))
    .where(
      and(
        eq(teams.organizationId, organizationId),
        eq(rosterEntries.userId, userId),
        eq(rosterEntries.status, "accepted"),
      ),
    )
    .limit(1);
  return Boolean(row);
}
