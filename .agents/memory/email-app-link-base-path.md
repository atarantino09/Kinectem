---
name: Email deep-links must include the /app base path
description: Server-built links into the main web app need the /app/ prefix or they resolve to the marketing root.
---

The main web app (artifacts/kinectem) is served under the `/app/` base path
(BASE_PATH=/app/, vite base, wouter base = import.meta.env.BASE_URL). The
frontend builds in-app links as `${origin}${BASE_URL}invites/<token>` →
`/app/invites/<token>`.

**Rule:** any link built server-side (email.ts) that should land in the main web
app must include the `/app/` prefix, e.g. `${appBaseUrl()}/app/invites/<token>`.
`appBaseUrl()` returns the deployment root (marketing `/`), NOT the app root.

**Why:** routing is path-based across one application-router deployment. A link
to `${appBaseUrl()}/invites/<token>` (no `/app`) resolves to the marketing
site, not the app, so the accept flow never loads.

**How to apply:** when adding a new transactional email that deep-links into the
app, use `buildInviteAcceptUrl`-style helpers that prepend `/app/`. All current
builders (`buildGuardianConfirmUrl`, `buildOrganizationInviteUrl`,
`buildPasswordResetUrl`, `buildFamilyUrl`, `buildInviteAcceptUrl`) now correctly
include `/app/` — copy that pattern for any new builder.
