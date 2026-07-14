---
name: Email base URL is env-aware in dev
description: APP_BASE_URL is a global secret that applies to dev too; api-server email links override it with the Replit dev domain outside production.
---

**Rule:** Outside production (`NODE_ENV !== "production"`), the api-server's `appBaseUrl()` prefers `https://$REPLIT_DEV_DOMAIN` over `APP_BASE_URL`, logging a one-time WARN when the secret is being ignored.

**Why:** `APP_BASE_URL` is stored as a global secret, so it applies to development too. Reset/invite tokens are per-environment, so dev-sent emails that link to `kinectem.com` always fail there ("invalid or expired").

**How to apply:**
- Don't "fix" dev email links by unsetting the secret — the code override must keep dev correct regardless.
- Tests that pin `APP_BASE_URL` must also clear `REPLIT_DEV_DOMAIN` or they become environment-dependent (see `tests/email-app-link-base-path.test.ts`).
- The `@workspace/scripts` email campaigns still read `APP_BASE_URL` directly — same footgun applies there until consolidated.
