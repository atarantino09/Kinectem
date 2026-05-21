# Kinectem

Kinectem is a youth-sports social platform enabling users to connect, share updates, and manage team activities.

## Run & Operate

- `pnpm run typecheck`: Run full typecheck across all packages.
- `pnpm --filter @workspace/api-spec run codegen`: Regenerate API hooks and Zod schemas from the OpenAPI spec.
- `pnpm --filter @workspace/api-server run dev`: Start the Prism mock server.
- `pnpm --filter @workspace/kinectem run dev`: Start the web application.
- `pnpm --filter @workspace/scripts run backfill-parent-team-follows`: Backfill `team_followers` so every parent of a rostered child is auto-following that team (idempotent).
- `pnpm --filter @workspace/scripts run backfill-self-team-follows`: Backfill `team_followers` so every user with an accepted roster entry is auto-following that team (idempotent).

**Required Environment Variables**: _Populate as you build_

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
- **COPPA notification kinds**: Guardian-side bell uses `child_pending_follow|dm|comment|tag|takedown` linking to `/family?childId=<id>&tab=pending`, plus `guardian_takedown_approved|declined` (Task #369) linking to `/family?childId=<id>` (no `tab=pending` since the item is no longer pending). Admin-side bell uses `admin_takedown_filed` linking to `/admin/moderation`. coppa.ts is locked, so all of these inserts live in the relevant route file (`guardians-coppa.ts` for filings, `admin.ts` `decideTakedown` for decisions).
- **SendGrid wired via Replit connector (Task #480)**: `src/lib/email.ts` `resolveCredentials()` pulls `api_key` + `from_email` from the Replit `sendgrid` connector proxy on every send (no caching — proxy tokens rotate). Falls back to `SENDGRID_API_KEY` + `EMAIL_FROM` env vars for local dev / CI / tests. `isEmailConfigured()` is sync best-effort: true when env vars are set OR when the connector hostname + repl-identity token are present (actual proxy reachability is verified at send time). The connector is the source of truth for the verified sender — do NOT also set `EMAIL_FROM` in Secrets, that would silently override the connector. `APP_BASE_URL` is still env-only (used by `buildPasswordResetUrl` / `buildGuardianConfirmUrl` / etc); when unset, falls back to `https://${REPLIT_DEV_DOMAIN}` for dev, then `http://localhost:5173`.
- **Guardian-confirm tokens hashed at rest**: `users.guardian_confirm_token_hash` stores SHA-256 hex of the raw token; the raw token only ever leaves the server in the parent's email. Use `hashToken()` from `src/lib/passwords.ts` when persisting and when looking up a submitted token. Migration `2026-05-06-task-32-hash-guardian-tokens` enables `pgcrypto` for the one-time backfill.
- **Parent auto-follows child's team (Task #394)**: Whenever a child is placed on a roster as a result of a guardian-driven flow (parent-inbox `POST /invites/:token/children`, coach-add-member `POST /teams/:teamId/members`, coach-invite-by-email, or guardian search-and-link `POST /users/me/children`), the parent is auto-inserted into `team_followers` via `ensureTeamFollowedAsGuardian` / `backfillTeamFollowsForLinkedChild` (`src/lib/team-follow.ts`). `GET /users/:userId/teams` then unions roster-derived rows with these "via child" follows and emits a synthetic membership row with `role: "member"`, `position: "parent"` (the wire marker), `id: teamId`. Frontend `UserProfilePage` renders a "Parent" badge next to the org badge when `position === "parent"`. Idempotent: all inserts use `onConflictDoNothing`. Existing data is backfilled with `pnpm --filter @workspace/scripts run backfill-parent-team-follows`.
- **Guardian capability is link-derived, not role-derived (Task #400)**: Access to the Family dashboard and the guardian-only endpoints (`POST /users/me/children`, `GET /users/me/children`, expired-confirmation notifications) is gated on "this user has at least one row in `users` with `parentId = me.id`", NOT on `role === "parent"`. Use `isGuardian(userId)` / `countLinkedChildren(userId)` from `src/lib/guardian-capability.ts`. `GET /auth/whoami` exposes `isGuardian: boolean` and `linkedChildrenCount: number` (computed from the effective session user) so the web client can render the Family nav item and the dashboard page guard for any role. The frontend guard in `GuardianPage.tsx` and `Layout.tsx` reads `whoami.isGuardian`; signed-in users without linked children see a friendly empty-state card on `/family` (with the existing `LinkChildSearch` CTA) instead of the old "only available to parent or guardian accounts" hard block. `authorizeChildAccess` / `authorizeGuardianForChild` still gate per-child on the actual `parentId` link (and on guardian confirmation for under-13s) — only the role gate was removed.
- **Parent-driven guardian-confirm recovery (Task #371)**: `POST /auth/guardian-resend-by-email` (`{ guardianEmail }`, no auth) is the recovery action surfaced on `/guardian-confirm/<token>` when the link is dead. It always returns the same generic `{ ok: true, message }` 200 — never branch on it for account existence. Server looks up under-13 users by `guardianEmail` with `guardianConfirmedAt` null, rotates the token hash + expiry, and re-sends `sendGuardianConfirmationEmail`. Reuses `signupLimiter`.

## Paused work

- **Task #505 — Pre-launch hardening** (paused). Five-step launch checklist before pointing `www.kinectem.com` at the Replit Deployment: (1) Managed Postgres cutover (Neon) with backups+PITR, (2) Object storage for uploads, (3) Scheduled COPPA + backfill jobs (Replit Scheduled Deployments), (4) Shared-state rate limiting across Autoscale instances (replace in-memory `signupLimiter`), (5) Custom domain + `LAUNCH.md` runbook. Task spec at `.local/tasks/task-505.md`. No code changes started — resume by re-prompting #505.

## Pointers

- [pnpm-workspace skill](https://www.pnpm.io/workspaces)
- [TypeScript Project References](https://www.typescriptlang.org/docs/handbook/project-references.html)
- [API Conventions](API_CONVENTIONS.md)
- [Scalar API Reference React](https://github.com/scalar/scalar/tree/main/packages/api-reference-react)
- [Tanstack Query](https://tanstack.com/query/latest)