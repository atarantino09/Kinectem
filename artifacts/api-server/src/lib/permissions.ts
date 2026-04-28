import {
  db,
  articleAuthors,
  organizationAdmins,
  rosterEntries,
  teams,
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

export async function canCreateRecap(
  userId: string,
  team: Team,
): Promise<boolean> {
  // Org admins and team coaches can always author recaps.
  if (await canManageTeam(userId, team)) return true;
  // Parents/members granted the explicit "author" position can also author.
  const [authorEntry] = await db
    .select()
    .from(rosterEntries)
    .where(
      and(
        eq(rosterEntries.teamId, team.id),
        eq(rosterEntries.userId, userId),
        eq(rosterEntries.status, "accepted"),
        eq(rosterEntries.position, "author"),
      ),
    )
    .limit(1);
  return Boolean(authorEntry);
}

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
          eq(rosterEntries.position, "author"),
        ),
      ),
    )
    .limit(1);
  return Boolean(rosterRow);
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
