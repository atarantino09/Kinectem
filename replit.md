# Kinectem

Kinectem is a youth-sports social platform enabling users to connect, share updates, and manage team activities.

## Run & Operate

- `pnpm run typecheck`: Run full typecheck across all packages.
- `pnpm --filter @workspace/api-spec run codegen`: Regenerate API hooks and Zod schemas from the OpenAPI spec.
- `pnpm --filter @workspace/api-server run dev`: Start the Prism mock server.
- `pnpm --filter @workspace/kinectem run dev`: Start the web application.

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
- **COPPA notification kinds**: Guardian-side bell uses `child_pending_follow|dm|comment|tag|takedown` linking to `/family?childId=<id>&tab=pending`. Admin-side bell uses `admin_takedown_filed` linking to `/admin/moderation`. The takedown notification is emitted directly in `guardians-coppa.ts` (coppa.ts is locked).
- **Guardian-confirm tokens hashed at rest**: `users.guardian_confirm_token_hash` stores SHA-256 hex of the raw token; the raw token only ever leaves the server in the parent's email. Use `hashToken()` from `src/lib/passwords.ts` when persisting and when looking up a submitted token. Migration `2026-05-06-task-32-hash-guardian-tokens` enables `pgcrypto` for the one-time backfill.
- **Parent-driven guardian-confirm recovery (Task #371)**: `POST /auth/guardian-resend-by-email` (`{ guardianEmail }`, no auth) is the recovery action surfaced on `/guardian-confirm/<token>` when the link is dead. It always returns the same generic `{ ok: true, message }` 200 — never branch on it for account existence. Server looks up under-13 users by `guardianEmail` with `guardianConfirmedAt` null, rotates the token hash + expiry, and re-sends `sendGuardianConfirmationEmail`. Reuses `signupLimiter`.

## Pointers

- [pnpm-workspace skill](https://www.pnpm.io/workspaces)
- [TypeScript Project References](https://www.typescriptlang.org/docs/handbook/project-references.html)
- [API Conventions](API_CONVENTIONS.md)
- [Scalar API Reference React](https://github.com/scalar/scalar/tree/main/packages/api-reference-react)
- [Tanstack Query](https://tanstack.com/query/latest)