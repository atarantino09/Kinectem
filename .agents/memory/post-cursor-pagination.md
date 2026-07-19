---
name: Post cursor pagination
description: How /feed and /teams/:id/posts page merged multi-source post lists with an opaque cursor.
---

Both endpoints merge several sources (articles, highlights, org posts, shares) in JS, so SQL LIMIT alone can't page correctly.

**Pattern**: each source query fetches `limit+1` rows with a loose `createdAt <= cursor.ts` SQL filter; after merging, `pagePosts()` (spec-helpers) applies the strict `(effTs, id) < cursor` filter (effTs = sharedAt ?? createdAt), slices the page, and computes `hasMore = anySourceHitFetchCap || filtered > limit`. Never return `hasMore: true` with a null `nextCursor`. Cursor token = base64 `isoTs|postId` (id tiebreak keeps identical-timestamp ties stable).

**Why:** hard-capping at newest N made older recaps look deleted; the locked openapi.yaml already had cursor/limit params, so honoring them was the only allowed fix.

**How to apply:** any new post-list endpoint or new source added to the feed must use fetchCap+cursorCond on its query and route the merged list through `pagePosts()`. Client side: TeamPage/FeedPage use `useInfiniteQuery` with a key extending the generated query key (prefix-matched invalidation from composers still works).

Also: the feed's articles join to organizations must stay a **leftJoin** — innerJoin silently drops all org-less (solo/independent) team recaps. Regression tests: `artifacts/api-server/tests/post-pagination.test.ts`.
