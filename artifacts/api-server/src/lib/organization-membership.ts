import { db, guardianLinks, organizationAdmins, organizations, rosterEntries, teams } from "@workspace/db";
import { and, eq } from "drizzle-orm";

type Membership = {
  org: typeof organizations.$inferSelect;
  role: "owner" | "admin" | "member";
};

// Following is a feed preference, not membership. These read-only associations
// must not be used to grant organization management or posting permissions.
export async function listUserOrganizationMemberships(
  userId: string,
  organizationId?: string,
): Promise<Membership[]> {
  const orgFilter = organizationId ? eq(organizations.id, organizationId) : undefined;
  const [direct, roster, family] = await Promise.all([
    db.select({ org: organizations, role: organizationAdmins.role })
      .from(organizationAdmins)
      .innerJoin(organizations, eq(organizationAdmins.organizationId, organizations.id))
      .where(and(eq(organizationAdmins.userId, userId), orgFilter)),
    db.selectDistinct({ org: organizations })
      .from(rosterEntries)
      .innerJoin(teams, eq(rosterEntries.teamId, teams.id))
      .innerJoin(organizations, eq(teams.organizationId, organizations.id))
      .where(and(eq(rosterEntries.userId, userId), eq(rosterEntries.status, "accepted"), orgFilter)),
    db.selectDistinct({ org: organizations })
      .from(guardianLinks)
      .innerJoin(rosterEntries, eq(guardianLinks.childId, rosterEntries.userId))
      .innerJoin(teams, eq(rosterEntries.teamId, teams.id))
      .innerJoin(organizations, eq(teams.organizationId, organizations.id))
      .where(and(
        eq(guardianLinks.guardianId, userId),
        eq(guardianLinks.status, "active"),
        eq(rosterEntries.status, "accepted"),
        orgFilter,
      )),
  ]);
  const result = new Map<string, Membership>();
  for (const row of direct) result.set(row.org.id, row);
  for (const row of [...roster, ...family]) {
    if (!result.has(row.org.id)) result.set(row.org.id, { ...row, role: "member" });
  }
  return [...result.values()];
}
