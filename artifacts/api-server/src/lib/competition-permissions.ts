// Task #745 — shared operator-scope checks for competitions + organizer hubs.
//
// Ownership used to be the ONLY grant (sync checks local to tournaments.ts /
// organizers.ts). Multi-admin support widens both:
//   - organizer hub:   owner OR organizer_admins row OR platform admin
//   - competition:     owner OR competition_admins row OR hub-admin of the
//                      competition's organizer (covers later-attached comps
//                      automatically, since it's derived at check time)
// Owner-only actions (delete, admin removal) stay guarded at the route layer
// with explicit owner checks — these helpers answer "can manage", not
// "is owner".

import { db, competitionAdmins, organizerAdmins, competitionOrganizers } from "@workspace/db";
import { and, eq } from "drizzle-orm";

type SessionUserLike = { id: string; role: string };

export async function isOrganizerAdmin(
  userId: string,
  organizerId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ userId: organizerAdmins.userId })
    .from(organizerAdmins)
    .where(
      and(
        eq(organizerAdmins.organizerId, organizerId),
        eq(organizerAdmins.userId, userId),
      ),
    )
    .limit(1);
  return !!row;
}

export async function isCompetitionAdmin(
  userId: string,
  competitionId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ userId: competitionAdmins.userId })
    .from(competitionAdmins)
    .where(
      and(
        eq(competitionAdmins.competitionId, competitionId),
        eq(competitionAdmins.userId, userId),
      ),
    )
    .limit(1);
  return !!row;
}

export async function canOperateOrganizer(
  me: SessionUserLike,
  organizer: { id: string; ownerUserId: string },
): Promise<boolean> {
  if (me.role === "admin") return true;
  if (organizer.ownerUserId === me.id) return true;
  return isOrganizerAdmin(me.id, organizer.id);
}

export async function canOperateCompetition(
  me: SessionUserLike,
  competition: {
    id: string;
    ownerUserId: string | null;
    createdById: string | null;
    organizerId: string | null;
  },
): Promise<boolean> {
  if (me.role === "admin") return true;
  // ownerUserId is backfilled from createdById; fall back for safety.
  const owner = competition.ownerUserId ?? competition.createdById;
  if (owner != null && owner === me.id) return true;
  if (await isCompetitionAdmin(me.id, competition.id)) return true;
  if (competition.organizerId) {
    // A hub's actual owner remains an operator even if a legacy/handed-off
    // hub has no duplicate organizer_admins membership row.
    const [organizer] = await db.select({ ownerUserId: competitionOrganizers.ownerUserId })
      .from(competitionOrganizers).where(eq(competitionOrganizers.id, competition.organizerId)).limit(1);
    if (organizer?.ownerUserId === me.id) return true;
    return isOrganizerAdmin(me.id, competition.organizerId);
  }
  return false;
}
