# Kinectem

> A youth-sports social platform connecting athletes, coaches, parents,
> and the organizations that run leagues and clubs.

![status](https://img.shields.io/badge/status-in%20development-blue)
![pnpm](https://img.shields.io/badge/pnpm-monorepo-orange)

## What's in the box

Kinectem is a TypeScript monorepo (pnpm workspaces). It ships three
deployable artifacts and four shared libraries:

| Path | What it is |
| --- | --- |
| `artifacts/kinectem` | Web client — React 19 + Vite 7 + Tailwind 4 + TanStack Query |
| `artifacts/api-server` | REST API — Express 5, cookie sessions, OpenAPI-validated |
| `artifacts/dev-portal` | Developer portal — docs, conventions, and Scalar-rendered API reference |
| `artifacts/mockup-sandbox` | Component / design preview |
| `lib/api-spec` | **Source of truth** — `openapi.yaml` + codegen |
| `lib/api-client-react` | Generated React-Query client used by the web app |
| `lib/api-zod` | Generated Zod schemas used by the server |
| `lib/db` | Drizzle schema + Postgres helpers |

## Prerequisites

- Node.js 20+
- pnpm 9+
- A reachable PostgreSQL database (used by both the server and tests)

## Environment

Set `DATABASE_URL` to a Postgres connection string. The api-server
reads it at boot; tests use a sibling `kinectem_api_test` database
that is created on demand from the same instance.

```bash
export DATABASE_URL=postgres://user:pass@localhost:5432/kinectem
```

Optional environment variables (defaults are sane for local dev):

- `PORT` — port the API server listens on (default `0`, picked by the host).
- `EMAIL_FROM`, `EMAIL_PROVIDER` — outbound email transport (no-op when unset).

## Getting started

```bash
pnpm install
# generate the API client + zod schemas from the spec
pnpm --filter @workspace/api-spec run codegen
# in two terminals (or via your preferred process manager):
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/kinectem    run dev
```

Then open the URL printed by Vite. The web app talks to the API at
`/api/v1`.

## Useful scripts

| Command | What it does |
| --- | --- |
| `pnpm --filter @workspace/api-spec run codegen` | Regenerate the React-Query client and Zod schemas from `openapi.yaml` |
| `pnpm --filter @workspace/api-server run dev` | Start the API server (watch mode) |
| `pnpm --filter @workspace/api-server run test` | Run the api-server test suite (Vitest, hits a real Postgres) |
| `pnpm --filter @workspace/kinectem run dev` | Start the web client (Vite dev server) |
| `pnpm -w run typecheck:libs` | Typecheck all shared libraries |

## API at a glance

The HTTP API is fully described in
[`lib/api-spec/openapi.yaml`](./lib/api-spec/openapi.yaml). That file
is the **single source of truth** — the server validates every request
against it via `express-openapi-validator`, and the typed client and
Zod schemas are generated from it.

**Building against the API? Start at the developer portal:**
[`artifacts/dev-portal`](./artifacts/dev-portal) (mounted at `/dev-portal`
in dev). It renders the same `openapi.yaml` interactively and adds
walk-throughs for authentication, error handling, pagination, and
ready-to-paste curl + TypeScript samples.

You can also run the API server and open `/api/docs` for a no-frills
Scalar view of the spec, or read the rules every endpoint follows —
naming, error envelope, pagination, auth — in
[`API_CONVENTIONS.md`](./API_CONVENTIONS.md).

In short:

- Base path: `/api/v1`.
- Auth: `HttpOnly` cookie session named `kinectem_session`, set by
  `POST /auth/login` and `POST /auth/signup`.
- Errors: `{ "error": "...", "code": "..." }` on every non-2xx response.
- Lists: `{ "data": [...], "pagination": { "nextCursor", "hasMore", "totalCount" } }`.

## Repository layout

```
.
├── artifacts/        # deployable apps (web, api, mockup sandbox)
├── lib/              # shared libraries (spec, codegen, db)
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── README.md         # this file
├── API_CONVENTIONS.md
└── replit.md         # workspace-specific notes for the Replit env
```

## Contributing

When you change the API surface:

1. Edit `lib/api-spec/openapi.yaml` first.
2. Regenerate clients: `pnpm --filter @workspace/api-spec run codegen`.
3. Update the matching handler in `artifacts/api-server/src/routes/spec.ts`.
4. Run `pnpm --filter @workspace/api-server run test`.

When you add or change error responses, use the `apiError` helper in
`artifacts/api-server/src/lib/spec-helpers.ts` so the response keeps
the standard `{ error, code }` shape.

## License

TBD.
