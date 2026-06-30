# Kinectem

Kinectem is a youth-sports social platform enabling users to connect, share updates, and manage team activities.

## Run & Operate

- `pnpm run typecheck`: Run full typecheck across all packages.
- `pnpm --filter @workspace/api-spec run codegen`: Regenerate API hooks and Zod schemas from the OpenAPI spec.
- `pnpm --filter @workspace/api-server run dev`: Start the Prism mock server.
- `pnpm --filter @workspace/kinectem run dev`: Start the web application.
- `pnpm --filter @workspace/scripts run backfill-parent-team-follows`: Backfill `team_followers` so every parent of a rostered child is auto-following that team (idempotent).
- `pnpm --filter @workspace/scripts run backfill-self-team-follows`: Backfill `team_followers` so every user with an accepted roster entry is auto-following that team (idempotent).
- `pnpm --filter @workspace/scripts run export-founding-100`: Export all `founding_signups` rows (newest first) as CSV. Defaults to `founding-100-<date>.csv` in CWD; pass `--out=path.csv` or `--stdout` to override.
- `pnpm --filter @workspace/scripts run bulk-import-organizations`: Bulk-create unclaimed org pages from a single-column CSV of names (idempotent, case-insensitive name match). Defaults to reading `organizations.csv` in CWD; pass `--in=path.csv` to override. Creates orgs with `name` + a secret `claim_token` (`createdById` null, no `organization_admins`).
- `pnpm --filter @workspace/scripts run backfill-org-claim-links`: Ensure every ownerless org has a `claim_token` so it has a working `/claim/<token>` invite link (idempotent; skips orgs that already have a token or an owner).
- `pnpm --filter @workspace/scripts run export-org-claim-links`: Export ownerless orgs + their full `/claim/<token>` links as CSV. Defaults to `org-claim-links-<date>.csv` in CWD; pass `--out=path.csv`, `--stdout`, or `--base=<url>` (link base, defaults to `$APP_BASE_URL` then `https://kinectem.replit.app`; links are `<base>/app/claim/<token>`).
- `pnpm --filter @workspace/scripts run export-org-names`: Regenerate the single-column `organizations.csv` (written-in org names, i.e. `claimToken IS NOT NULL`) that `bulk-import-organizations`/`seed-production-orgs` read. Read-only DB query; defaults to writing `organizations.csv` at the repo root (`--out=path.csv` or `--stdout` to override). **Run in dev right before publishing** so the seed list includes every org added since the last export.
- `pnpm --filter @workspace/scripts run seed-production-orgs`: **Production seed job** — recreate the written-in org pages in a fresh prod DB after first publish (publishing syncs schema only, not rows). Dry-run by default; pass `--apply` to write. Chains `bulk-import-organizations` (reads `organizations.csv` at repo root by default; `--in=<path>` to override) → `backfill-org-claim-links` → `export-org-claim-links` (prints `<base>/app/claim/<token>` links to stdout; `--base` defaults to `$APP_BASE_URL` then `https://kinectem.com`, `--out=<path>` writes a CSV instead). Idempotent. **Run in the production environment** (Replit Scheduled/one-off Deployment) so `DATABASE_URL` points at prod; prod claim tokens are minted fresh, so always export links from the prod run (dev links won't work).
- `pnpm --filter @workspace/scripts run send-billing-reminders`: Send the "add a card before October 1" reminder to owner/admins of orgs that picked a plan but have **no card on file** (`org_subscriptions.stripe_subscription_id IS NULL`). **Schedule once for 2026-09-15** (Replit Scheduled Deployment or manual). Pass `--dry-run` to preview the exact recipient list without sending. NOT idempotent — re-runs re-send to everyone still missing a card; always `--dry-run` first. Uses the SendGrid connector (falls back to `SENDGRID_API_KEY`/`EMAIL_FROM`) and `$APP_BASE_URL` (defaults `https://kinectem.replit.app`).
- `pnpm --filter @workspace/scripts run send-weekly-digest`: Send the **weekly team-activity digest** (category `digest_weekly`) to every team follower whose followed teams had new published recaps or team announcements in the last 7 days. **Schedule weekly** (e.g. Monday-morning Replit Scheduled Deployment). Pass `--dry-run` to preview recipients. NOT idempotent. COPPA-safe: a minor's digest routes to their linked guardian (who auto-follows the child's teams), deduped per recipient email; every send carries a no-login unsubscribe link. Self-contained (leaf scripts can't import api-server email helpers) — gate logic lives in `scripts/src/lib/email-campaign.ts`; uses the SendGrid connector (falls back to `SENDGRID_API_KEY`/`EMAIL_FROM`) and `$APP_BASE_URL`.
- `pnpm --filter @workspace/scripts run send-inactivity-nudge`: Send the **"we miss you" nudge** (category `motivational`) to active, non-deleted users whose last sign-in (most recent `sessions.created_at`, else signup date) is older than `--days` (default 21; e.g. `-- --days=30`). **Schedule periodically** (e.g. weekly). Pass `--dry-run` to preview. NOT idempotent — re-runs re-send to everyone still inactive. COPPA-safe: a minor's nudge routes to their guardian; suppressed by the `motivational` toggle or master pause; every send carries a no-login unsubscribe link. Self-contained — shares `scripts/src/lib/email-campaign.ts`.

**Required Environment Variables**: _Populate as you build_

## Deployment

The whole monorepo publishes as a **single Autoscale Deployment** using the application router (`.replit` → `router = "application"`, `deploymentTarget = "autoscale"`). One deployment serves every artifact behind the shared proxy by path. Publishing is user-initiated from the main project (the Publish button) — a task agent cannot trigger it.

- **Deployment `.replit.app` target (CNAME target for custom domains)**: `kinectem.replit.app`
- **Marketing site**: `https://kinectem.replit.app/` (served at root `/`)
- **Main web app**: `https://kinectem.replit.app/app/` (served at `/app/`)
- **API server**: `https://kinectem.replit.app/api` (health: `/api/healthz`)
- **Custom domains already attached**: `kinectem.com`, `www.kinectem.com` (both resolve to the single deployment and currently serve the marketing root `/`).

### Seeding org pages + grabbing the claim-links CSV (post-publish)

Publishing syncs **schema only, not rows**, so a freshly-published prod DB has **no org pages and no claim tokens**. Claim tokens are **minted per-environment** — a CSV exported from dev will NOT work live. Because the whole monorepo ships as **one Autoscale deployment**, there is **no separate Scheduled Deployment to "Run now"** — the seed runs from an authed button **inside the live app** instead.

**Seed button (recommended).** The password-gated founding-admin page (`https://kinectem.com/api/founding-admin`, gated by `FOUNDING_ADMIN_PASSWORD` + `SESSION_SECRET`) has a **"Seed org pages & download CSV"** button. It calls `POST /api/v1/founding-admin/seed-orgs`, which creates the written-in org pages, mints fresh prod tokens, backfills tokens for any ownerless org missing one, and returns the claim-links CSV (`org_name,city,state,claim_link,org_id`; links `https://kinectem.com/app/claim/<token>`) which the browser downloads. Idempotent (tx + advisory lock) — safe to click more than once.

The org-name seed list is **embedded in the api-server** at `artifacts/api-server/src/data/written-in-orgs.ts` (a generated snapshot, NOT read from a CSV at runtime). To refresh it before publishing when new orgs were added in dev:

1. `pnpm --filter @workspace/scripts run export-org-names` — regenerate `organizations.csv` from the dev DB.
2. Regenerate the embedded module from that CSV (single-column parse, case-insensitive dedupe) into `artifacts/api-server/src/data/written-in-orgs.ts`, then commit both.
3. **Republish the main app**, then open the founding-admin page and click **Seed org pages**. (`FOUNDING_ADMIN_PASSWORD` + `SESSION_SECRET` must be set in the deployment, or the page shows "not configured".)

The legacy `seed-production-orgs` script chain still exists for environments that DO have a separate Scheduled Deployment, but this single-deployment project uses the button.

**Setting the platform admin (post-publish).** Schema-only publishing means the dev admin account does NOT carry over — a fresh prod DB only has organic signups, and **platform admin is just `users.role === "admin"`** (no separate flag). The founding-admin page also has a **"Set the platform admin"** action (`POST /api/v1/founding-admin/set-sole-admin`, `{ email }`): it promotes an **existing** live account to admin and demotes every other admin, leaving exactly one. To make `someone@kinectem.com` the sole admin: (1) sign up on the live site (`/app`) with that email, (2) open the founding-admin page, enter the email, click **Set as sole admin**. Idempotent, tx + advisory lock; self-lockout is recoverable since the page's own password gate is independent of any app admin role.

### SendGrid Event Webhook (delivery tracking)

Invite delivery flags (delivered / bounced / dropped / deferred / spam) only light up in production once the SendGrid Event Webhook is wired to the deployment. The code ships fully — this is a one-time operational step per environment:

1. In the SendGrid dashboard, go to **Settings → Mail Settings → Event Webhook**.
2. Set the **HTTP POST URL** to the deployed endpoint: `https://kinectem.replit.app/api/sendgrid/webhook` (use the matching base URL for the target environment).
3. Select the events to POST: `processed`, `delivered`, `deferred`, `bounce`, `dropped`, `spamreport` (others are ignored by the handler).
4. Enable **Signed Event Webhook**, then copy the generated public **Verification Key** into the `SENDGRID_WEBHOOK_VERIFICATION_KEY` secret for that environment.
5. Toggle the webhook **on** and save.

**Safe degrade**: with `SENDGRID_WEBHOOK_VERIFICATION_KEY` unset, `/api/sendgrid/webhook` returns `503` and per-invite `deliveryStatus` simply stays at its pre-send/`sent` value — invites still send and the copy-link fallback still works. Nothing breaks; delivery flags just never advance. The key is required only to keep delivery status fresh.

Both the marketing signup form and the main app call the API via **same-origin `/api/v1/...`** paths, so they must stay co-deployed with the api-server in the same deployment. Splitting marketing and the main app into separate `.replit.app` deployments would break those same-origin calls unless each deployment bundles the api-server. Note for the downstream `app.kinectem.com → main app` task: because all custom domains hit the same application-router deployment and routing is path-based (not host-based), pointing `app.kinectem.com` at this deployment serves the marketing root `/`, not `/app/` — that routing needs a host-based rewrite/redirect decision.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js**: 24
- **TypeScript**: 5.9
- **API Server**: Express 5 with `express-openapi-validator`
- **Web Frontend**: React, Vite, Tailwind, shadcn/ui, wouter, tanstack-query
- **ORM**: Drizzle
- **Validation**: Zod (generated from OpenAPI)
- **Build Tool**: Vite

## Where things live

- `artifacts/api-server`: Express + Drizzle + Postgres backend.
- `artifacts/kinectem`: Main web application (React, Vite, Tailwind).
- `artifacts/dev-portal`: Developer portal for API access and management.
- `artifacts/mockup-sandbox`: Design sandbox.
- `lib/api-spec/openapi.yaml`: **Source of truth for API contracts**.
- `lib/db/src/schema`: **Source of truth for DB schema**.
- `src/lib/coppa.ts`: COPPA-related server-side enforcement and helpers.
- `src/middlewares/auth.ts`: Authentication middlewares.
- `exports/kinectem-sdk`: Standalone client SDK.

## Architecture decisions

- **OpenAPI Spec as Single Source of Truth**: The `openapi.yaml` defines all API contracts, driving client and validation code generation.
- **COPPA Compliance Phases**: Implemented in phases to address parental consent, moderation, and minor data protection, impacting account lifecycle, content visibility, and data handling.
- **Server-Issued Session Cookies for Web, Bearer Tokens for External Clients**: `kinectem_session` cookie for browser-based auth, short-lived bearer tokens for mobile/external clients, and long-lived API keys for server-to-server integrations.
- **Consistent Error Handling**: All API errors conform to `{ error, code, ...extras }` structure defined by `apiError` helper.
- **Avatar Component Encapsulation**: A wrapper component (`<UserAvatar>`, `<TeamAvatar>`) is used to manage Radix Avatar's loading state complexities, ensuring avatars render correctly.

## Product

- **Youth-Sports Social Platform**: Core functionality includes user profiles, posts, comments, likes, and team management.
- **Developer Portal**: Provides API documentation, code samples, and self-service API key management.
- **COPPA Compliance**: Implements parental consent flows for minors, guardian-mediated communication controls, and data protection features like private-by-default profiles and right-to-delete.
- **Content Sharing**: Users can re-share game-recap articles, which appear on their profile and followers' feeds.
- **Notifications**: Users receive notifications for relevant activities.
- **Search Functionality**: Cross-entity search across users, organizations, and teams.
- **Asset Uploads**: Supports multi-step file uploads for messages and other content, with server-side processing for minors' asset security.

## User preferences

- I prefer short, concise responses.
- Please use bullet points for lists.
- I expect you to adhere to the coding style and conventions of the existing codebase.
- Always ask for confirmation before making significant changes or adding new features.
- Provide clear explanations for complex technical decisions.
- Do not make changes to the `lib/api-spec/openapi.yaml` file without explicit instruction.
- Do not make changes to the `artifacts/api-server/src/lib/coppa.ts` file without explicit instruction.
- Do not make changes to the `exports/kinectem-sdk` directory.

## Gotchas

### COPPA & minors

- **Roster status mapping**: `roster_entries.status` DB values (`accepted | pending | declined`) map to public API `active | pending`. Expect `"active"` from `/teams/:teamId/members*` and `/users/:userId/teams`.
- **Minor profile visibility**: Minors are private by default (`followers` visibility on signup). When `profileVisibility != 'public'`, `GET /users/:userId` and `/users/:userId/posts` restrict to self, linked guardian, platform admin, or approved followers — shared-team admins get NO carve-out.
- **Minor content takedown**: `GET /posts/:postId`, `/feed`, and `/users/:userId/posts` hide any article/highlight with a `pending` `takedown_requests` row, except for the requesting guardian and platform admins. Guardian-filed takedowns require the child be linked to the post (author/uploader/tagged).
- **Right-to-delete**: Guardians call `POST /guardians/children/:childId/request-deletion` (idempotent — first call stamps `deletion_requested_at`). Operator hard-deletes after the cooling-off window with `pnpm --filter @workspace/scripts run coppa:delete -- <userId> --apply` (default 24h, override `COPPA_DELETION_GRACE_HOURS`).
- **Minors never surface in recommendations**: `/posts/follow-suggestions` filters minors so children don't appear in stranger flows.
- **Admin takedown queue**: Pending guardian takedowns surface at `/admin/moderation` → Takedowns tab (`GET /admin/takedowns?status=`). Approve/decline is a single transaction with conditional `UPDATE ... WHERE status='pending' RETURNING`, so concurrent approve+decline collapses to one winner. Decisions write to `consent_audit_log` (not `admin_activity_log`).
- **`coppa.ts` is locked**: COPPA notification inserts therefore live in the relevant route file (filings in `guardians-coppa.ts`, decisions in `admin.ts`, roster role changes in `teams.ts`), not in `coppa.ts`. Minor actors are masked at notification write time.

### Guardians & parents

- **Guardian capability is link-derived, not role-derived**: The Family dashboard + guardian-only endpoints are gated on "has ≥1 `users` row with `parentId = me.id`", NOT on `role === "parent"`. `GET /auth/whoami` exposes `isGuardian` + `linkedChildrenCount` for any role. Per-child access still gates on the actual `parentId` link (and guardian confirmation for under-13s).
- **Guardian-confirm tokens hashed at rest**: `users.guardian_confirm_token_hash` stores SHA-256 hex; the raw token only leaves the server in the parent's email. Use `hashToken()` from `src/lib/passwords.ts` to persist and to look up a submitted token.
- **Guardian-confirm recovery is generic**: `POST /auth/guardian-resend-by-email` (no auth) always returns the same `{ ok: true }` 200 — never branch on it for account existence. It rotates the token hash + expiry and re-sends the confirmation email.
- **Parent auto-follows child's team**: Any guardian-driven roster placement auto-inserts the parent into `team_followers`. `GET /users/:userId/teams` then emits a synthetic membership row marked `position: "parent"` (the wire marker), which the profile UI renders as a "Parent" badge. All inserts are idempotent; backfill via `backfill-parent-team-follows`.

### Email & infra

- **SendGrid via Replit connector**: Credentials (`api_key` + `from_email`) are pulled from the `sendgrid` connector on every send (no caching — proxy tokens rotate), falling back to `SENDGRID_API_KEY` + `EMAIL_FROM` env for local/CI. The connector is the source of truth for the verified sender — do NOT also set `EMAIL_FROM` in Secrets, it silently overrides the connector. `APP_BASE_URL` is env-only; unset → falls back to `https://${REPLIT_DEV_DOMAIN}` then `http://localhost:5173`.
- **SendGrid Event Webhook is a per-env operational step**: invite delivery flags (bounced/dropped/spam/etc.) only advance once the Signed Event Webhook is pointed at `/api/sendgrid/webhook` and the public Verification Key is in `SENDGRID_WEBHOOK_VERIFICATION_KEY`. Unset → the handler returns `503` and delivery status stays put (safe degrade; invites still send, copy-link fallback still works). Full setup steps are in the **Deployment → SendGrid Event Webhook** runbook above.

### Org management

- **Org setup checklist**: Owner/admin-only six-step first-run checklist on the org dashboard (`GET /organizations/:orgId/setup-status`, dismiss endpoints). Dismissal is per-user. The roles vocabulary (owner / admin / member / coach / player / parent / platform admin) is centralized in the `RolesReference` component and mirrored on the marketing `getting-started.html` — update it in one place.
- **Founding 100 signup capture**: Marketing `/#signup` posts to public `POST /founding-signups` (rate-limited 10/hr/IP), upserting by lowercased `adminEmail`. Operators view/export at `/admin/founding-100` or via `export-founding-100`. The form deliberately collects no minor/guardian data, so COPPA gating is N/A. _(Retirement proposed — see tasks #619/#620.)_
- **Org page claim flow**: Bulk-imported org pages are ownerless. An `admin`-role user submits a **claim request** (not an instant transfer) via `POST /organizations/:orgId/claims` (`403` for non-admins, `409` if an owner exists, idempotent per pending). `GET /organizations/:orgId` exposes `hasOwner` + `myClaimStatus` (read via narrow cast — `openapi.yaml` is locked). Platform admins review at `/admin/moderation` → Org claims. Approval is a transaction that refuses race-safe if an owner already exists. NOTE: claim/billing/AI routes mount at `/api/v1`, NOT `/api` (that prefix is docs + founding-admin page only).
- **Two distinct org-claim paths exist** — the review-gated claim *request* above AND a secret-token instant claim *link* (`/app/claim/<token>`, seeded by bulk import / `backfill-org-claim-links`). Don't conflate them; both are owner-exclusive via the one-owner index.

### Billing (Stripe)

- **Card-on-file now, first charge Oct 1**: Signup is card-free; orgs pick a plan (`PUT /organizations/:orgId/subscription`). Adding a card is deferred/opt-in via Stripe Checkout (`mode: subscription`, `trial_end` = Oct 1 2026 so **nothing is charged today**). The success redirect carries `session_id`, which `POST .../billing/reconcile` exchanges to persist `stripeCustomerId`/`stripeSubscriptionId`. Both billing endpoints are `requireAuth` + `canManageOrganization` + rate-limited.
- **Connector has NO webhook secret**: The Stripe key comes from the Replit `stripe` connector (`settings.secret`, fallback `STRIPE_SECRET_KEY`). Reconcile-on-return is the source of truth; `stripe-webhook.ts` is an optional backstop that only mounts when `STRIPE_WEBHOOK_SECRET` env is set. Plan prices/coupons auto-provision by lookup_key. `hasCardOnFile` = `stripeSubscriptionId != null`. `stripe` is an api-server dep (not root). The Sept-15 reminder copy is a self-contained script (`send-billing-reminders`) — leaf scripts can't import api-server email helpers.

### AI Assist

- **Self-managed Anthropic key**: Coaches/authors draft recap copy via Claude (`POST /ai/assist`). The key is **app-managed, not Replit-managed** — an admin enters it on the AI Assist admin tab (route slug `/admin/ai-keys`), stored encrypted at rest (AES-256-GCM, key from `AI_KEYS_ENCRYPTION_KEY` else `SESSION_SECRET`); only `keyLast4` is ever returned. Egress is gated by `canAuthorRecapAnywhere` (org admin/coach/author), NOT just `requireAuth` — minors get `403 AI_FORBIDDEN`. **Default model is a dated release** (`claude-sonnet-4-5-...`), NOT a `-latest` alias (those 404 → surface as `502`); admins override via a model dropdown populated live from the saved key. Optional `system_context` is prepended to every generation to tune voice.

### Frontend conventions

- **Avatars**: Always use `<UserAvatar>` / `<TeamAvatar>`; never compose Radix avatars directly (loading-state bugs).
- **Modals**: Center shadcn Dialog/AlertDialog with flexbox, not `-translate-1/2` — the transform half-pixels odd-sized modals and blurs text.
- **Team hero photos**: Use `BlurFillImage` (contain over blurred cover), not `object-cover` crop; team upload flows have no crop step.
- **Article re-shares**: Sharing your own recap is a visual no-op on your own profile (merge logic prioritizes authored content).

### Code review deviations (intentional — keep)

- **Session cookie stays `SameSite=None; Secure`** — do NOT switch to `Lax`; the Replit preview runs in a cross-site iframe. CSRF is covered by the CORS allowlist + Origin/Referer checks.
- **Cursor pagination is blocked** on `/notifications`, `/follow-requests`, `/teams/:id/members`, `/organizations/:id/teams` — `openapi.yaml` is locked and lacks the cursor params.
- **Missing optional secrets WARN at boot, don't hard-fail** (avoids bricking deploys; the `SESSION_SECRET` fallback is ≥32 chars).
- Most other CODE_REVIEW.md S/F/B findings are implemented (CORS+CSRF, helmet, asset ownership, email escaping, DB indexes, Postgres-backed rate-limit store, feed virtualization, lazy images). Deferred as low-value/high-risk: roster virtualization, feed flatten, S11/S14/F5.

## Paused work

- **Task #505 — Pre-launch hardening** (paused). Five-step launch checklist before pointing `www.kinectem.com` at the Replit Deployment: (1) Managed Postgres cutover (Neon) with backups+PITR, (2) Object storage for uploads, (3) Scheduled COPPA + backfill jobs (Replit Scheduled Deployments), (4) Shared-state rate limiting across Autoscale instances (replace in-memory `signupLimiter`), (5) Custom domain + `LAUNCH.md` runbook. Task spec at `.local/tasks/task-505.md`. No code changes started — resume by re-prompting #505.

## Pointers

- [pnpm-workspace skill](https://www.pnpm.io/workspaces)
- [TypeScript Project References](https://www.typescriptlang.org/docs/handbook/project-references.html)
- [API Conventions](API_CONVENTIONS.md)
- [Scalar API Reference React](https://github.com/scalar/scalar/tree/main/packages/api-reference-react)
- [Tanstack Query](https://tanstack.com/query/latest)