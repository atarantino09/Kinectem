# Competition recap review delivery

## Deploying

Publish the existing application normally; do not change its Autoscale target.
The registered startup migration installs transactional publication capture,
review metadata and durable mail records. It acknowledges existing featured
recaps, leaves eligible unfeatured recaps pending, and does not email historical
posts. No OpenAPI, SDK, COPPA, team-follower or photo notification changes are
required.

The in-process worker provides immediate sends while the API is running. It is
not the scheduling guarantee: Autoscale can be idle.

Configure a **separate Scheduled Deployment** for the worker using the same
production database and email configuration as the web deployment:

- Build command: `pnpm install --frozen-lockfile`
- Run command: `NODE_ENV=production pnpm --filter @workspace/scripts run send-competition-recap-digests`
- Cron: `* * * * *` (every minute, UTC).
- Provide the production database via the deployment's database configuration,
  `APP_BASE_URL` matching the published origin, and the existing SendGrid
  connector or sender secrets. If email credentials were entered in the admin
  screen, provide the same encryption key (`AI_KEYS_ENCRYPTION_KEY`, if used,
  otherwise `SESSION_SECRET`) so the worker can decrypt those stored credentials.
  Never copy development database rows or development unsubscribe tokens.
- First run `... run send-competition-recap-digests -- --dry-run` against the
  selected deployment environment to verify connectivity without sending.

This task does not publish or create a scheduled deployment automatically.
Replit documentation: https://docs.replit.com/features/publishing/deployment-types#scheduled

## Delivery rules

- Publication is captured by a database trigger, atomically with successful
  published INSERTs and draft/approval status transitions. Edits and repeated
  publication do not re-alert. Only published, non-hidden, public coach game
  recaps participate; practice plans, historical/combined stories and drafts
  are excluded. Curation never changes the team's post status.
- Actual owner, direct and hub administrators receive one bell each; the
  publishing actor and recap author are excluded. Bell read state never acknowledges a recap.
- Email resolves minor administrators to active adult guardians, deduplicating
  actual recipients. A guardian who is also the actor is excluded. Preferences
  and unsubscribe tokens belong to the resolved recipient.
- Default UTC windows are `[00:00,02:00)`, `[02:00,04:00)`, etc. Each nonempty
  closed window produces one email per recipient across all competitions.
  Immediate items are separate publication batches.
- Preferences are captured at publication and checked again at delivery.
  Changing modes discards outstanding mail rather than converting or replaying
  it; Pause all and competition-recap unsubscribe also discard pending mail.
  Off/Pause do not affect bell or review state.
- Delivery rechecks administrator rights, guardian links, active accounts,
  linked competition, archive/privacy/hidden/takedown state and preferences.
  Removed or inaccessible content produces no email.
- Workers handle at most 50 recipient batches per invocation. Database
  transaction advisory locks span each send, preventing concurrent workers
  from sending the same batch. Publication transactions share a UTC-window
  lock; a digest defers until those transactions commit, so a slow publication
  cannot be dropped from a window that has already been delivered.
  PostgreSQL releases locks on crash/restart;
  transient failures retry after exponential backoff (1 minute to 2 hours).
  Missing sender configuration is a failure, not a successful send.
- Credential lookups are bounded to 10 seconds and provider sends to 30 seconds. A transport timeout, or a crash
  after SendGrid accepts a message but before the transaction commits, has an
  ambiguous outcome: a retry can resend. SendGrid does not offer a transactional
  exactly-once contract. Ordinary successful batches never resend, and concurrent
  workers never send the same batch together.

All email links include `/app/`, and each email contains settings and no-login
category-unsubscribe links in both HTML and plaintext. API sends reuse the
existing branded sender; scheduled sends reuse the shared branded email shell.
