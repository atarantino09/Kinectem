---
name: Email admin credential override
description: Admin-configurable SendGrid credentials (DB) override env/connector; the two isEmailConfigured variants and when to use each.
---

# Email admin credential override

Admins configure SendGrid (API key + verified From email) from an admin "Email"
settings page, mirroring the AI Assist provider-key feature. Credentials live in
the `email_provider_keys` table (one row per provider, currently `sendgrid`):
key stored as AES-256-GCM ciphertext via `secret-crypto`, only `keyLast4`
returned. Routes are admin-gated, mounted at `/api/v1/admin/email-providers`
(GET/PUT/DELETE + `/test`), read from the client via untyped fetch because
`openapi.yaml` is locked.

## Credential precedence at send time
`resolveCredentials()` in `email.ts` resolves in this order:
1. **Admin DB row** (`resolveAdminCredentials()`) — takes precedence when a
   complete row exists (key decrypts + `fromEmail` set).
2. **env vars** (`SENDGRID_API_KEY` + `EMAIL_FROM`).
3. **Replit `sendgrid` connector**.

**Why env-before-connector:** that ordering is pre-existing in this codebase and
was kept as-is, even though `replit.md`'s gotcha text reads "connector,
falling back to env". Don't "fix" the order without intent — it changes
established behavior. The admin check was only *prepended*.

## Two isEmailConfigured variants — pick the right one
- `isEmailConfigured()` (sync) checks **only env/connector**, NOT the admin DB
  row. Correct for the GET endpoint's `fallbackConfigured` flag (reports whether
  a non-admin fallback exists).
- `isEmailConfiguredAsync()` (async) is **admin-aware** (admin DB OR env OR
  connector). **Use this in any pre-gate** that decides whether to send (e.g.
  `article-tagging.ts` `sendTagEmails`). Using the sync one there silently
  suppresses email when ONLY the admin DB key is configured.

**How to apply:** new "should we bother sending?" gates must call the async
variant or they'll regress the admin-only-config case.
