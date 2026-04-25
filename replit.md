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

See the `pnpm-workspace` skill for workspace structure and TypeScript project references.
