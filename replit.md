# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Houses **Kinectem**, a youth-sports
social platform. The Express API server in `artifacts/api-server` is the
real backend (Postgres + Drizzle), wrapped by `express-openapi-validator`
against `lib/api-spec/openapi.yaml`. Auth is a server-issued cookie session
named `kinectem_session` (set by `POST /auth/login` / `/auth/signup`).
For mobile/external clients, `POST /auth/token` issues short-lived bearer
access + refresh tokens (task #355). For server-to-server developer
integrations, `POST /auth/api-keys` mints long-lived **API keys** (task
#358) — sent as `Authorization: Bearer kk_…`, distinguished from access
tokens by the `kk_` prefix and resolved against the `api_keys` table by
sha256 hash. Plaintext is shown exactly once at create time.

A standalone, exportable client SDK lives at `exports/kinectem-sdk/`
(outside the pnpm workspace so it can be packed and dropped into a
separate mobile project). Source in `src/`, ESM build emits to `dist/`
via `tsc`. Bundles a JSON copy of the public OpenAPI spec at
`openapi.json` for end-to-end type generation downstream. Build + pack
with `cd exports/kinectem-sdk && npm install --no-save typescript && npm pack`.

The OpenAPI spec is the **single source of truth** — see `API_CONVENTIONS.md`
for the contract every endpoint follows (errors are `{ error, code }`,
lists are `{ data, pagination: { nextCursor, hasMore, totalCount } }`,
naming is camelCase, etc.). The typed React-Query client and Zod
schemas are generated from the spec.

## COPPA Phase 1 (task #359)

Under-13 accounts go through a two-step "email plus" parental consent
flow before they can sign in. Schema additions on `users`: `isMinor`,
`accountStatus` (`active|disabled|pending_guardian|pending_revocation`),
`consentFinalizedAt`, `consentRevokedAt`. New tables: `parentalConsents`
(snapshot of notice version + text + IP + guardian email/userId + state)
and `consentAuditLog` (append-only).

Endpoints (under `/api/v1/auth`):
`POST /age-check` (sets signed `kinectem_age_gate` cookie),
`GET/POST /guardian-consent/{token}` (notice + first leg),
`POST /guardian-consent/{token}/finalize` (second-email leg, activates
account), `POST /guardian-revoke/{token}` (one-click revoke). Legacy
`/auth/guardian-confirm` remains for the old in-app guardian flow.

Server-side enforcement (`src/lib/coppa.ts`):
`blockMinorAction`/`blockIfEitherMinor` (used by messages, comments,
profile-PII writes) and `filterOutMinors` (used by `/search` and
follower listings). Asset uploads by minors restricted to JPEG/PNG with
EXIF/GPS/XMP/IPTC/ICC stripped via `src/lib/exif-strip.ts`. All blocks
return `{ error, code: "MINOR_BLOCKED", minorBlocked: true }`.

Frontend (`artifacts/kinectem`): age-gate runs as part of `SignUpForm`
before POSTing `/auth/signup`. Pages: `/guardian-consent/:token`,
`/guardian-consent/:token/finalize`, `/guardian-revoke/:token`,
`/privacy-policy`, `/coppa-notice`. Keep `/coppa-notice` wording in
sync with `CONSENT_NOTICE_TEXT` in `artifacts/api-server/src/lib/coppa.ts`.

## COPPA Phase 2 (task #363)

Layers guardian-mediated communication controls on top of Phase 1.
Schema additions: `moderationStatus` (`approved | pending | declined`)
+ `decidedByGuardianId` + `decidedAt` columns on `userFollowers`,
`postComments`, `messages`; new `dmAllowlist` table
(`childUserId, counterpartyUserId, addedByGuardianId, note`); extended
`accountStatusEnum` and `consentAuditEventEnum`. Migration
`2026-05-06-task-363-coppa-phase-2`.

Server gating helpers in `src/lib/coppa.ts`: `gateFollowOfMinor`,
`gateCommentOnMinorPost`, `gateDmToRecipient` (allowlist short-circuits
to approved), `notifyGuardianOfPendingItem`. Wired into
`organizations.ts` (POST follow), `posts.ts` (comment create + comment
list filter — guardian sees pending, others see approved only),
`messages.ts` (POST conversations + sendMessage + list filter), and
`follows.ts` (followers list filter).

Guardian-only routes in `src/routes/guardians-coppa.ts` mounted by
`routes/index.ts`, all authorized by `users.parentId === me.id`:
`GET /guardians/children/{childId}/pending-{follows,dms,comments,tags}`,
`POST .../pending/{kind}/{id}/{approve|decline}`, `GET/POST/DELETE
.../dm-allowlist[/:counterpartyUserId]`, `GET .../activity`,
`GET .../export`, `POST .../revoke-consent`,
`POST .../regrant-consent`. These endpoints are not in the OpenAPI
spec — there is no openapi-validator middleware, so frontend calls
them directly via `customFetch` from `@workspace/api-client-react`.

Frontend: a new `MinorControls` card on `GuardianPage` renders pending
queues, approve/decline buttons, the DM allowlist editor, and
Export / Pause / Re-activate actions per linked child.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API server**: Express 5 with `express-openapi-validator` against
  `lib/api-spec/openapi.yaml` (~145 ops). The spec also drives `/api/docs`
  (Scalar). Routes are split by domain under
  `artifacts/api-server/src/routes/` (e.g. `users.ts`, `posts.ts`,
  `messages.ts`, `guardians.ts`, …) and mounted by `routes/index.ts`.
  Cross-cutting helpers live in `src/lib/` (`post-stats.ts`,
  `article-tagging.ts`, `team-follow.ts`, `guardian-confirmations.ts`,
  `spec-helpers.ts`); auth middlewares live in `src/middlewares/auth.ts`.
  Errors flow through the `apiError` helper in `src/lib/spec-helpers.ts`
  (returns `{ error, code, ...extras }`).
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
  Samples, **API Keys** (self-serve key management UI at `/dev-portal/api-keys`,
  task #358 — uses generated React Query hooks + cookie session, with an
  inline email/password sign-in form for visitors who aren't already logged
  in to Kinectem), Changelog. The OpenAPI spec is the source of truth: a `predev`/
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
- **Org membership roles** (task #208): `organization_admins.role` is one of
  `owner | admin | member`. Every org has exactly one `owner`. `canManageOrganization`
  gates writes to `inArray(role, ['owner','admin'])`. Use
  `useUpdateMemberRole` / `useRemoveMember` / `useTransferOrganizationOwnership`
  for membership admin; the owner cannot demote/remove themselves — transfer
  ownership first (atomic swap). Approving a join request takes an optional
  `role` (`member` default, `admin` opt-in). `useListMembers` returns every
  member with their real role; sort order is owner → admin → member.
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
