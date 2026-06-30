---
name: Standalone admin page when artifact cap is hit
description: How a standalone password-protected admin tool was added without a new artifact (Founding 100 manager).
---

# Standalone admin tool without a new artifact

When a "standalone mini-app with its own URL + simple password" is requested but
`createArtifact` fails with the **7-artifact-per-project cap**, serve a
self-contained HTML page directly from the existing **api-server** instead of
creating a new react-vite artifact.

**Why:** the project is at the hard artifact limit; api-server already routes at
`/api` (dev + prod) so a page mounted there gets a real standalone URL with zero
extra services to deploy.

**How to apply:**
- Mount a tiny router returning an inlined HTML string (vanilla JS, no build step)
  at a path under `/api` (e.g. `/api/founding-admin`). Inline the HTML so it lands
  in the esbuild bundle — do not read a sibling file at runtime.
- Back it with password-gated JSON endpoints under `/api/v1/...`. Auth pattern that
  worked: `POST .../session` checks a `*_PASSWORD` secret (timing-safe), returns an
  HMAC(`SESSION_SECRET`) bearer token with an `exp`; a `require*` middleware verifies
  it. **Fail closed (503) if either the password or `SESSION_SECRET` is missing — never
  fall back to a hardcoded signing secret (forgeable tokens).**
- Keep new endpoints out of `lib/api-spec/openapi.yaml` (locked); follow the
  inline-Zod style of `routes/founding-signups.ts`.

**Drizzle gotcha:** `eq(table.id, req.params.id)` can trip a "No overload matches"
type error in this repo; wrap the param as `eq(table.id, String(req.params.id))`
(the defensive convention already used in `guardians-coppa.ts`).

**Operator-only prod mutations belong on this page.** Because publishing is
schema-only and the agent has read-only prod access, any one-off live-DB write the
operator needs (seed org pages, set the platform admin) is exposed as an authed
endpoint behind this same password gate, not a script. **Platform admin is
`users.role === "admin"`** (the `user_role` enum is athlete/coach/admin/parent —
there is NO separate `is_platform_admin` column). A "sole admin" action promotes
the target then demotes all other `role='admin'` users to `athlete` inside a tx +
advisory lock; the target must already exist (operator signs up on the live site
first — dev accounts never carry to prod). Self-lockout is recoverable because the
page's own auth is the password gate, independent of any app admin role.
