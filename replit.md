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
- `pnpm --filter @workspace/scripts run bulk-import-organizations`: Bulk-create unclaimed org pages from a single-column CSV of names (idempotent, case-insensitive name match). Defaults to reading `organizations.csv` in CWD; pass `--in=path.csv` to override. Creates orgs with `name` only (`createdById` null, no `organization_admins`).

**Required Environment Variables**: _Populate as you build_

## Deployment

The whole monorepo publishes as a **single Autoscale Deployment** using the application router (`.replit` → `router = "application"`, `deploymentTarget = "autoscale"`). One deployment serves every artifact behind the shared proxy by path. Publishing is user-initiated from the main project (the Publish button) — a task agent cannot trigger it.

- **Deployment `.replit.app` target (CNAME target for custom domains)**: `kinectem.replit.app`
- **Marketing site**: `https://kinectem.replit.app/` (served at root `/`)
- **Main web app**: `https://kinectem.replit.app/app/` (served at `/app/`)
- **API server**: `https://kinectem.replit.app/api` (health: `/api/healthz`)
- **Custom domains already attached**: `kinectem.com`, `www.kinectem.com` (both resolve to the single deployment and currently serve the marketing root `/`).

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

- **Roster Status Mapping**: `roster_entries.status` in DB (`accepted | pending | declined`) maps to public API `active | pending`. Expect `"active"` from `/teams/:teamId/members*` and `/users/:userId/teams` responses.
- **Minor Profile Visibility**: Minor profiles are private by default (`followers` visibility on signup). When `profileVisibility != 'public'`, both `GET /users/:userId` and `GET /users/:userId/posts` restrict access to self, linked guardian, platform admin, or approved followers only — shared-team admins do NOT get a carve-out for restricted minors.
- **Minor Content Takedown**: `GET /posts/:postId`, `/feed`, and `/users/:userId/posts` exclude any article/highlight with a `pending` `takedown_requests` row, except for the requesting guardian and platform admins. Guardian-filed takedowns require the child be linked to the post (author/uploader or tagged).
- **Right-to-delete**: Guardians call `POST /guardians/children/:childId/request-deletion` (idempotent — first call stamps `deletion_requested_at`). Operator runs `pnpm --filter @workspace/scripts run coppa:delete -- <userId> --apply` to hard-delete after the cooling-off window (default 24h, override `COPPA_DELETION_GRACE_HOURS`).
- **Minor recommendations**: `/posts/follow-suggestions` filters out minors via `filterOutMinors` so children never surface in stranger recommendation flows.
- **Article Re-shares**: Sharing your own recap is a visual no-op on your own profile due to merge logic prioritizing authored content.
- **Avatar Rendering**: Always use `<UserAvatar>` or `<TeamAvatar>` components; do not compose Radix avatars directly to avoid loading state issues.
- **Admin takedown queue**: Pending guardian takedowns surface at `/admin/moderation` → Takedowns tab and via `GET /admin/takedowns?status=`. Approve/decline runs in a single `db.transaction` with conditional `UPDATE ... WHERE status='pending' RETURNING`; concurrent approve+decline collapses to one winner / one audit row. Decisions are written to `consent_audit_log` (`guardian_takedown_approved|declined`), not `admin_activity_log`.
- **COPPA notification kinds**: Guardian-side bell uses `child_pending_follow|dm|comment|tag|takedown` linking to `/family?childId=<id>&tab=pending`, plus `guardian_takedown_approved|declined` (Task #369) linking to `/family?childId=<id>` (no `tab=pending` since the item is no longer pending) and `roster_role_changed_for_child` (Task #536) linking to `/family?childId=<id>&entryId=<entryId>&teamId=<teamId>`. Admin-side bell uses `admin_takedown_filed` linking to `/admin/moderation`. The member-side `roster_role_changed` (Task #536) lands on `/teams/<teamId>?roster=1&entryId=<entryId>` and is inserted from `routes/teams.ts` in the `PATCH /teams/:teamId/members/:memberId` handler (skipped on jersey-only edits, no-op position writes, and self-edits; minor actors are masked at write time, matching `roster_invite`). coppa.ts is locked, so all of these inserts live in the relevant route file (`guardians-coppa.ts` for filings, `admin.ts` `decideTakedown` for decisions, `teams.ts` for roster role changes).
- **SendGrid wired via Replit connector (Task #480)**: `src/lib/email.ts` `resolveCredentials()` pulls `api_key` + `from_email` from the Replit `sendgrid` connector proxy on every send (no caching — proxy tokens rotate). Falls back to `SENDGRID_API_KEY` + `EMAIL_FROM` env vars for local dev / CI / tests. `isEmailConfigured()` is sync best-effort: true when env vars are set OR when the connector hostname + repl-identity token are present (actual proxy reachability is verified at send time). The connector is the source of truth for the verified sender — do NOT also set `EMAIL_FROM` in Secrets, that would silently override the connector. `APP_BASE_URL` is still env-only (used by `buildPasswordResetUrl` / `buildGuardianConfirmUrl` / etc); when unset, falls back to `https://${REPLIT_DEV_DOMAIN}` for dev, then `http://localhost:5173`.
- **Guardian-confirm tokens hashed at rest**: `users.guardian_confirm_token_hash` stores SHA-256 hex of the raw token; the raw token only ever leaves the server in the parent's email. Use `hashToken()` from `src/lib/passwords.ts` when persisting and when looking up a submitted token. Migration `2026-05-06-task-32-hash-guardian-tokens` enables `pgcrypto` for the one-time backfill.
- **Parent auto-follows child's team (Task #394)**: Whenever a child is placed on a roster as a result of a guardian-driven flow (parent-inbox `POST /invites/:token/children`, coach-add-member `POST /teams/:teamId/members`, coach-invite-by-email, or guardian search-and-link `POST /users/me/children`), the parent is auto-inserted into `team_followers` via `ensureTeamFollowedAsGuardian` / `backfillTeamFollowsForLinkedChild` (`src/lib/team-follow.ts`). `GET /users/:userId/teams` then unions roster-derived rows with these "via child" follows and emits a synthetic membership row with `role: "member"`, `position: "parent"` (the wire marker), `id: teamId`. Frontend `UserProfilePage` renders a "Parent" badge next to the org badge when `position === "parent"`. Idempotent: all inserts use `onConflictDoNothing`. Existing data is backfilled with `pnpm --filter @workspace/scripts run backfill-parent-team-follows`.
- **Guardian capability is link-derived, not role-derived (Task #400)**: Access to the Family dashboard and the guardian-only endpoints (`POST /users/me/children`, `GET /users/me/children`, expired-confirmation notifications) is gated on "this user has at least one row in `users` with `parentId = me.id`", NOT on `role === "parent"`. Use `isGuardian(userId)` / `countLinkedChildren(userId)` from `src/lib/guardian-capability.ts`. `GET /auth/whoami` exposes `isGuardian: boolean` and `linkedChildrenCount: number` (computed from the effective session user) so the web client can render the Family nav item and the dashboard page guard for any role. The frontend guard in `GuardianPage.tsx` and `Layout.tsx` reads `whoami.isGuardian`; signed-in users without linked children see a friendly empty-state card on `/family` (with the existing `LinkChildSearch` CTA) instead of the old "only available to parent or guardian accounts" hard block. `authorizeChildAccess` / `authorizeGuardianForChild` still gate per-child on the actual `parentId` link (and on guardian confirmation for under-13s) — only the role gate was removed.
- **Parent-driven guardian-confirm recovery (Task #371)**: `POST /auth/guardian-resend-by-email` (`{ guardianEmail }`, no auth) is the recovery action surfaced on `/guardian-confirm/<token>` when the link is dead. It always returns the same generic `{ ok: true, message }` 200 — never branch on it for account existence. Server looks up under-13 users by `guardianEmail` with `guardianConfirmedAt` null, rotates the token hash + expiry, and re-sends `sendGuardianConfirmationEmail`. Reuses `signupLimiter`.

- **Org setup checklist + roles reference (Task #548)**: Owner/admin-only six-step first-run checklist on the org dashboard (`GET /organizations/:orgId/setup-status`, `POST` / `DELETE /organizations/:orgId/setup-checklist/dismiss`). Dismissal is per-user, stored in `organization_admins.dismissed_setup_at`. Steps: `logoSet`, `hasTeam`, `hasStaffOrInvite`, `hasCoAdmin`, `hasRosterEntry`, `hasGuardianLinkOrInvite` — `computeOrgSetupStatus` in `routes/organizations.ts` derives them with count subqueries (single round-trip). All three endpoints gated by `canManageOrganization`. Frontend: `<OrgSetupChecklist>` (owner/admin) + `<RolesPermissionsCard>` (visible to any non-manager member) in `components/OrgSetupChecklist.tsx`. Marketing site adds a public `getting-started.html` mirror of the same six steps + roles reference; Vite config switched to multi-page input. The roles vocabulary (owner / admin / member / coach / player / parent / platform admin) is centralized in `RolesReference` — update it there if labels change.

- **Founding 100 signup capture (Task #543)**: The marketing site's `/#signup` form posts to public `POST /founding-signups` (rate-limited 10/hr per IP via `foundingSignupLimiter` in `src/routes/founding-signups.ts`), upserting by lowercased `adminEmail` into `founding_signups` (org, admin name/email/role, estimated teams + players, optional sport). Admin operators view + filter + CSV-export at `/admin/founding-100` in kinectem (`GET /admin/founding-signups`, admin-only). For bulk export off-site run `pnpm --filter @workspace/scripts run export-founding-100`. Do NOT edit `coppa.ts`; the signup form deliberately does not collect minors or guardian data, so COPPA gating is N/A.

- **Org page claim flow (Task #603)**: Bulk-imported org pages are ownerless (`createdById` null, no `organization_admins`). An eligible signed-in `role === "admin"` user submits a **claim request** (NOT an instant transfer) via public-ish `POST /organizations/:orgId/claims` (rate-limited `org-claim` 10/min per IP; `403 CLAIM_FORBIDDEN` for non-admin roles; `409` if owner already exists; idempotent on an existing pending request). Requests live in `organization_claim_requests` (`orgClaimStatusEnum` pending|approved|declined; unique partial index `org_claim_unique_pending_per_user` blocks duplicate pendings per user/org). `GET /organizations/:orgId` exposes `hasOwner` (default true) + `myClaimStatus` (viewer's pending claim, default null) via `toOrganization` in `spec-helpers.ts` — read on the frontend via narrow cast since `openapi.yaml` is locked. Platform admins review at `/admin/moderation` → **Org claims** tab (`GET /admin/org-claims?status=`, `POST /admin/org-claims/:id/approve|decline`). Approval runs in a `db.transaction`: conditional owner `organization_admins` insert + `createdById` stamp + auto-follow + auto-decline of other pending requests for the same org — **refuses race-safe if an owner already exists**. Claimer is notified (`org_claim_approved|declined`, linking `/organizations/:id`). Hand-written zod + `customFetch` precedent (Founding-100 / AI Assist); no `openapi.yaml` edits. Routes mount at `/api/v1` (NOT `/api` — that prefix is docs + founding-admin page only).
- **AI Assist + self-managed provider keys**: Coaches/authors can draft or polish recap/highlight copy via Claude from the new-post composer ("AI Assist" button → `POST /ai/assist`). The Anthropic API key is **app-managed, not Replit-managed**: an admin enters it on the **AI Assist** admin tab (`/admin/ai-keys`; tab label is "AI Assist", route slug unchanged) (`GET/PUT/DELETE /admin/ai-providers[/:provider]`, admin-only), stored **encrypted at rest** (AES-256-GCM, `src/lib/secret-crypto.ts`, key derived from `AI_KEYS_ENCRYPTION_KEY` else `SESSION_SECRET`) in `ai_provider_keys` — the raw key is never returned, only `keyLast4`. External-AI egress is gated by `canAuthorRecapAnywhere` (org admin / coach / explicit author), NOT just `requireAuth`: non-eligible users (incl. minors) get `403 AI_FORBIDDEN` server-side and the button is hidden client-side (`whoami.canAuthorRecap`). Follows the Founding-100 precedent — hand-written zod + `customFetch`, no `openapi.yaml` runtime validation (none exists). Per-user rate limit 20/min. **Default model** is `claude-sonnet-4-5-20250929` (`DEFAULT_ANTHROPIC_MODEL` in `src/lib/ai.ts`) — pinned to a dated release, NOT a `-latest` alias (the old `claude-3-5-sonnet-latest` alias is no longer served and returned `404 not_found_error: model` → surfaced as `502 AI_REQUEST_FAILED`); admin can override per provider via a **model dropdown** populated live from the saved key (`GET /admin/ai-providers/:provider/models` → Anthropic `client.models.list`, admin-only, requires a configured key) — no more free-text model entry. **Context & personality**: optional admin-authored `ai_provider_keys.system_context` (nullable) is prepended to the system prompt of every generation to tune voice/values; admins can have the AI draft this field itself via `POST /admin/ai-providers/:provider/assist-context` (admin-only, requires a saved key, same rate limiter).

- **Code review remediation (CODE_REVIEW.md)**: Most S/F/B findings are implemented (CORS allowlist + Origin/Referer CSRF, helmet, asset ownership check, email HTML-escaping, hot + composite DB indexes via `CODE_REVIEW_*` migrations, Postgres-backed rate-limit store, feed virtualization/memoization, image `loading=lazy`/`decoding=async`, post-stats batch caps, log redaction of recipient emails). Intentional deviations to keep: (1) the `kinectem_session` cookie stays `SameSite=None; Secure` — do NOT switch to `Lax` (S1/S8 literal advice) because the Replit preview runs in a cross-site iframe; CSRF is covered by CORS allowlist + Origin/Referer. (2) Cursor pagination (F2, org-list B5) is blocked — `lib/api-spec/openapi.yaml` is locked and lacks cursor params on `/notifications`, `/follow-requests`, `/teams/:id/members`, `/organizations/:id/teams`. (3) Missing optional secrets (e.g. `AI_KEYS_ENCRYPTION_KEY`, S8/S9) WARN at boot, they do not hard-fail (avoids bricking deploys; `SESSION_SECRET` fallback is ≥32 chars). Deferred as low-value/high-risk: F1 roster virtualization, B4 feed flatten, S11, S14, F5.

## Paused work

- **Task #505 — Pre-launch hardening** (paused). Five-step launch checklist before pointing `www.kinectem.com` at the Replit Deployment: (1) Managed Postgres cutover (Neon) with backups+PITR, (2) Object storage for uploads, (3) Scheduled COPPA + backfill jobs (Replit Scheduled Deployments), (4) Shared-state rate limiting across Autoscale instances (replace in-memory `signupLimiter`), (5) Custom domain + `LAUNCH.md` runbook. Task spec at `.local/tasks/task-505.md`. No code changes started — resume by re-prompting #505.

## Pointers

- [pnpm-workspace skill](https://www.pnpm.io/workspaces)
- [TypeScript Project References](https://www.typescriptlang.org/docs/handbook/project-references.html)
- [API Conventions](API_CONVENTIONS.md)
- [Scalar API Reference React](https://github.com/scalar/scalar/tree/main/packages/api-reference-react)
- [Tanstack Query](https://tanstack.com/query/latest)