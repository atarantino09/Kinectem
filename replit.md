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
- **Minor Profile Visibility**: Minor profiles are private by default (`followers` visibility on signup). Access is restricted to self, guardian, admin, or approved followers/team members. Same carve-out applies to `GET /users/:userId/posts`.
- **Minor Content Takedown**: `GET /posts/:postId`, `/feed`, and `/users/:userId/posts` exclude any article/highlight with a `pending` `takedown_requests` row, except for the requesting guardian and platform admins. Guardian-filed takedowns require the child be linked to the post (author/uploader or tagged).
- **Right-to-delete**: Guardians call `POST /guardians/children/:childId/request-deletion` (idempotent — first call stamps `deletion_requested_at`). Operator runs `pnpm --filter @workspace/scripts run coppa:delete -- <userId> --apply` to hard-delete after the cooling-off window (default 24h, override `COPPA_DELETION_GRACE_HOURS`).
- **Minor recommendations**: `/posts/follow-suggestions` filters out minors via `filterOutMinors` so children never surface in stranger recommendation flows.
- **Article Re-shares**: Sharing your own recap is a visual no-op on your own profile due to merge logic prioritizing authored content.
- **Avatar Rendering**: Always use `<UserAvatar>` or `<TeamAvatar>` components; do not compose Radix avatars directly to avoid loading state issues.

## Pointers

- [pnpm-workspace skill](https://www.pnpm.io/workspaces)
- [TypeScript Project References](https://www.typescriptlang.org/docs/handbook/project-references.html)
- [API Conventions](API_CONVENTIONS.md)
- [Scalar API Reference React](https://github.com/scalar/scalar/tree/main/packages/api-reference-react)
- [Tanstack Query](https://tanstack.com/query/latest)