import { db, highlightTags, users } from "@workspace/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { displayName } from "./spec-helpers";
import type { PostTaggedUserView } from "./spec-helpers";

// ---------------------------------------------------------------------------
// Highlight tag views (task #318)
// ---------------------------------------------------------------------------
// Loads the visible tagged-user list for one or more highlights, in
// the order tags were created. Approved tags are always included;
// pending tags are only included for the post's uploader (the
// "author") and the tagged player themselves — matching the recap
// pending-tag visibility rule. Declined / removed rows are filtered
// out by the status IN (...) clause and never reappear.
//
// Callers pass the highlights they care about with their
// `uploaderId`s so we can apply the per-row visibility check without
// a second round-trip. The returned map is keyed by highlight id;
// highlights with no visible tags get an empty array (still present
// in the map) so the caller can treat "loaded with no tags" the same
// as "loaded with N tags" downstream.
export async function loadHighlightTagViews(
  viewerId: string | null,
  highlights: { id: string; uploaderId: string | null }[],
): Promise<Map<string, PostTaggedUserView[]>> {
  const result = new Map<string, PostTaggedUserView[]>();
  for (const h of highlights) result.set(h.id, []);
  if (highlights.length === 0) return result;
  const ids = highlights.map((h) => h.id);
  const uploaderById = new Map(highlights.map((h) => [h.id, h.uploaderId]));

  const rows = await db
    .select({
      highlightId: highlightTags.highlightId,
      userId: highlightTags.userId,
      status: highlightTags.status,
      createdAt: highlightTags.createdAt,
      user: users,
    })
    .from(highlightTags)
    .innerJoin(users, eq(highlightTags.userId, users.id))
    .where(
      and(
        inArray(highlightTags.highlightId, ids),
        inArray(highlightTags.status, ["approved", "pending"] as const),
      ),
    )
    .orderBy(asc(highlightTags.createdAt));

  for (const r of rows) {
    if (r.status === "pending") {
      const uploaderId = uploaderById.get(r.highlightId) ?? null;
      const isAuthor = !!viewerId && uploaderId === viewerId;
      const isSelf = !!viewerId && r.userId === viewerId;
      if (!isAuthor && !isSelf) continue;
    }
    const arr = result.get(r.highlightId);
    if (!arr) continue;
    arr.push({
      id: r.userId,
      displayName: displayName(r.user),
      avatarUrl: r.user.avatarUrl ?? null,
      tagStatus: r.status as "approved" | "pending",
    });
  }
  return result;
}
