import { inArray } from "drizzle-orm";
import { db, tournaments } from "@workspace/db";
import type { PostCompetitionBrand } from "./spec-helpers";

// Batched competition-branding lookup for post serialization. Recaps
// linked to a competition (articles.competition_id) carry a small brand
// block on the PostResponse so the client can render the competition's
// logo + colors at the top of the card. Extra field beyond the locked
// spec — same precedent as `recapKind`.
export async function loadCompetitionBrandMap(
  competitionIds: Array<string | null | undefined>,
): Promise<Map<string, PostCompetitionBrand>> {
  const ids = Array.from(
    new Set(competitionIds.filter((x): x is string => !!x)),
  );
  const result = new Map<string, PostCompetitionBrand>();
  if (ids.length === 0) return result;
  const rows = await db
    .select({
      id: tournaments.id,
      slug: tournaments.slug,
      name: tournaments.name,
      logoUrl: tournaments.logoUrl,
      brandColor: tournaments.brandColor,
      secondaryColor: tournaments.secondaryColor,
    })
    .from(tournaments)
    .where(inArray(tournaments.id, ids));
  for (const r of rows) {
    result.set(r.id, {
      id: r.id,
      slug: r.slug,
      name: r.name,
      logoUrl: r.logoUrl ?? null,
      brandColor: r.brandColor ?? null,
      secondaryColor: r.secondaryColor ?? null,
    });
  }
  return result;
}
