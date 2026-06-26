// Broadcast audience enumeration (bulk messaging fan-out).
//
// Resolves the deduped recipient set for an org- or team-scoped broadcast.
// A team's audience is its accepted coaches + accepted players + the parents
// of those players. Minors are NOT excluded — they receive a read-only copy
// (a `player` recipient row) alongside their parents; only `parent` rows may
// reply, which the route enforces.
//
// A user can match multiple roles (e.g. a coach who is also a parent, or a
// parent of two players). We dedupe by userId, keeping the strongest role
// (coach > player > parent) so a single delivered row is unambiguous. `childUserId`
// links a `parent` row back to the player it covers (NULL for coach/player).

import { db, rosterEntries, teams, users } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";

export type BroadcastRecipientRole = "coach" | "player" | "parent";

export interface BroadcastRecipient {
  userId: string;
  recipientRole: BroadcastRecipientRole;
  childUserId: string | null;
}

const ROLE_RANK: Record<BroadcastRecipientRole, number> = {
  coach: 3,
  player: 2,
  parent: 1,
};

// Merge a candidate recipient into the map, keeping the strongest role.
function upsert(
  map: Map<string, BroadcastRecipient>,
  userId: string,
  role: BroadcastRecipientRole,
  childUserId: string | null,
): void {
  const existing = map.get(userId);
  if (!existing) {
    map.set(userId, { userId, recipientRole: role, childUserId });
    return;
  }
  if (ROLE_RANK[role] > ROLE_RANK[existing.recipientRole]) {
    // Promote to the stronger role. A coach/player row carries no child link.
    map.set(userId, {
      userId,
      recipientRole: role,
      childUserId: role === "parent" ? childUserId : null,
    });
  }
}

// Resolve the recipient set across an arbitrary list of team ids (used by both
// the team- and org-scoped enumerators), deduped across all of them.
async function enumerateForTeams(teamIds: string[]): Promise<BroadcastRecipient[]> {
  const map = new Map<string, BroadcastRecipient>();
  if (teamIds.length === 0) return [];

  const roster = await db
    .select({ userId: rosterEntries.userId, role: rosterEntries.role })
    .from(rosterEntries)
    .where(
      and(
        inArray(rosterEntries.teamId, teamIds),
        eq(rosterEntries.status, "accepted"),
      ),
    );
  if (roster.length === 0) return [];

  // Coaches first (strongest role); collect player ids for the parent lookup.
  const playerIds = new Set<string>();
  for (const r of roster) {
    if (r.role === "coach") {
      upsert(map, r.userId, "coach", null);
    } else {
      upsert(map, r.userId, "player", null);
      playerIds.add(r.userId);
    }
  }

  // Parents of accepted players. A player with a linked guardian fans the
  // broadcast out to that guardian too (COPPA: minors' parents are always
  // in the loop; for 13+ the parent is included alongside the player).
  if (playerIds.size > 0) {
    const players = await db
      .select({ id: users.id, parentId: users.parentId })
      .from(users)
      .where(inArray(users.id, Array.from(playerIds)));
    for (const p of players) {
      if (p.parentId) upsert(map, p.parentId, "parent", p.id);
    }
  }

  return Array.from(map.values());
}

// Team-scoped broadcast audience: this team's coaches + accepted players +
// their parents.
export async function enumerateTeamAudience(
  teamId: string,
): Promise<BroadcastRecipient[]> {
  return enumerateForTeams([teamId]);
}

// Org-scoped broadcast audience: every team in the org, unioned + deduped.
export async function enumerateOrgAudience(
  organizationId: string,
): Promise<BroadcastRecipient[]> {
  const orgTeams = await db
    .select({ id: teams.id })
    .from(teams)
    .where(eq(teams.organizationId, organizationId));
  return enumerateForTeams(orgTeams.map((t) => t.id));
}
