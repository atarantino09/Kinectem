import { db, familyContacts, rosterEntries } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";

type Db = typeof db;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type DbOrTx = Db | Tx;

export async function isActiveFamilyContact(
  userId: string,
  childId: string,
  dbx: DbOrTx = db,
): Promise<boolean> {
  const [row] = await dbx
    .select({ id: familyContacts.id })
    .from(familyContacts)
    .where(
      and(
        eq(familyContacts.invitedUserId, userId),
        eq(familyContacts.childId, childId),
        eq(familyContacts.status, "active"),
      ),
    )
    .limit(1);
  return !!row;
}

export async function getActiveFamilyContactIdsForChild(
  childId: string,
  dbx: DbOrTx = db,
): Promise<string[]> {
  const rows = await dbx
    .select({ userId: familyContacts.invitedUserId })
    .from(familyContacts)
    .where(
      and(
        eq(familyContacts.childId, childId),
        eq(familyContacts.status, "active"),
      ),
    );
  return rows
    .map((row) => row.userId)
    .filter((userId): userId is string => !!userId);
}

export async function getActiveFamilyContactIdsForChildren(
  childIds: ReadonlyArray<string>,
  dbx: DbOrTx = db,
): Promise<Map<string, string[]>> {
  const ids = Array.from(new Set(childIds));
  const result = new Map<string, string[]>();
  if (!ids.length) return result;
  const rows = await dbx
    .select({
      childId: familyContacts.childId,
      userId: familyContacts.invitedUserId,
    })
    .from(familyContacts)
    .where(
      and(
        inArray(familyContacts.childId, ids),
        eq(familyContacts.status, "active"),
      ),
    );
  for (const row of rows) {
    if (!row.userId) continue;
    const list = result.get(row.childId) ?? [];
    list.push(row.userId);
    result.set(row.childId, list);
  }
  return result;
}

// The audience for a team's published activity is limited to contacts of
// children with an accepted roster spot on that specific team.
export async function getActiveFamilyContactIdsForTeam(teamId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: familyContacts.invitedUserId })
    .from(rosterEntries)
    .innerJoin(familyContacts, eq(familyContacts.childId, rosterEntries.userId))
    .where(and(
      eq(rosterEntries.teamId, teamId),
      eq(rosterEntries.status, "accepted"),
      eq(familyContacts.status, "active"),
    ));
  return Array.from(new Set(rows.map((r) => r.userId).filter((id): id is string => !!id)));
}