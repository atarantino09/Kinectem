# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Currently houses **Kinectem**, a youth-sports
social platform whose frontend is fully built against a **mock OpenAPI contract** served
by Stoplight Prism. There is no real backend, no real auth — auth is a stubbed Bearer
header injected by the React fetch mutator.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Mock API server**: `@stoplight/prism-cli` mocking `lib/api-spec/openapi.yaml` (141 ops)
- **Web frontend**: React + Vite + Tailwind + shadcn/ui + wouter + tanstack-query
- **API codegen**: Orval — generates a typed `react-query` client into
  `lib/api-client-react/src/generated` and matching Zod schemas into
  `lib/api-zod/src/generated`.

## Artifacts

- `artifacts/api-server` — Prism mock; `prefix-spec.mjs` rewrites the spec to add the
  `/api/v1` prefix, then Prism boots on `$PORT`.
- `artifacts/kinectem` — the web app. Pages: Feed, Search, Organizations list,
  Organization, Team, User profile, Post, NewPost.
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

## Design system

- Brand: purple→blue gradient (`brand-gradient`, `brand-gradient-dark` utilities).
- Typography: `font-black tracking-tight` for headings; `rounded-xl` cards. No emojis.

See the `pnpm-workspace` skill for workspace structure and TypeScript project references.
