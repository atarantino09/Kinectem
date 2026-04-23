# Kinectem

> A youth sports social platform connecting athletes, coaches, parents, and organizations.

<!-- BADGES: replace with real CI / coverage / license badges when available -->
![status](https://img.shields.io/badge/status-in%20development-blue)
![license](https://img.shields.io/badge/license-TBD-lightgrey)
![pnpm](https://img.shields.io/badge/pnpm-monorepo-orange)

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Monorepo Layout](#monorepo-layout)
- [Prerequisites](#prerequisites)
- [Environment Variables](#environment-variables)
- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [API Reference](#api-reference)
  - [Conventions](#conventions)
  - [Health](#health)
  - [Auth](#auth)
  - [Current User](#current-user)
  - [Users](#users)
  - [Organizations](#organizations)
  - [Teams & Rosters](#teams--rosters)
  - [Invites](#invites)
  - [Feed & Posts](#feed--posts)
  - [Drafts & Co-authors](#drafts--co-authors)
  - [Notifications](#notifications)
  - [Conversations & Messages](#conversations--messages)
  - [Tags & Consent](#tags--consent)
  - [Parents & Children](#parents--children)
  - [Search](#search)
  - [Misc & Stubs](#misc--stubs)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

Kinectem is a youth sports social platform that brings together the people who make youth athletics work — athletes, coaches, parents, and the organizations that run leagues and clubs. The product centers on team rosters, game recaps, video highlights, and a moderated social feed scoped to the organizations and teams a user belongs to or follows.

The platform is built as a TypeScript monorepo with three primary artifacts: a web client (Vite + React), a REST API server (Express), and a design / mockup sandbox.

## Features

- **Athlete, coach, parent, and admin roles** with parent ↔ child account linking and youth-safety guardrails (e.g. under-13 accounts require a guardian).
- **Organizations & teams** with admin / member / follower relationships, join links, and email invites.
- **Roster invites** for both registered users and email-only invitees, including parent-mediated player onboarding for minors.
- **Game recaps (long-form articles)** with drafts, co-authors, an admin approval workflow, and a published feed.
- **Video highlights** uploaded against teams and surfaced into the feed.
- **Tagging** of users in posts with player-removable tags and consent toggles for guardians.
- **Notifications** with unread counts, mark-as-read, and email opt-out.
- **Cross-entity search** for users, organizations, and teams.
- **Session-based auth** via signed cookies, with a parent / guardian linkage model for minors.

## Tech Stack

| Area | Technology |
| --- | --- |
| Package manager | pnpm (workspaces) |
| Language | TypeScript ~5.9 |
| Web client | React 19 + Vite 7, Tailwind CSS 4, Radix UI, TanStack Query, Wouter |
| API server | Express 5, Pino, cookie-parser, CORS |
| Validation | Zod (shared `@workspace/api-zod`) |
| Database | PostgreSQL via Drizzle ORM (shared `@workspace/db`) |
| Generated client | `@workspace/api-client-react` (typed client consumed by the web app) |
| Tooling | tsx, esbuild, Prettier |

## Monorepo Layout

The workspace is managed by `pnpm` and configured via [`pnpm-workspace.yaml`](./pnpm-workspace.yaml). Packages live in three top-level directories:

```
.
├── artifacts/          # User-facing apps and services
│   ├── kinectem/       # Web client (React + Vite)         → preview path: /
│   ├── api-server/     # REST API server (Express)         → preview path: /api
│   └── mockup-sandbox/ # Design / component preview canvas → preview path: /__mockup
├── lib/                # Shared internal packages
│   ├── api-spec/       # OpenAPI / spec sources
│   ├── api-zod/        # Zod schemas shared between server and client
│   ├── api-client-react/ # Typed React client
│   └── db/             # Drizzle schema, client, and migrations
├── scripts/            # Workspace-wide scripts
├── package.json        # Root scripts (build, typecheck)
├── pnpm-workspace.yaml # Workspace + catalog configuration
└── tsconfig.base.json  # Shared TS config
```

Each artifact is registered with the Replit workspace and served behind a path prefix (the API server is reached at `/api`).

## Prerequisites

- **Node.js** 20+
- **pnpm** 9+ (the workspace blocks `npm install` and `yarn install` via a `preinstall` guard)
- **PostgreSQL** database (connection string supplied via `DATABASE_URL`)

## Environment Variables

The API server reads the following environment variables. Add them via your runtime / secret manager (for local Replit development they are set in the workspace's environment).

| Variable | Required | Description |
| --- | --- | --- |
| `PORT` | yes | Port the API server (and each artifact's dev server) binds to. The API server throws on startup if missing. |
| `BASE_PATH` | yes (web) | Public path prefix the Kinectem web client is served under (consumed by `artifacts/kinectem/vite.config.ts`). Vite exposes this to the app at runtime as `import.meta.env.BASE_URL`. |
| `DATABASE_URL` | yes | Postgres connection string used by `@workspace/db` (Drizzle). |
| `NODE_ENV` | no | Standard Node environment flag (`development` / `production`). When set to `production`, the interactive API docs (`/api/docs`, `/api/openapi.json`, `/api/openapi.yaml`) are no longer publicly browsable — see [Interactive docs](#interactive-docs). |
| `DOCS_ACCESS_TOKEN` | no | Optional shared secret for accessing the docs in production without a session. Callers present it via the `x-docs-token` header or `?docs_token=<value>` query string. If unset, only authenticated sessions can reach the docs in production. |

The web client reads its base path from `BASE_PATH` (build-time, via Vite) and reaches the API through the generated `@workspace/api-client-react` client; no additional client-side secrets are required at build time.

## Getting Started

Install all workspace dependencies:

```bash
pnpm install
```

Run the full workspace in development (each artifact's dev workflow is started by the Replit runtime). To run an individual artifact directly:

```bash
# Web client
pnpm --filter @workspace/kinectem dev

# API server
pnpm --filter @workspace/api-server dev
```

Type-check everything:

```bash
pnpm typecheck
```

Build all packages:

```bash
pnpm build
```

## Project Structure

Within the API server (`artifacts/api-server`):

```
src/
├── index.ts          # Entry — reads PORT, seeds DB, starts Express
├── app.ts            # Express app: middleware, /api/healthz, mounts /api/v1 router
├── routes/
│   ├── index.ts      # Re-exports the spec router
│   └── spec.ts       # All /api/v1 endpoints (single-file router)
├── lib/
│   ├── auth.ts          # Session cookies, loadSession, requireAuth
│   ├── permissions.ts   # canManageOrganization, canManageTeam, isTeamMember, canCreateRecap
│   ├── spec-helpers.ts  # Shape helpers (toPublicUser, articleToPost, paginate, …)
│   ├── async-handler.ts # Thin Express async wrapper
│   ├── seed.ts          # Initial DB seed when empty
│   └── logger.ts        # Pino logger
└── middlewares/
```

Within the web client (`artifacts/kinectem/src`): standard Vite + React layout with Tailwind and Radix-based components. The client talks to the API via the generated `@workspace/api-client-react` package.

---

## API Reference

### Interactive docs

A live, "try it out" reference is generated from `lib/api-spec/openapi.yaml` and served by the API server itself:

- **Docs UI** (Scalar): [`/api/docs`](http://localhost:8080/api/docs)
- **OpenAPI (JSON)**: [`/api/openapi.json`](http://localhost:8080/api/openapi.json)
- **OpenAPI (YAML)**: [`/api/openapi.yaml`](http://localhost:8080/api/openapi.yaml)

The spec is regenerated automatically on `pnpm --filter @workspace/api-server run dev` and `… run build` (via the `prefix-spec.mjs` script, which prefixes every path with `/api/v1` and injects example values). To regenerate it manually, run `pnpm --filter @workspace/api-server run prefix-spec`.

**Access control.** In development (`NODE_ENV !== "production"`) the docs UI and the raw spec endpoints are open, just as before. In production (`NODE_ENV === "production"`) all three routes are protected and require one of:

- A valid signed-in session (any role) — the request must carry the `kinectem_session` cookie; or
- A shared secret matching the `DOCS_ACCESS_TOKEN` environment variable, presented either as the `x-docs-token` request header or the `docs_token` query string parameter (e.g. `/api/docs?docs_token=…`).

Unauthenticated requests in production receive `401 { "error": "Authentication required" }`. If `DOCS_ACCESS_TOKEN` is unset, only signed-in users can reach the docs in production. When you load `/api/docs?docs_token=…` (without a session), the rendered HTML automatically forwards the same token to its `/api/openapi.json` request, so the interactive UI loads end-to-end.

### Conventions

- **Base URL**: all spec endpoints are mounted under `/api/v1`. A separate liveness endpoint is exposed at `/api/healthz`.
- **Auth model**: session-based. `POST /api/v1/auth/login` and `POST /api/v1/auth/signup` set a signed `kinectem_session` cookie. The server's `loadSession` middleware hydrates `req.sessionUser` from that cookie on every request. As a development convenience, many endpoints (both reads and writes) use a `getOrFallbackUser` helper that resolves to a seeded default athlete when no session is present, so unsigned requests can still succeed in dev environments. The "Auth" column in the tables below reflects the intended production policy; in development the fallback may relax this.
- **Authorization**: ownership and admin checks are enforced per resource via `permissions.ts` (organization admin, team coach, post author, parent linkage). Where relevant, endpoints return `403 Forbidden`.
- **Content type**: requests and responses are JSON unless noted.
- **Error shape**: errors are returned as `{ "error": "<message>" }` with an appropriate HTTP status (`400`, `401`, `403`, `404`, `409`).
- **Pagination**: list endpoints return `{ "data": [...], "pagination": { ... } }`. The current implementation returns an empty pagination block for forward-compatibility; clients should treat `data` as the page contents.
- **IDs**: most resources use UUIDs. Posts use a prefixed composite id (`article-<uuid>` or `highlight-<uuid>`) so the same `/posts/:postId` endpoints can address both content kinds.
- **Auth column legend**: _Public_ = no session needed · _Optional_ = session honored if present, otherwise falls back · _Session_ = `401` if not signed in · _Admin/Coach/Author_ = additional role check on top of session.

In the tables below, paths are relative to the `/api/v1` prefix unless they explicitly say `/api/healthz`.

---

### Health

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/api/healthz` | Public | App-level liveness probe. Returns `{ ok: true }`. |
| `GET` | `/health` | Public | Spec-router health check. Returns `{ ok: true }`. |

---

### Auth

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `POST` | `/auth/login` | Public | Log in as an existing user. Body: `{ userId: uuid }`. Sets the session cookie. Returns the private user. |
| `POST` | `/auth/signup` | Public | Create a new account and log in. Body: `{ firstName, lastName?, role: "athlete"\|"coach"\|"admin"\|"parent", email?, dateOfBirth?, parentId? }`. Players under 13 must include `parentId`. Returns `409` if the email is already in use. |
| `POST` | `/auth/logout` | Optional | Destroys the current session (if any) and clears the cookie. `204 No Content`. |
| `GET` | `/auth/users` | Public | Dev helper: lists up to 100 users for the login picker. Returns `{ id, firstName, lastName, role, email, avatarUrl, sport, position }[]`. |

---

### Current User

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/users/me` | Optional | Returns the current user (private shape). Falls back to a default athlete in dev when no session is present. |
| `GET` | `/users/me/settings` | Public | Returns user settings (e.g. `share_to_facebook_default`). |
| `PATCH` | `/users/me/settings` | Public | Update user settings. Body mirrors the GET response shape. |
| `GET` | `/users/me/tags` | Optional | Lists tags (article + highlight) where the current user is tagged. |
| `PATCH` | `/users/me/tag-consent` | Session | Update tag-consent flag. Body: `{ requireTagConsent: boolean }`. |
| `GET` | `/users/me/children` | Session | List children linked to the current user. |
| `POST` | `/users/me/children` | Session (parent role) | Link an existing user as a child. Body: `{ childId: uuid }`. `409` if already linked elsewhere. |
| `PATCH` | `/users/me/children/:childId/visibility` | Session | Toggle a child's `requireTagConsent`. Body: `{ requireTagConsent: boolean }`. |

---

### Users

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/users` | Public | List / search users. Query: `q` (optional name or email substring), `role` (optional role filter). Returns up to 20 paginated user summaries. |
| `GET` | `/users/:userId` | Optional | Get a user profile. Linked-account (parent/child) info is only included if the requester is the user themself, a linked parent/child, or an org admin of an org the user belongs to. |
| `PATCH` | `/users/:userId` | Public | Update profile fields. Body: `{ firstName?, lastName?, bio? }`. |
| `GET` | `/users/:userId/posts` | Public | Paginated published articles authored by the user. |
| `GET` | `/users/:userId/organizations` | Public | Orgs the user is a member of, admin of, or follows. |
| `GET` | `/users/:userId/teams` | Public | Roster entries for the user across all teams (team, org, role, position, status). |

---

### Organizations

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/organizations` | Public | List organizations (up to 50). |
| `POST` | `/organizations` | Session | Create an organization. Body: `{ name, description?, city?, state? }`. Creator becomes owner/admin/follower. |
| `GET` | `/organizations/:orgId` | Optional | Get an organization with `isMember`, `role`, and `isFollowing` for the current user. |
| `GET` | `/organizations/:orgId/members` | Public | List org admins as members (first admin is treated as owner). |
| `GET` | `/organizations/:orgId/teams` | Public | List teams in the organization with member counts. |
| `POST` | `/organizations/:orgId/teams` | Public | Create a team. Body: `{ name, sport?, level?, season?: { name } }`. |
| `GET` | `/organizations/:orgId/posts` | Public | Paginated published articles for any team in the org. |
| `GET` | `/organizations/:orgId/join-requests` | Org admin | List pending join requests for the organization. |
| `POST` | `/organizations/:orgId/join-requests` | Session | Create a join request. Body: `{ requestedRole?: "follower" \| "admin", message? }`. |
| `POST` | `/organizations/:orgId/join-requests/:id/approve` | Org admin | Approve a join request and add the user as admin or follower based on `requestedRole`. |
| `POST` | `/organizations/:orgId/join-requests/:id/decline` | Org admin | Decline a join request. |
| `DELETE` | `/organizations/:orgId/join-requests/:id` | Requester | Withdraw a pending join request. `204 No Content`. |
| `GET` | `/organizations/:orgId/post-approvals` | Org admin | List articles in the org awaiting approval. |
| `POST` | `/organizations/:orgId/post-approvals/:id/approve` | Org admin | Approve a pending article (sets `published`, stamps `publishedAt`). |
| `POST` | `/organizations/:orgId/post-approvals/:id/decline` | Org admin | Decline a pending article (returns it to `draft`). |
| `POST` | `/organizations/:orgId/follow` | Session | Follow the org. Idempotent. |
| `DELETE` | `/organizations/:orgId/follow` | Session | Unfollow the org. `204 No Content`. |
| `GET` | `/organizations/:orgId/privacy` | Public | _Stub_: returns `{ orgId, settings: {} }`. |

---

### Teams & Rosters

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/teams/:teamId` | Public | Get a team with its organization and member count. |
| `PATCH` | `/teams/:teamId` | Org admin | Update team fields (`name`, `sport`, `level`, `description`, `logoUrl`, `bannerUrl`). |
| `GET` | `/teams/:teamId/members` | Public | List roster entries with optional parent-contact info (visible to org admins / fellow team members). |
| `POST` | `/teams/:teamId/members` | Coach or org admin | Add a known user to the roster (status `pending`). Body: `{ userId, position? }`. Sends a roster-invite notification. |
| `DELETE` | `/teams/:teamId/members/:memberId` | Public | Remove a roster entry. `204 No Content`. |
| `POST` | `/teams/:teamId/members/:memberId/accept` | Session (self) | Accept an own pending roster entry. |
| `POST` | `/teams/:teamId/members/:memberId/decline` | Session (self) | Decline (delete) an own pending roster entry. `204 No Content`. |
| `GET` | `/teams/:teamId/posts` | Public | Combined paginated feed of published articles + highlights for the team. |
| `GET` | `/teams/:teamId/seasons` | Public | List seasons for the team (currently a single derived season). |
| `POST` | `/teams/:teamId/join-link` | Org admin | Create or reuse a shareable parent-onboarding invite token for the team. |

---

### Invites

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/teams/:teamId/invites` | Public | List roster invites for the team. |
| `POST` | `/teams/:teamId/invites` | Coach or org admin | Create an email invite. Body: `{ email, name?, position? }`. Returns the invite with its token. |
| `GET` | `/invites/:token` | Public | Look up an invite by token. Returns `{ invite, team, organization }`. |
| `POST` | `/invites/:token/accept` | Session | Accept an invite. Coach invites add the user to the roster; player invites return `{ requiresChildSetup: true, teamId, inviteId }` so the parent can add children next. |
| `POST` | `/invites/:token/children` | Session | After accepting a player invite, create a child user and add them to the roster. Body: `{ firstName, lastName }`. |

---

### Feed & Posts

Posts are addressed by a prefixed id: `article-<uuid>` for long-form recaps and `highlight-<uuid>` for video highlights.

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/feed` | Public | Global merged feed of recent published articles and highlights. |
| `GET` | `/posts/:postId` | Optional | Get a single post. Non-published articles are only visible to the author or an org admin. |
| `POST` | `/posts` | Session | Create a post. Body: `{ postType: "long" \| "short", title?, description?, body?, coverImageUrl?, videoUrl?, photoUrls?, assets?, organizationId?, context? }`. Long posts route through `pending_approval` unless the author is an org admin. |
| `PATCH` | `/posts/:postId` | Author or co-author | Edit an article post. Updatable: `title`, `description`, `body`, `coverImageUrl`, `videoUrl`, `photoUrls`. |
| `POST` | `/posts/:postId/publish` | Author or co-author | Publish a draft. Org admins publish immediately; others move to `pending_approval`. |
| `GET` | `/posts/:postId/comments` | Public | Paginated comments on a post (newest first), with sender display info. |
| `POST` | `/posts/:postId/comments` | Session | Add a comment. Body: `{ body }`. Increments `commentCount`. |
| `DELETE` | `/posts/:postId/comments/:commentId` | Author or org admin | Delete a comment. `204 No Content`. |
| `POST` | `/posts/:postId/reactions` | Session | Add or change a reaction. Body: `{ type: "like" \| "celebrate" \| "support" \| "insightful" }`. Idempotent per user. |
| `DELETE` | `/posts/:postId/reactions` | Session | Remove the current user's reaction. `204 No Content`. |
| `GET` | `/posts/:postId/tags` | Public | List approved tags (article or highlight) on a post with tagger and tagged-user info. |

---

### Drafts & Co-authors

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/drafts` | Optional | List the current user's draft articles (own + co-authored). |
| `GET` | `/posts/:postId/co-authors` | Public | List co-authors for an article. |
| `POST` | `/posts/:postId/co-authors` | Author | Add a co-author. Body: `{ userId }`. Sends a `mention` notification. |
| `DELETE` | `/posts/:postId/co-authors/:userId` | Author or self | Remove a co-author. `204 No Content`. |

---

### Notifications

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/notifications` | Optional | List the user's recent notifications (up to 50). |
| `GET` | `/notifications/unread-count` | Optional | Returns `{ unreadCount }`. |
| `POST` | `/notifications/:notificationId/read` | Public | Mark a single notification as read. `204 No Content`. |
| `POST` | `/notifications/read-all` | Optional | Mark all unread notifications as read. Returns `{ markedCount }`. |
| `GET` | `/notifications/email-preference` | Public | Returns `{ emailOptOut }`. |
| `PUT` | `/notifications/email-preference` | Public | Update email opt-out. Body: `{ emailOptOut: boolean }`. |

---

### Conversations & Messages

Direct conversations are persisted in the database. Each direct conversation is keyed by the (sorted) participant pair so opening a thread with the same recipient twice returns the same conversation.

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/conversations` | Session | Paginated list of the user's conversations with last-message preview and per-user unread count. |
| `GET` | `/conversations/unread-count` | Session | `{ unreadCount }` aggregated across the user's conversations. |
| `POST` | `/conversations` | Session | Open or fetch a direct conversation. Body: `{ recipientId, recipientType?: "user" }`. |
| `GET` | `/conversations/:id` | Session (participant) | Get a single conversation. |
| `DELETE` | `/conversations/:id` | Session (participant) | Leave the conversation (sets `leftAt`). `204 No Content`. |
| `GET` | `/conversations/:id/messages` | Session (participant) | Paginated messages, newest last. |
| `POST` | `/conversations/:id/messages` | Session (participant) | Send a message. Body: `{ body, assets? }`. |
| `POST` | `/conversations/:id/read` | Session (participant) | Mark the conversation read up to now. `204 No Content`. |

---

### Tags & Consent

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/tags/pending` | Session | Paginated tags pending the current user's approval (article + highlight tags where the user is the tagged subject and `status = "pending"`). |
| `POST` | `/tags/:tagId/approve` | Session (tagged user) | Approve a pending tag. Returns `{ id, status: "approved" }`. |
| `POST` | `/tags/:tagId/decline` | Session (tagged user) | Decline a pending tag (sets `status = "declined"`). |
| `DELETE` | `/tags/:tagId` | Session (tagged user or tagger) | Remove a tag. `204 No Content`. |
| `DELETE` | `/article-tags/:tagId` | Session (own tag) | Remove an article tag the user owns. `204 No Content`. |
| `DELETE` | `/highlight-tags/:tagId` | Session (own tag) | Remove a highlight tag the user owns. `204 No Content`. |

(See also [`/users/me/tags`](#current-user) and [`/users/me/tag-consent`](#current-user).)

---

### Parents & Children

See the [Current User](#current-user) section for the parent/child management endpoints (`/users/me/children`, `/users/me/children/:childId/visibility`).

---

### Search

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/search` | Public | Cross-entity search. Query: `q`. Returns `{ users, organizations, teams }` each as a paginated block. Empty `q` returns empty results. |

---

### Misc & Stubs

The following endpoints still return shaped placeholder data and do not yet persist state:

- `GET /organizations/:orgId/privacy` — returns `{ orgId, settings: {} }`.

All other previously-stubbed endpoints (post comments and reactions, post tag listings, tag approval, conversations and messages, organization join requests) are now backed by real database tables. Endpoints that the web client did not use (legacy follow/follower stubs, `/users/:userId/guardians|children|privacy|sports`, `/teams/:teamId/follow`, `/assets/upload`, `/consent/*`) have been removed.

---

## Contributing

1. Use `pnpm` for all installs and scripts. `npm` and `yarn` are blocked by the root `preinstall` guard.
2. Prefer editing existing files and respecting the established structure of each artifact.
3. Run `pnpm typecheck` (and any relevant artifact's `typecheck` / `build` scripts) before sending changes.
4. When adding API endpoints, update both this README's [API Reference](#api-reference) and the shared `@workspace/api-zod` schemas / `@workspace/api-client-react` client as appropriate.
5. Keep secrets and connection strings out of the repo — use the workspace's environment / secret manager.

## License

License: **TBD** — a license file will be added in a future change. Until then, treat this repository as "All rights reserved" by the project owners.
