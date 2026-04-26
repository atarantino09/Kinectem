# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Houses **Kinectem**, a youth-sports
social platform. The Express API server in `artifacts/api-server` is the
real backend (Postgres + Drizzle), wrapped by `express-openapi-validator`
against `lib/api-spec/openapi.yaml`. Auth is a server-issued cookie session
named `kinectem_session` (set by `POST /auth/login` / `/auth/signup`).

The OpenAPI spec is the **single source of truth** — see `API_CONVENTIONS.md`
for the contract every endpoint follows (errors are `{ error, code }`,
lists are `{ data, pagination: { nextCursor, hasMore, totalCount } }`,
naming is camelCase, etc.). The typed React-Query client and Zod
schemas are generated from the spec.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API server**: Express 5 with `express-openapi-validator` against
  `lib/api-spec/openapi.yaml` (~145 ops). The spec also drives `/api/docs`
  (Scalar). All routes live in `artifacts/api-server/src/routes/spec.ts`
  (the modular files like `routes/users.ts` are dead code — `routes/index.ts`
  only exports `specRouter`). Errors flow through the `apiError` helper in
  `src/lib/spec-helpers.ts` (returns `{ error, code, ...extras }`).
- **Web frontend**: React + Vite + Tailwind + shadcn/ui + wouter + tanstack-query
- **API codegen**: Orval — generates a typed `react-query` client into
  `lib/api-client-react/src/generated` and matching Zod schemas into
  `lib/api-zod/src/generated`.

## Artifacts

- `artifacts/api-server` — Express + Drizzle + Postgres backend.
  `prefix-spec.mjs` rewrites the spec to add the `/api/v1` prefix
  (the prefixed copy is loaded by `express-openapi-validator` and the
  Scalar docs at `/api/docs`).
- `artifacts/kinectem` — the web app. Pages: Feed, Search, Organizations list,
  Organization, Team, User profile, Post, NewPost. Header has a notifications bell
  (`useGetUnreadNotificationCount` + `useListNotifications`). Post cards in the
  feed have inline like + comment-count buttons (reaction-toggle invalidates
  `getListFeedQueryKey()`).
- `artifacts/dev-portal` — public Kinectem Developer Portal at `/dev-portal`.
  React + Vite + Tailwind, distinct cream/terracotta visual identity (separate
  from kinectem's purple-blue). Pages: Overview, Getting Started, Authentication,
  Conventions, API Reference (Scalar via `@scalar/api-reference-react`), Code
  Samples, Changelog. The OpenAPI spec is the source of truth: a `predev`/
  `prebuild` script (`scripts/copy-spec.mjs`) copies
  `lib/api-spec/openapi.yaml` into `public/openapi.yaml` so Scalar fetches it
  at runtime. Code samples and conventions content is hand-authored to mirror
  `API_CONVENTIONS.md`.
- `artifacts/mockup-sandbox` — design sandbox.

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks + Zod schemas
  from the OpenAPI spec. The script also rewrites `lib/api-zod/src/index.ts` to a single
  barrel export to avoid duplicate-symbol errors between `generated/api.ts` (zod
  schemas) and `generated/types/*` (TS types) which orval emits with the same names.
- `pnpm --filter @workspace/api-server run dev` — start the Prism mock
- `pnpm --filter @workspace/kinectem run dev` — start the web app

## API client conventions

- All hooks use **`useGetLoggedInUser()`** for the current session user — never hardcode
  a user UUID.
- The home feed uses **`useListFeed()`**.
- Search uses **`useCrossEntitySearch({ q, limit })`** and returns
  `{ users, organizations, teams }` sections.
- Reactions/comments on posts use `useAddPostReaction`, `useRemovePostReaction`,
  `useListPostComments`, `useCreatePostComment`, `useDeletePostComment`. Invalidate
  with `getGetPostQueryKey(postId)` and `getListPostCommentsQueryKey(postId)` after
  mutations.
- **Asset uploads** use a 3-step flow: `requestUpload({fileName, fileType, fileSize})`
  → `PUT uploadUrl` (raw bytes, `Content-Type` matching `fileType`,
  `credentials: include`) → `confirmUpload(assetId)`. Confirmed asset ids can be
  attached to a new conversation via `createConversation({ message: { assetIds } })`
  or to a follow-up message via `sendMessage({ data: { assetIds } })`. Max 10
  attachments per message; uploads cap at 10 MB. The dev server stores the binary
  as a base64 `data:` URL on the asset row, so `MessageAsset.url` is consumable
  directly by an `<img src>` in the UI.

## Design system

- Brand: purple→blue gradient (`brand-gradient`, `brand-gradient-dark` utilities).
- Typography: `font-black tracking-tight` for headings; `rounded-xl` cards. No emojis.
- **Avatars**: always use `<UserAvatar>` / `<TeamAvatar>` from
  `artifacts/kinectem/src/components/UserAvatar.tsx`. Don't compose Radix
  `Avatar + AvatarImage + AvatarFallback` directly, and never gate
  `<AvatarImage>` with `avatarUrl && ...` — the conditional pattern leaves
  small avatars stuck on the fallback because Radix's loading state never
  sees the image mount. The wrapper renders `<AvatarImage>` unconditionally
  so it just works.

## Routing gotcha (api-server)

`artifacts/api-server/src/routes/index.ts` mounts ONLY `admin` and `spec.ts`.
The standalone files `routes/users.ts`, `routes/notifications.ts`, and
`routes/invites.ts` are NOT mounted — any handlers in them are dead code.
All real route logic lives in `routes/spec.ts`. When adding behavior to an
existing endpoint, edit it in `spec.ts`, not in the matching standalone
file. (If you ever need to revive those, mount them in `routes/index.ts`.)

## Roster status mapping

The DB column `roster_entries.status` uses `accepted | pending | declined`,
but the public team-member API representation maps `accepted → "active"`
and everything else → `"pending"` via `toTeamMember` in
`lib/spec-helpers.ts`. Tests and clients should expect `"active"` from
`/teams/:teamId/members*` and `/users/:userId/teams` responses, not
`"accepted"`.

## Article re-shares (task #162)

Game-recap articles (and only articles — not highlights or org posts) can
be re-shared by any logged-in viewer. Schema lives in `lib/db/src/schema`
as the `postShares` table (`articleId`, `sharerUserId`, `createdAt`,
unique `(articleId, sharerUserId)`). The `PostResponse` / `FeedPost`
schemas carry `shareCount`, `hasShared`, `sharedBy`, `sharedAt`. Endpoints:
`POST /posts/:postId/share` and `DELETE /posts/:postId/share` (both
idempotent, 204; non-article kinds → 400; article-not-visible → 404).
Shared recaps surface on the sharer's profile Posts tab and home feed
(plus the home feed of users who follow them) with a "Shared by …"
header. Authored or tag-surfaced rows win over share rows in the merge,
so sharing your own recap is a visual no-op on your own profile.

See the `pnpm-workspace` skill for workspace structure and TypeScript project references.
