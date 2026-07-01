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
