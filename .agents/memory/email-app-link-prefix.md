---
name: Email links to app routes need /app prefix
description: Why email deep-links to the web app must be prefixed with /app or they fall through to the marketing site
---

# Email links must target `/app/...` for web-app routes

Any email link that should open a web-app page (posts/recaps, teams, settings,
roster invites, etc.) MUST be built as `${appBaseUrl()}/app/<route>`, not
`${appBaseUrl()}/<route>`.

**Why:** the whole monorepo is one Autoscale deployment behind a path-based
proxy — marketing is served at `/`, the web app at `/app/`, the API at `/api`.
A bare link like `${appBaseUrl()}/posts/123` is NOT a web-app route, so the
proxy falls through and serves the **marketing homepage** instead of the recap.
This surfaced as "the recap email link took me to the marketing landing page."

**How to apply:** when adding/reviewing email URLs (in `lib/email.ts`,
`lib/notifications.ts`, and route files that build links inline), confirm the
path segment starts with `/app` for anything that renders in the React app.
Only genuine non-app paths stay unprefixed: `/api/...` endpoints (e.g. the
notifications unsubscribe route). `buildPostUrl` centralizes the `/app` prefix
(with a double-prefix guard); prefer routing new post/recap links through it
rather than hand-building the URL.
