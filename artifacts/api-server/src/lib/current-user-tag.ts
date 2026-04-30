import {
  db,
  articleTags,
  highlightTags,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import type { CurrentUserTagView } from "./spec-helpers";

// ---------------------------------------------------------------------------
// Current-user tag loader (task #344)
// ---------------------------------------------------------------------------
// Bulk-loads the requesting viewer's own tag row (article or
// highlight) for a list of posts so PostCard can render the
// "Remove me from this post" item in its 3-dot menu without a
// separate round-trip per card. Only `approved` and `pending`
// tags are surfaced — declined / removed rows have no actionable
// affordance and intentionally drop out so the menu item never
// appears for them.
//
// The returned maps are keyed by article / highlight id and only
// contain entries the viewer is actually tagged on. Empty maps
// for unauthenticated viewers and for empty input lists keep call
// sites simple — they always do a `.get(id) ?? null` lookup.
export async function loadCurrentUserTags(
  viewerId: string | null,
  refs: { articleIds: string[]; highlightIds: string[] },
): Promise<{
  articleTagByArticleId: Map<string, CurrentUserTagView>;
  highlightTagByHighlightId: Map<string, CurrentUserTagView>;
}> {
  const articleTagByArticleId = new Map<string, CurrentUserTagView>();
  const highlightTagByHighlightId = new Map<string, CurrentUserTagView>();
  if (!viewerId) {
    return { articleTagByArticleId, highlightTagByHighlightId };
  }

  const articleIds = Array.from(new Set(refs.articleIds));
  const highlightIds = Array.from(new Set(refs.highlightIds));

  if (articleIds.length > 0) {
    const aRows = await db
      .select({
        id: articleTags.id,
        articleId: articleTags.articleId,
        status: articleTags.status,
      })
      .from(articleTags)
      .where(
        and(
          eq(articleTags.userId, viewerId),
          inArray(articleTags.articleId, articleIds),
          inArray(articleTags.status, ["approved", "pending"] as const),
        ),
      );
    for (const r of aRows) {
      articleTagByArticleId.set(r.articleId, {
        id: r.id,
        kind: "article",
        status: r.status as "approved" | "pending",
      });
    }
  }

  if (highlightIds.length > 0) {
    const hRows = await db
      .select({
        id: highlightTags.id,
        highlightId: highlightTags.highlightId,
        status: highlightTags.status,
      })
      .from(highlightTags)
      .where(
        and(
          eq(highlightTags.userId, viewerId),
          inArray(highlightTags.highlightId, highlightIds),
          inArray(highlightTags.status, ["approved", "pending"] as const),
        ),
      );
    for (const r of hRows) {
      highlightTagByHighlightId.set(r.highlightId, {
        id: r.id,
        kind: "highlight",
        status: r.status as "approved" | "pending",
      });
    }
  }

  return { articleTagByArticleId, highlightTagByHighlightId };
}
