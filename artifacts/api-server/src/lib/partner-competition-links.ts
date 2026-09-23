import { db, partnerLandingPages, tournaments } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function mergedPartnerCompetitionIds(
  page: Pick<
    typeof partnerLandingPages.$inferSelect,
    "competitionId" | "competitionIds"
  >,
): string[] {
  return [
    ...new Set(
      [...page.competitionIds, page.competitionId].filter(
        (id): id is string => !!id,
      ),
    ),
  ];
}

/**
 * Serializes every relationship writer for one partnership page and coordinates
 * with competition deletion. Competition locks are acquired before the row
 * lock so deletion can never wait on a writer that is waiting on deletion.
 */
export async function lockPartnerCompetitionLinks(
  tx: Transaction,
  pageId: string,
  extraCompetitionIds: string[] = [],
) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`partner-page-links:${pageId}`}))`,
  );

  const [snapshot] = await tx
    .select({
      competitionId: partnerLandingPages.competitionId,
      competitionIds: partnerLandingPages.competitionIds,
    })
    .from(partnerLandingPages)
    .where(eq(partnerLandingPages.id, pageId))
    .limit(1);
  if (!snapshot) return null;

  const lockIds = [
    ...new Set([
      ...mergedPartnerCompetitionIds(snapshot),
      ...extraCompetitionIds,
    ]),
  ].sort();
  for (const competitionId of lockIds) {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`competition-clear:${competitionId}`}))`,
    );
  }

  await tx.execute(
    sql`SELECT id FROM partner_landing_pages WHERE id = ${pageId} FOR UPDATE`,
  );
  const [page] = await tx
    .select()
    .from(partnerLandingPages)
    .where(eq(partnerLandingPages.id, pageId))
    .limit(1);
  if (!page) return null;

  const storedIds = mergedPartnerCompetitionIds(page);
  const liveRows = storedIds.length
    ? await tx
        .select({ id: tournaments.id })
        .from(tournaments)
        .where(inArray(tournaments.id, storedIds))
    : [];
  const liveSet = new Set(liveRows.map((row) => row.id));

  return {
    page,
    liveCompetitionIds: storedIds.filter((id) => liveSet.has(id)),
  };
}