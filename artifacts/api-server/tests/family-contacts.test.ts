import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, familyContacts, rosterEntries, teams, users } from "@workspace/db";
import { loginAs } from "./helpers";
import { resolveTeamScheduleRecipientUserIds } from "../src/lib/schedule-notifications";

describe("updates-only family contacts", () => {
  const created: string[] = [];
  const createdRoster: string[] = [];
  const createdTeams: string[] = [];
  afterEach(async () => {
    for (const id of createdRoster.splice(0)) {
      await db.delete(rosterEntries).where(eq(rosterEntries.id, id));
    }
    for (const id of created.splice(0)) {
      await db.delete(familyContacts).where(eq(familyContacts.id, id));
    }
    for (const id of createdTeams.splice(0)) {
      await db.delete(teams).where(eq(teams.id, id));
    }
  });

  it("requires the invited email, grants read-only access after acceptance, and revokes it", async () => {
    const [child] = await db.select().from(users).where(eq(users.email, "samira@kinectem.demo")).limit(1);
    const [parent] = await db.select().from(users).where(eq(users.email, "lisa@kinectem.demo")).limit(1);
    expect(child && parent).toBeTruthy();
    const { agent: lisa } = await loginAs(parent!.id);
    const { agent: marcus, user: contactUser } = await loginAs("marcus@kinectem.demo");
    const [team] = await db.insert(teams).values({ name: "Family contact access test" }).returning({ id: teams.id });
    createdTeams.push(team!.id);
    const [roster] = await db.insert(rosterEntries).values({
      teamId: team!.id, userId: child!.id, role: "player", status: "accepted",
    }).returning();
    createdRoster.push(roster!.id);

    const [invite] = await db.insert(familyContacts).values({
      childId: child!.id,
      invitedByGuardianId: parent!.id,
      inviteEmail: "marcus@kinectem.demo",
      firstName: "Marcus",
      lastName: "Contact",
    }).returning();
    created.push(invite!.id);

    expect((await lisa.post(`/api/v1/family-contacts/${invite!.id}/accept`)).status).toBe(404);
    expect((await marcus.get(`/api/v1/teams/${roster!.teamId}/schedule`)).status).toBe(403);
    expect((await marcus.post(`/api/v1/family-contacts/${invite!.id}/accept`)).status).toBe(200);

    const profile = await marcus.get(`/api/v1/users/${child!.id}`);
    expect(profile.status).toBe(200);
    expect(profile.body.email).toBeUndefined();
    expect((await marcus.get(`/api/v1/users/${child!.id}/posts`)).status).toBe(200);
    expect((await marcus.get(`/api/v1/teams/${roster!.teamId}/schedule`)).status).toBe(200);
    expect(await resolveTeamScheduleRecipientUserIds(roster!.teamId)).toContain(contactUser.id);
    expect((await marcus.get(`/api/v1/teams/${roster!.teamId}/practice-plans`)).status).toBe(404);

    expect((await lisa.delete(`/api/v1/family-contacts/${invite!.id}`)).status).toBe(204);
    expect((await marcus.get(`/api/v1/teams/${roster!.teamId}/schedule`)).status).toBe(403);
    expect(await resolveTeamScheduleRecipientUserIds(roster!.teamId)).not.toContain(contactUser.id);
  });
});