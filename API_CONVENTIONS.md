# Kinectem API Conventions

This document describes the conventions every Kinectem HTTP endpoint
follows. The OpenAPI document at [`lib/api-spec/openapi.yaml`](./lib/api-spec/openapi.yaml)
is the single source of truth — when this document and the spec
disagree, the spec wins.

The api-server registers `express-openapi-validator` against the spec,
so a request that does not match these conventions is rejected before
it reaches a handler. The TypeScript clients in `lib/api-codegen` and
the Zod schemas in `lib/api-zod` are generated from the same spec via
`pnpm --filter @workspace/api-spec run codegen`.

## Versioning

- The current public base path is `/api/v1`.
- Backwards-compatible additions (new endpoints, new optional fields,
  new response codes that preserve existing semantics) ship into
  `/api/v1`.
- Any backwards-incompatible change goes to a new major path
  (`/api/v2`). We do not silently mutate existing v1 contracts.

## Naming

| Subject | Style | Example |
| --- | --- | --- |
| Resource paths | lower-kebab-case plurals | `/organizations`, `/team-members`, `/asset-messages` |
| Path parameters | camelCase | `{orgId}`, `{postId}`, `{notificationId}` |
| Query parameters | camelCase | `?cursor=…`, `?includeDrafts=true` |
| JSON property names | camelCase | `coverPhotoUrl`, `nextCursor`, `pendingGuardianConfirmation` |
| `operationId` | camelCase verb-first | `listOrganizations`, `createTeam`, `setUserCoverPhoto` |
| Tags | TitleCase noun | `Users`, `Organizations`, `Posts`, `Assets` |

## Error envelope

Every non-2xx response uses the same JSON envelope:

```json
{
  "error": "Human-readable message",
  "code": "MACHINE_READABLE_CODE"
}
```

- `error` (string, required) — A human-readable message. Surface this
  to end users. The wording may change between releases; do not pattern
  match on it.
- `code` (string, required) — A stable, machine-readable code. Branch
  client logic on this.
- Optional contextual fields may appear alongside `error` and `code`
  (for example, the guardian-gated login path adds
  `pendingGuardianConfirmation: true`). These are documented on the
  individual operation in the spec.
- `correlationId` (string, optional) — Reserved for future structured
  logging. The current server does not emit this field.

### Standard codes

| HTTP status | Default `code` | When used |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Malformed body, missing field, schema violation |
| 401 | `AUTH_REQUIRED` | No session or session expired |
| 403 | `FORBIDDEN` | Authenticated but not allowed for this resource |
| 404 | `NOT_FOUND` | Resource does not exist (or is hidden from this caller) |
| 409 | `CONFLICT` | Duplicate resource, optimistic-concurrency violation |
| 410 | `GONE` | Resource intentionally retired (e.g. expired invite) |
| 413 | `PAYLOAD_TOO_LARGE` | Upload exceeds the per-endpoint size cap |
| 422 | `UNPROCESSABLE` | Syntactically valid but semantically rejected |
| 429 | `RATE_LIMITED` | Per-endpoint rate limit hit |
| 5xx | `INTERNAL_ERROR` | Unexpected server failure |

Endpoints may emit additional, more specific codes when useful (e.g.
`DELETE_NOT_SUPPORTED` on `DELETE /organizations/{orgId}`). New
specific codes must be SCREAMING_SNAKE_CASE and documented in the
spec.

### Implementation

Server code uses the `apiError` helper from
`artifacts/api-server/src/lib/spec-helpers.ts`:

```ts
import { apiError } from "../lib/spec-helpers";

if (!user) return apiError(res, 401, "Not authenticated");
if (post.draft) return apiError(res, 403, "Cannot react to a draft");
return apiError(res, 403, "…", {
  code: "DELETE_NOT_SUPPORTED",
  extras: { docsUrl: "/api/docs#…" },
});
```

The helper sets `code` automatically from the HTTP status. Do not
introduce new bare `res.status(N).json({ error: "..." })` literals.

## Pagination

Paginated list endpoints return:

```json
{
  "data": [ /* items */ ],
  "pagination": {
    "nextCursor": "opaque-string-or-null",
    "hasMore": true,
    "totalCount": 42
  }
}
```

- `nextCursor` is opaque — the client must echo it back without
  inspecting it.
- To fetch the next page, pass `?cursor=<nextCursor>`.
- `totalCount` is best-effort. It may be omitted for very large or
  expensive queries.
- Page size is controlled with `?limit=N`; each endpoint documents its
  default and maximum.

## Authentication

The current production model is a server-issued cookie session.

- `POST /auth/login` and `POST /auth/signup` set an `HttpOnly` cookie
  named `kinectem_session`. Sessions live for 30 days.
- Browsers send the cookie automatically. `fetch` callers must set
  `credentials: "include"`.
- `POST /auth/logout` destroys the session and clears the cookie.
- Protected handlers use the `requireAuth` middleware
  (`artifacts/api-server/src/lib/auth.ts`). A missing or invalid
  session yields `401 AUTH_REQUIRED`.
- Endpoints documented as `security: []` are intentionally public:
  login, signup, password reset, guardian confirmation, `/health`,
  invite preview/landing.

A long-lived **API key** scheme (`X-API-Key` header) is reserved in
the spec for forward compatibility. It is **not implemented yet** —
the server currently rejects this header.

## Deprecation policy

When an endpoint, method, or field is no longer recommended:

1. Mark it `deprecated: true` in the spec.
2. Reference the replacement in the operation's `description`.
3. Keep the old behavior responding the same way for at least one
   minor release.

Currently deprecated:

- `GET /auth/users` — development helper, will be removed before any
  external launch.
- `POST /posts/{postId}/reactions` — alias of `PUT /posts/{postId}/reactions`.
- `POST /notifications/{notificationId}/read` — alias of
  `PATCH /notifications/{notificationId}/read`.
- `PUT /notifications/email-preference` — alias of
  `PATCH /notifications/email-preference`.

## Where to look in code

| Concern | File |
| --- | --- |
| Spec | `lib/api-spec/openapi.yaml` |
| Generated React-Query client | `lib/api-client-react/src/generated/` |
| Generated Zod schemas | `lib/api-zod/src/generated/` |
| All Express routes | `artifacts/api-server/src/routes/spec.ts` |
| Cookie-session auth | `artifacts/api-server/src/lib/auth.ts` |
| Error helper, response builders | `artifacts/api-server/src/lib/spec-helpers.ts` |
| Live API portal (Scalar) | `GET /api/docs` on a running server |
