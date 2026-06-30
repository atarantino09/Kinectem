# Kinectem

Youth-sports social platform: user profiles, posts/comments/likes, team & org management, with COPPA-compliant flows for minors. Published as a single Autoscale deployment serving marketing, the web app, and the API behind one shared proxy.

## User preferences

- Short, concise responses; use bullet points for lists.
- Adhere to existing codebase style and conventions.
- Ask for confirmation before significant changes or new features.
- Explain complex technical decisions clearly.
- **Do not edit** (without explicit instruction): `lib/api-spec/openapi.yaml`, `artifacts/api-server/src/lib/coppa.ts`, `exports/kinectem-sdk/`.

## Stack

- pnpm workspaces monorepo · Node 24 · TypeScript 5.9
- **API**: Express 5 + `express-openapi-validator` · Drizzle ORM · Postgres
- **Web**: React + Vite + Tailwind + shadcn/ui + wouter + tanstack-query
- **Validation**: Zod generated from OpenAPI

## Where things live

- `artifacts/api-server` — Express + Drizzle + Postgres backend.
- `artifacts/kinectem` — main web app.
- `artifacts/dev-portal` — developer portal (API docs + key management).
- `artifacts/marketing` — marketing site (static HTML).
- `lib/api-spec/openapi.yaml` — **source of truth for API contracts** (locked).
- `lib/db/src/schema` — **source of truth for DB schema**.
- `artifacts/api-server/src/lib/coppa.ts` — COPPA server-side enforcement (locked).
- `exports/kinectem-sdk` — standalone client SDK (locked).

## Architecture decisions

- **OpenAPI is the single source of truth** — drives client hooks + Zod validation via codegen.
- **Auth**: `kinectem_session` cookie for browsers; short-lived bearer tokens for mobile/external; long-lived API keys for server-to-server.
- **Errors**: all conform to `{ error, code, ...extras }` via the `apiError` helper.
- **COPPA in phases** — parental consent, moderation, minor data protection across account lifecycle, content visibility, and data handling.
- **Avatars are encapsulated** — always use `<UserAvatar>` / `<TeamAvatar>`, never compose Radix avatars directly (loading-state bugs).

## Common commands

- `pnpm run typecheck` — full typecheck across all packages.
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks + Zod schemas from the OpenAPI spec.
- `pnpm --filter @workspace/api-server run dev` — start the API server.
- `pnpm --filter @workspace/kinectem run dev` — start the web app.

### Operational scripts (`@workspace/scripts`)

Run with `pnpm --filter @workspace/scripts run <name>`. All accept `--dry-run`/`--stdout`/`--out=` where noted; read each script's header for full flags.

- **Backfills (idempotent)**: `backfill-parent-team-follows`, `backfill-self-team-follows` (auto-follow team for parents / rostered users); `backfill-org-claim-links` (ensure every ownerless org has a `claim_token`).
- **Org seed/export**: `export-org-names` (regenerate `organizations.csv`; **run in dev right before publishing**), `bulk-import-organizations` (create ownerless org pages from CSV), `export-org-claim-links` (CSV of `/app/claim/<token>` links), `seed-production-orgs` (legacy prod seed chain — see Deployment for the preferred button), `export-founding-100`.
- **Email campaigns** (NOT idempotent; always `--dry-run` first; COPPA-safe — minor's email routes to guardian, each carries a no-login unsubscribe link; shared gate logic in `scripts/src/lib/email-campaign.ts`):
  - `send-billing-reminders` — "add a card before Oct 1" to orgs with a plan but no card. **Schedule once for 2026-09-15.**
  - `send-weekly-digest` — weekly team-activity digest. **Schedule weekly.**
  - `send-inactivity-nudge` — "we miss you" to users inactive `--days` (default 21).
- **COPPA delete**: `coppa:delete -- <userId> --apply` — operator hard-delete after the cooling-off window (default 24h, override `COPPA_DELETION_GRACE_HOURS`).

## Deployment

The whole monorepo publishes as **one Autoscale Deployment** (`.replit` → `router = "application"`, `deploymentTarget = "autoscale"`); one deployment serves every artifact by path. Publishing is **user-initiated** (Publish button) — agents/task agents can't trigger it.

- **CNAME target**: `kinectem.replit.app`
- Marketing `/` · Web app `/app/` · API `/api` (health `/api/healthz`)
- **Custom domains**: `kinectem.com`, `www.kinectem.com` → same deployment, currently serve marketing `/`.
- Marketing + web app both call the API via **same-origin `/api/v1/...`**, so they MUST stay co-deployed with the api-server. Routing is **path-based, not host-based** — pointing `app.kinectem.com` here would serve marketing `/`, not `/app/` (needs a host-based decision).

> **Publishing syncs SCHEMA ONLY, not rows.** A freshly-published prod DB has no org pages, no claim tokens, and no admin account. Claim tokens are **minted per-environment** — a dev CSV won't work live. The agent has **read-only** prod access; all prod writes run from inside the deployment via the founding-admin page below.

### Founding-admin page (in-app prod operations)

Password-gated page at `https://kinectem.com/api/founding-admin` (gated by `FOUNDING_ADMIN_PASSWORD` + `SESSION_SECRET`; shows "not configured" if unset). All actions are idempotent (tx + advisory lock). Buttons:

- **Seed org pages & download CSV** — creates the written-in org pages, mints fresh prod tokens, backfills any missing, downloads the claim-links CSV. The seed list is **embedded** at `artifacts/api-server/src/data/written-in-orgs.ts` (generated snapshot, not read at runtime). To refresh before publishing: run `export-org-names` in dev → regenerate that module from the CSV → commit → republish → click Seed.
- **Set the platform admin** — promotes one existing live account to `role === "admin"` and demotes all others (platform admin is just `users.role === "admin"`). Sign up live with the target email first, then set it here.
- **Delete a specific organization** — deletes ONE org by id (cascades its teams + dependent content); requires typing the org's exact name. Scoped to one org on purpose — never reintroduce a delete-all (would wipe the seeded claim pages).

### SendGrid Event Webhook (per-env, optional)

Invite delivery flags only advance once the Signed Event Webhook is wired. In SendGrid → Settings → Mail Settings → Event Webhook: POST URL `https://kinectem.replit.app/api/sendgrid/webhook`, events `processed/delivered/deferred/bounce/dropped/spamreport`, enable signing, put the public Verification Key in `SENDGRID_WEBHOOK_VERIFICATION_KEY`. **Safe degrade**: unset → handler returns `503`, invites still send + copy-link fallback works, flags just don't advance.

## Gotchas

> Deep, durable lessons live in the agent's persistent memory (`.agents/memory/`). Below are the highest-frequency ones.

### COPPA & minors

- **`coppa.ts` is locked** — COPPA notification inserts live in route files (`guardians-coppa.ts`, `admin.ts`, `teams.ts`), not `coppa.ts`. Minor actors masked at write time.
- **Roster status mapping**: DB `accepted|pending|declined` → public API `active|pending`.
- **Minor visibility**: private by default (`followers`); non-public profiles/posts restrict to self, linked guardian, platform admin, approved followers — shared-team admins get NO carve-out. Minors never appear in `/posts/follow-suggestions`.
- **Takedowns**: pending `takedown_requests` hide content everywhere except the requesting guardian + platform admins; admin queue at `/admin/moderation` → Takedowns (decisions write to `consent_audit_log`).
- **Right-to-delete**: guardian `POST /guardians/children/:childId/request-deletion` (idempotent) → operator `coppa:delete` after grace window.

### Guardians & parents

- **Guardian capability is link-derived, not role-derived** — gated on "has ≥1 `users` row with `parentId = me.id`", not `role`. `whoami` exposes `isGuardian` + `linkedChildrenCount`.
- **Guardian-confirm tokens** are SHA-256 hashed at rest (`hashToken()`); recovery endpoint always returns generic `{ ok: true }` — never branch on it.
- **Parent auto-follows child's team** — roster placement inserts parent into `team_followers`; `GET /users/:userId/teams` emits a synthetic `position: "parent"` row (renders a "Parent" badge).

### Org management & billing

- **Org claiming is invite-only** — the only way to claim an ownerless page is the secret-token link (`/app/claim/<token>`) the owner sends directly. The old open claim-*request* flow is retired: `POST /organizations/:orgId/claims` returns `403 CLAIM_INVITE_ONLY` and the in-app "Claim this organization" button is gone. Unclaimed orgs stay publicly visible (search + detail) on purpose. Both claim paths stay owner-exclusive via the one-owner index.
- **Route prefix**: claim/billing/AI routes mount at `/api/v1`, NOT `/api` (that's docs + founding-admin page only).
- **Billing**: card-free signup; orgs pick a plan, add a card later via Stripe Checkout (`trial_end` = Oct 1 2026, nothing charged today). Reconcile-on-return is source of truth; the connector has NO webhook secret. `hasCardOnFile` = `stripeSubscriptionId != null`.
- **Roles vocabulary** (owner/admin/member/coach/player/parent/platform admin) is centralized in `RolesReference` and mirrored on marketing `getting-started.html` — update in one place.

### AI Assist

- **Self-managed Anthropic key** (app-managed, NOT Replit-managed) entered by an admin at `/admin/ai-keys`, encrypted at rest (AES-256-GCM). Egress gated by `canAuthorRecapAnywhere` (minors → `403`). Default model is a **dated** release, not a `-latest` alias.

### Email & infra

- **SendGrid via Replit connector** — creds pulled per-send (no caching). Connector is the source of truth for the sender; do NOT also set `EMAIL_FROM` in Secrets (it silently overrides). `APP_BASE_URL` is env-only.

### Frontend conventions

- **Avatars**: always `<UserAvatar>` / `<TeamAvatar>`.
- **Modals**: center shadcn Dialog/AlertDialog with flexbox, not `-translate-1/2` (blurs text).
- **Team hero photos**: use `BlurFillImage` (contain over blurred cover), not `object-cover`.

### Intentional code-review deviations (keep)

- **Session cookie stays `SameSite=None; Secure`** — preview runs in a cross-site iframe; CSRF covered by CORS allowlist + Origin/Referer checks.
- **Cursor pagination blocked** on a few list endpoints — `openapi.yaml` is locked and lacks the params.
- **Missing optional secrets WARN at boot, don't hard-fail** (avoids bricking deploys).

## Paused work

- **Task #505 — Pre-launch hardening** (paused, no code started). Checklist: (1) Managed Postgres cutover (Neon) + backups/PITR, (2) object storage for uploads, (3) scheduled COPPA + backfill jobs, (4) shared-state rate limiting across Autoscale instances, (5) custom domain + `LAUNCH.md` runbook. Spec at `.local/tasks/task-505.md`; resume by re-prompting #505.

## Pointers

- [API Conventions](API_CONVENTIONS.md) · [pnpm workspaces](https://www.pnpm.io/workspaces) · [TS Project References](https://www.typescriptlang.org/docs/handbook/project-references.html) · [Tanstack Query](https://tanstack.com/query/latest)
