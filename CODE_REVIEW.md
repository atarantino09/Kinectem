# Kinectem — Full Code Review

**Date:** June 22, 2026
**Focus:** UX speed & security
**Scope:** `artifacts/api-server` (Express/Drizzle/Postgres), `artifacts/kinectem` (React/Vite), shared libs, and the marketing/portal artifacts at a high level.
**Method:** Static analysis of routes, middleware, schema, and frontend components. The highest-severity items below were read and confirmed directly in source.

---

## Executive summary

Overall the codebase is well-structured and security-aware: parameterized queries everywhere (Drizzle), scrypt password hashing with `timingSafeEqual`, hashed refresh tokens / API keys, AES-256-GCM encryption of AI keys, a thorough and consistently-applied COPPA layer, and good frontend fundamentals (route code-splitting, sensible query caching, optimistic updates).

The biggest gaps are **cross-origin/CSRF exposure**, **missing security headers**, a couple of **authorization/escaping gaps**, and on the speed side **no list virtualization or server-side pagination** plus a handful of **missing DB indexes and N+1 queries**.

| Severity | Security | Performance |
|---|---|---|
| High | 2 | 1 (frontend lists) |
| Medium | 7 | 4 |
| Low | 5 | 2 |

**Top 5 things to fix first**
1. Lock down CORS to known origins and switch session cookie to `SameSite=Lax` (+ add CSRF defense).
2. Add `helmet` for security headers (CSP, HSTS, X-Frame-Options, nosniff).
3. Add an ownership/authorization check to `GET /assets/:assetId`.
4. Add missing DB indexes (`notifications.user_id`, `post_shares.sharer_user_id`, article/highlight FKs).
5. Virtualize the feed/roster lists and add server-side pagination.

---

## Security findings

### S1 — [HIGH] Permissive CORS + cross-site cookies = CSRF & data exfiltration
- **Where:** `artifacts/api-server/src/app.ts:27` (`cors({ origin: true, credentials: true })`); `artifacts/api-server/src/lib/auth.ts:47,58` (`sameSite: secure ? "none" : "lax"`).
- **Issue:** `origin: true` reflects *any* requesting origin and allows credentials, while the session cookie is `SameSite=None` in production. Together, any malicious website can make authenticated requests on a logged-in user's behalf **and read the responses**. The frontend and API are same-origin through the Replit path-routing proxy, so neither setting is necessary.
- **Fix:**
  - Set CORS `origin` to an explicit allowlist (your `$REPLIT_DOMAINS` / `www.kinectem.com`), keep `credentials: true` only for those.
  - Change the session cookie to `SameSite=Lax` (works fine same-origin through the proxy).
  - Add CSRF protection for cookie-authenticated state-changing routes (double-submit token or required custom header). Bearer/API-key clients are unaffected.

### S2 — [HIGH] No CSRF tokens for cookie-based mutations
- **Where:** `app.ts` (no CSRF middleware).
- **Issue:** State-changing endpoints accept the session cookie with no anti-CSRF check. Currently mitigated only by `SameSite` — and that's weakened by S1.
- **Fix:** Once S1's `SameSite=Lax` is in place, add a CSRF token (or require an `X-Requested-With`/custom header that simple cross-site form posts can't set) on POST/PUT/PATCH/DELETE.

### S3 — [MEDIUM] Missing security headers (no `helmet`)
- **Where:** `app.ts` (helmet not installed/used).
- **Issue:** No `Content-Security-Policy`, `X-Frame-Options`/`frame-ancestors`, `Strict-Transport-Security`, or `X-Content-Type-Options`. The standalone founding-admin HTML page (`routes/founding-admin-page.ts`) is especially exposed to clickjacking.
- **Fix:** Add `helmet()` with a sensible CSP. At minimum set `X-Frame-Options: DENY` (or `frame-ancestors 'none'`) on the admin page, plus HSTS and nosniff globally.

### S4 — [MEDIUM] IDOR on asset read
- **Where:** `artifacts/api-server/src/routes/assets.ts:169-182` (`GET /assets/:assetId`).
- **Issue:** Only checks that the caller is authenticated — **not** that they own or may view the asset. The response includes the asset `url` (base64 data). `DELETE` on the same resource correctly checks `a.ownerId !== me.id` (line 195); the read path does not. Concerning for minors' assets in particular. Mitigated somewhat by UUID unguessability, but IDs can leak through other responses.
- **Fix:** Authorize the read: owner, linked guardian, shared-team/visibility context, or platform admin — mirror the COPPA visibility rules used elsewhere.

### S5 — [MEDIUM] HTML/link injection in org-invite emails
- **Where:** `artifacts/api-server/src/lib/email.ts:147-164` (`sendOrganizationInviteEmail`).
- **Issue:** `note` and `inviterDisplayName` are interpolated into the HTML email without HTML-escaping (`note` only does `\n`→`<br/>`). An inviter can inject markup/links — a phishing vector in the message recipients trust.
- **Fix:** HTML-escape all user-supplied values before interpolation (escape first, *then* convert newlines). Audit other templated emails for the same pattern.

### S6 — [MEDIUM] In-memory rate limiting won't survive Autoscale
- **Where:** `artifacts/api-server/src/middlewares/rate-limit.ts` (module-level `Map`); used by `signupLimiter`, `loginLimiter`, `foundingSignupLimiter`.
- **Issue:** State is per-process, so limits reset on restart and are trivially bypassed across multiple instances (round-robin). Login/signup/founding-signup abuse protections are weakened in production.
- **Fix:** Move to a shared store (Postgres table or Redis). This is already captured as item 4 of paused **Task #505**.

### S7 — [MEDIUM] Oversized global JSON body limit
- **Where:** `app.ts:28` (`express.json({ limit: "25mb" })`).
- **Issue:** 25 MB applies to *every* endpoint, including unauthenticated ones — a cheap memory-exhaustion/DoS lever.
- **Fix:** Lower the global default (e.g. 1 MB) and raise the limit only on the specific asset-upload route(s) that need it.

### S8 — [MEDIUM] Weak `SESSION_SECRET` validation
- **Where:** `artifacts/api-server/src/lib/tokens.ts:28` (`s.length < 8`).
- **Issue:** An 8-character secret is too weak for HMAC-SHA256 token signing (and it doubles as the AI-key encryption fallback — see S9).
- **Fix:** Require ≥32 chars / high entropy and fail fast at boot in production.

### S9 — [MEDIUM] AI-key encryption silently falls back to `SESSION_SECRET`
- **Where:** `artifacts/api-server/src/lib/secret-crypto.ts:22-24`.
- **Issue:** Encryption key derives from `AI_KEYS_ENCRYPTION_KEY` *or* `SESSION_SECRET`. Rotating the session secret (a normal security action) permanently bricks already-encrypted AI keys, and a weak session secret weakens the encryption.
- **Fix:** Require a dedicated `AI_KEYS_ENCRYPTION_KEY` in production; don't silently fall back. Document key-rotation/re-encryption.

### S10 — [LOW] Guardian-confirm resend returns the raw token
- **Where:** `artifacts/api-server/src/routes/guardians.ts` (`resend-guardian-confirm`, ~line 210).
- **Issue:** Returns the raw confirmation token in the API response, undermining the "secret delivered only by email" model. (The parent-driven recovery endpoint correctly returns a generic `{ ok: true }`.)
- **Fix:** Never return the raw token; deliver via email only.

### S11 — [LOW] No global request validation
- **Where:** `app.ts` (no `express-openapi-validator`); many handlers cast manually, e.g. `parseInt(...)` in `routes/admin.ts:326`.
- **Issue:** Validation is per-route Zod only; new routes can ship with unvalidated query/body params.
- **Fix:** Mount `express-openapi-validator` against `openapi.yaml`, or standardize a shared Zod query/body parser used by every route.

### S12 — [LOW] PII in logs on email failure
- **Where:** `artifacts/api-server/src/lib/email.ts:98`.
- **Issue:** Full SendGrid error body (may contain recipient address) is logged. (`pino` already redacts `Authorization`/`Cookie`.)
- **Fix:** Log status code + message only; avoid logging recipient addresses/bodies.

### S13 — [LOW] Upload content-type is trusted, not sniffed
- **Where:** `artifacts/api-server/src/routes/assets.ts` (uses client `fileType`).
- **Issue:** No verification that bytes match the declared MIME. Safe when rendered in `<img>`, but risky if a data URL is ever used in `<a>`/`<iframe>`. (Minors' uploads are already restricted to JPEG/PNG and EXIF-stripped — good.)
- **Fix:** Validate magic bytes against the declared type; reject mismatches.

### S14 — [LOW] Best-effort `apiKey.lastUsedAt` update is fire-and-forget
- **Where:** `artifacts/api-server/src/middlewares/auth.ts:106-112`.
- **Issue:** Update is not awaited and errors are swallowed — minor audit-accuracy gap under load. Informational.

---

## UX speed / performance findings

### Frontend (`artifacts/kinectem`)

#### F1 — [HIGH impact] No list virtualization
- **Where:** `pages/FeedPage.tsx:190`, `pages/TeamPage.tsx:223`, `components/TeamRosterTabs.tsx`.
- **Issue:** Feeds and rosters map over the full array; DOM nodes grow linearly with data → janky scroll and high memory, worst on mobile.
- **Fix:** Add windowing (`@tanstack/react-virtual`) and pair with infinite scroll / cursor pagination.

#### F2 — [MEDIUM] List endpoints fetch everything (no server pagination)
- **Where:** `GET /notifications`, `GET /follow-requests`, `GET /teams/:teamId/members`, `GET /organizations/:orgId/teams` (see B-section for files).
- **Issue:** Whole result sets are returned and sliced client-side, inflating payloads and time-to-interactive.
- **Fix:** Add cursor/limit pagination server-side; consume with `useInfiniteQuery`.

#### F3 — [MEDIUM] Images lack lazy-loading & dimensions
- **Where:** `components/UserAvatar.tsx`, `components/OrgLogoFallback.tsx`, post image renders.
- **Issue:** No `loading="lazy"` / `decoding="async"` and no width/height → eager fetches and layout shift. (`shrinkImage.ts` resizes on upload — good — but render still uses originals.)
- **Fix:** Add `loading="lazy"`, `decoding="async"`, explicit dimensions/aspect-ratio; consider responsive `srcset`.

#### F4 — [LOW–MED] Minimal memoization
- **Where:** `components/PostCard.tsx` and other row components (no `React.memo`).
- **Issue:** Heavy rows re-render whenever the parent list changes. Compounds with F1.
- **Fix:** `React.memo` row components with stable callbacks (`useCallback`); especially valuable once virtualization lands.

#### F5 — [LOW] Whole-layout re-render on `currentUser`/`unreadCount`
- **Where:** `components/Layout.tsx`.
- **Fix:** Split frequently-changing values (e.g. unread count) into a narrower context/selector. Low priority — pages are behind their own route boundaries.

**Strengths to keep:** route-level `React.lazy` + `Suspense` (`App.tsx:12-47`), `staleTime: 30s` + `refetchOnWindowFocus: false` (`App.tsx:49-56`), optimistic share updates (`PostCard.tsx`).

### Backend (`artifacts/api-server`)

#### B1 — [MEDIUM] N+1: per-team member count
- **Where:** `routes/organizations.ts:601-609` and `:639-647` (`GET /organizations/:orgId/teams[/archived]`).
- **Issue:** One `count(*)` query per team.
- **Fix:** Single grouped query (`group by team_id`) joined into the team list — one round trip.

#### B2 — [MEDIUM] N+1: admin activity target hydration
- **Where:** `routes/admin.ts:1123-1135` (`GET /admin/activity`).
- **Issue:** Loads each target entity individually per log row.
- **Fix:** Group `targetId`s by `targetType` and batch with `inArray`.

#### B3 — [MEDIUM] Missing indexes on hot filter columns
- **Where:** `lib/db/src/schema`.
- **Issue:** No indexes on `notifications.user_id`, `post_shares.sharer_user_id`, `articles(status, author_id, team_id)`, `highlights(uploader_id, approval_status, team_id)` — all filtered on feed/profile/notification paths.
- **Fix:** Add btree indexes (composite where the query filters multiple columns). Likely the single biggest feed/profile latency win. (Search trigram GIN indexes and roster indexes are already in place — good.)

#### B4 — [MEDIUM] Deeply layered `/feed` query
- **Where:** `routes/posts.ts` (`GET /feed`).
- **Issue:** Several stacked `await Promise.all` layers (3–4 deep) add latency even though each layer is batched.
- **Fix:** Flatten where possible, ensure B3 indexes exist, and consider short-TTL caching of hot feed segments.

#### B5 — [LOW] Unbounded loads
- **Where:** `lib/post-stats.ts` (`inArray` over feed IDs, no cap), `routes/organizations.ts:98` (`limit(50)` but no cursor).
- **Fix:** Cap batch sizes and add cursor pagination to the global org list.

#### B6 — [LOW] Migrations run raw SQL strings
- **Where:** `lib/migrations.ts:746` (`db.execute(sql.raw(m.sql))`).
- **Note:** Fine for trusted migration files; just keep migration SQL out of any user-influenced path. Informational.

---

## Quick wins (high value, low effort)
- Add `helmet` (S3).
- Pin CORS origins + `SameSite=Lax` (S1).
- Add DB indexes: `notifications.user_id`, `post_shares.sharer_user_id`, article/highlight FKs (B3).
- HTML-escape email `note`/`inviterDisplayName` (S5).
- Ownership check on `GET /assets/:assetId` (S4).
- Lower global JSON limit to ~1 MB; raise only on upload route (S7).
- Add `loading="lazy"` + dimensions to images (F3).

## Prioritized action plan
- **P0 (security, do now):** S1, S2, S3, S4, S5.
- **P1 (security hardening + perf wins):** S6, S7, S8, S9; B1, B2, B3; F1, F2.
- **P2 (polish/robustness):** S10–S14; B4, B5; F3, F4, F5.

## Already done well
- Drizzle parameterized queries throughout (no SQL injection surface in app code).
- scrypt + `timingSafeEqual` password hashing; hashed refresh tokens & API keys with rotation.
- AES-256-GCM for AI keys; raw keys never returned (only `keyLast4`).
- Comprehensive, consistently-enforced COPPA layer (profile visibility, minor takedown filtering, DM allowlists, comment gating, AI egress gating, EXIF stripping).
- `trust proxy` set; `pino` redaction of auth headers.
- Frontend route code-splitting, sane query caching, optimistic updates, robust avatar/logo fallbacks.
