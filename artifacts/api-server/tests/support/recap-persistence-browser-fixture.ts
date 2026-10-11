// Dev-only, explicit browser-test fixtures. Never run on startup or deploy.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool, users, organizations, organizationAdmins, teams, rosterEntries, articles, recapCreationRequests } from "@workspace/db";

const mode = process.argv[2];
if (mode === "create") {
  const [owner] = await db.select().from(users).where(eq(users.email, "coach@kinectem.demo"));
  if (!owner) throw new Error("Demo coach required");
  const result = await db.transaction(async (tx) => {
    const [org] = await tx.insert(organizations).values({ name: `Recap browser verification ${randomUUID()}` }).returning();
    await tx.insert(organizationAdmins).values({ organizationId: org.id, userId: owner.id, role: "owner" });
    const [team] = await tx.insert(teams).values({ organizationId: org.id, name: "Recap verification team" }).returning();
    await tx.insert(rosterEntries).values({ teamId: team.id, userId: owner.id, role: "coach", status: "accepted" });
    return { teamId: team.id, orgId: org.id };
  });
  console.log(JSON.stringify(result));
} else if (mode === "cleanup") {
  const orgId = process.argv[3];
  if (!orgId) throw new Error("Fixture org ID required");
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
  if (!org?.name.startsWith("Recap browser verification ")) throw new Error("Not a recap browser fixture");
  await db.transaction(async (tx) => {
    for (const team of await tx.select().from(teams).where(eq(teams.organizationId, orgId))) {
      for (const article of await tx.select().from(articles).where(eq(articles.teamId, team.id))) {
        await tx.delete(recapCreationRequests).where(eq(recapCreationRequests.articleId, article.id));
        await tx.delete(articles).where(eq(articles.id, article.id));
      }
      await tx.delete(rosterEntries).where(eq(rosterEntries.teamId, team.id));
      await tx.delete(teams).where(eq(teams.id, team.id));
    }
    await tx.delete(organizationAdmins).where(eq(organizationAdmins.organizationId, orgId));
    await tx.delete(organizations).where(eq(organizations.id, orgId));
  });
  console.log("Recap browser fixture removed");
} else {
  throw new Error("Expected create or cleanup <orgId>");
}
await pool.end();
