---
name: Inline image upload body limit
description: Why team-banner / org-logo PATCH uploads need a dedicated high-limit JSON parser separate from the tight global express.json limit.
---

# Inline image uploads vs the global JSON body limit

Team banners and org logos are sent to the API **inline as base64 `data:` URLs in the JSON PATCH body** (unlike avatars, which use the 3-step asset-upload pipeline and arrive as `http(s)` URLs). A realistic banner base64 easily exceeds the global `express.json({ limit: "1mb" })` cap in `app.ts`, so the parser 413s before the route ever runs — the upload "silently fails".

**Fix pattern:** keep the global JSON limit tight (security S7) and register a dedicated higher-limit `express.json` parser scoped to just the image-bearing PATCH routes (`/api/v1/teams/:teamId`, `/api/v1/organizations/:orgId`, `/api/v1/users/:userId`, `/api/v1/admin/users/:userId`) **BEFORE** the global parser. body-parser sets `req._body` after the first parse, so the global parser then no-ops for those requests.

**Why:** bumping the global limit to 20 MB would widen the DoS surface for every route; only a few routes legitimately carry large text bodies.

**Contract to keep in lockstep (three places):**
- client `DATA_URL_MAX_LENGTH` in `kinectem/src/lib/shrinkImage.ts` (20 MB encoded)
- server `MAX_IMAGE_DATA_URL_LENGTH` in `api-server/src/lib/spec-helpers.ts` (20 MB) — used for the per-route friendly 413 check
- the dedicated parser limit in `app.ts` must sit *just above* the cap (21 MB) so an over-cap value reaches the route and gets the friendly `apiError(res, 413, ...)` (`PAYLOAD_TOO_LARGE`) instead of a raw parser failure.

Avatars are a **separate, smaller** cap: `MAX_AVATAR_DATA_URL_LENGTH` (512 KB) is an *egress* limit (`safeAvatarUrl` drops larger data URLs from list responses) and stays a 400, not 413 — don't conflate it with the 20 MB image cap.

**Recap photos are the same class of bug.** The recap composer inlines photos as base64 `data:` URLs in `POST /api/v1/posts` and `PATCH /api/v1/posts/:postId` (fields `photoUrls` + `coverImageUrl`, plus `thumbnailUrl` on highlights). Same fix: a dedicated `postImageUploadJson = express.json({ limit: "25mb" })` scoped to those two routes before the global parser, and a `checkPostImagePayload(coverImageUrl, photoUrls)` helper (`spec-helpers.ts`) that friendly-413s when any single image > 20 MB (`MAX_IMAGE_DATA_URL_LENGTH`) OR the aggregate > 24 MB (`MAX_POST_IMAGES_TOTAL_LENGTH`).

**Multi-photo needs an AGGREGATE cap, not just per-image.** Because a recap carries several photos, the parser limit must sit above the *aggregate* cap, and the aggregate cap must sit above the per-image cap: per-image 20 MB < aggregate 24 MB < parser 25 MB. The client mirrors the aggregate cap as `POST_IMAGES_TOTAL_MAX_LENGTH` (24 MB) in `shrinkImage.ts` so a compliant client never trips the raw parser 413. Test gotcha: to exercise the *friendly* 413 (not the parser's), the request body total must stay under 25 MB while exceeding a route cap — don't duplicate a huge string across both `coverImageUrl` and `photoUrls` or you overflow the parser and get the opaque error instead.

Response shape note: created/edited post photos come back in the `assets[]` array (`{ url, fileType, displayOrder }`), NOT as a top-level `coverImageUrl` — assert on `assets` in tests. Org-post CREATE (`POST /organizations/:orgId/posts`) is a *separate* route still on the 1 MB global limit — out of scope for the recap fix; org-post *edits* route through `PATCH /posts/:postId` so they're covered.

**`coverImageUrl` is derived, not client-authored — do not send it AND `photoUrls[0]`.** The server sets `coverImageUrl = body.coverImageUrl ?? photoUrls[0]` on create and patch, and display reads `photoUrls[0]` first (cover is only a fallback when `photoUrls` is empty). So the client must send ONLY `photoUrls`; sending `coverImageUrl: photos[0]` too physically duplicates the (large base64) first photo on the wire, so a recap whose *unique* photos are within the aggregate cap can still overflow the request-body parser. Two consequences that must both hold: (1) the client stops duplicating the cover, and (2) `checkPostImagePayload` de-dups URLs (a `Set`) before summing, so a cover that merely repeats a photo isn't counted twice against the aggregate cap. Miss either and size-compliant multi-photo recaps get spurious 413s. Test gotcha: identical `data:` strings collapse under the `Set`, so an aggregate-overflow test needs *distinct* strings, while a dedup test intentionally passes the *same* string as cover and photo.
