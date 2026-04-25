import { Link } from "wouter";
import { PageHeader } from "@/components/PageHeader";
import { CodeBlock } from "@/components/CodeBlock";
import { Callout } from "@/components/Callout";

export default function ConventionsPage() {
  return (
    <article className="prose-doc">
      <PageHeader
        eyebrow="Concepts"
        title="Conventions"
        lede="The patterns every Kinectem endpoint follows. The OpenAPI spec is the source of truth — when this page and the spec disagree, the spec wins."
      />

      <h2>Versioning</h2>
      <ul>
        <li>
          The current public base path is <code>/api/v1</code>.
        </li>
        <li>
          Backwards-compatible additions (new endpoints, new optional fields)
          ship into <code>/api/v1</code>.
        </li>
        <li>
          Any backwards-incompatible change goes to a new major path —{" "}
          <code>/api/v2</code>, <code>/api/v3</code>, etc. Existing v1
          contracts are not silently mutated.
        </li>
      </ul>

      <h2>Naming</h2>
      <table>
        <thead>
          <tr>
            <th>Subject</th>
            <th>Style</th>
            <th>Example</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Resource paths</td>
            <td>lower-kebab-case plurals</td>
            <td>
              <code>/organizations</code>, <code>/team-members</code>,{" "}
              <code>/asset-messages</code>
            </td>
          </tr>
          <tr>
            <td>Path parameters</td>
            <td>camelCase</td>
            <td>
              <code>{"{orgId}"}</code>, <code>{"{postId}"}</code>,{" "}
              <code>{"{notificationId}"}</code>
            </td>
          </tr>
          <tr>
            <td>Query parameters</td>
            <td>camelCase</td>
            <td>
              <code>?cursor=…</code>, <code>?includeDrafts=true</code>
            </td>
          </tr>
          <tr>
            <td>JSON property names</td>
            <td>camelCase</td>
            <td>
              <code>coverPhotoUrl</code>, <code>nextCursor</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>operationId</code>
            </td>
            <td>camelCase verb-first</td>
            <td>
              <code>listOrganizations</code>, <code>setUserCoverPhoto</code>
            </td>
          </tr>
          <tr>
            <td>Tags</td>
            <td>TitleCase noun</td>
            <td>
              <code>Users</code>, <code>Organizations</code>, <code>Posts</code>
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Error envelope</h2>
      <p>Every non-2xx response uses the same JSON envelope:</p>

      <CodeBlock
        language="json"
        code={`{
  "error": "Human-readable message",
  "code": "MACHINE_READABLE_CODE"
}`}
      />

      <ul>
        <li>
          <code>error</code> (string, required) — Surface to end users. The
          wording may change between releases; <strong>do not pattern-match</strong>.
        </li>
        <li>
          <code>code</code> (string, required) — Stable, machine-readable.
          Branch client logic on this.
        </li>
        <li>
          Optional contextual fields may appear alongside <code>error</code>{" "}
          and <code>code</code> (e.g. the guardian-gated login path adds{" "}
          <code>pendingGuardianConfirmation: true</code>). Documented per
          operation.
        </li>
        <li>
          <code>correlationId</code> (string, optional) — Reserved for future
          structured logging; the current server does not emit it.
        </li>
      </ul>

      <h3>Standard codes</h3>
      <table>
        <thead>
          <tr>
            <th>HTTP</th>
            <th>Default <code>code</code></th>
            <th>When used</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>400</td><td><code>VALIDATION_ERROR</code></td><td>Malformed body, missing field, schema violation</td></tr>
          <tr><td>401</td><td><code>AUTH_REQUIRED</code></td><td>No session or session expired</td></tr>
          <tr><td>403</td><td><code>FORBIDDEN</code></td><td>Authenticated but not allowed for this resource</td></tr>
          <tr><td>404</td><td><code>NOT_FOUND</code></td><td>Resource does not exist (or is hidden from this caller)</td></tr>
          <tr><td>409</td><td><code>CONFLICT</code></td><td>Duplicate resource, optimistic-concurrency violation</td></tr>
          <tr><td>410</td><td><code>GONE</code></td><td>Resource intentionally retired (e.g. expired invite)</td></tr>
          <tr><td>413</td><td><code>PAYLOAD_TOO_LARGE</code></td><td>Upload exceeds the per-endpoint size cap</td></tr>
          <tr><td>422</td><td><code>UNPROCESSABLE</code></td><td>Syntactically valid but semantically rejected</td></tr>
          <tr><td>429</td><td><code>RATE_LIMITED</code></td><td>Per-endpoint rate limit hit</td></tr>
          <tr><td>5xx</td><td><code>INTERNAL_ERROR</code></td><td>Unexpected server failure</td></tr>
        </tbody>
      </table>

      <p>
        Endpoints may emit additional, more specific codes when useful (e.g.{" "}
        <code>DELETE_NOT_SUPPORTED</code> on{" "}
        <code>DELETE /organizations/{"{orgId}"}</code>). New specific codes are{" "}
        <code>SCREAMING_SNAKE_CASE</code> and documented on the operation in
        the spec.
      </p>

      <h2>Pagination</h2>
      <p>Paginated list endpoints return:</p>

      <CodeBlock
        language="json"
        code={`{
  "data": [ /* items */ ],
  "pagination": {
    "nextCursor": "opaque-string-or-null",
    "hasMore": true,
    "totalCount": 42
  }
}`}
      />

      <ul>
        <li>
          <code>nextCursor</code> is opaque — echo it back without inspecting.
        </li>
        <li>
          To fetch the next page, pass{" "}
          <code>?cursor=&lt;nextCursor&gt;</code>.
        </li>
        <li>
          <code>totalCount</code> is best-effort. It may be omitted for very
          large or expensive queries.
        </li>
        <li>
          Page size is controlled with <code>?limit=N</code>; each endpoint
          documents its default and maximum.
        </li>
      </ul>

      <h2>Deprecation policy</h2>
      <p>When an endpoint, method, or field is no longer recommended:</p>
      <ol>
        <li>
          It is marked <code>deprecated: true</code> in the spec.
        </li>
        <li>
          The replacement is referenced in the operation's{" "}
          <code>description</code>.
        </li>
        <li>
          The old behavior keeps responding the same way for at least one
          minor release.
        </li>
      </ol>

      <h3>Currently deprecated</h3>
      <ul>
        <li>
          <code>GET /auth/users</code> — development helper, will be removed
          before any external launch.
        </li>
        <li>
          <code>POST /posts/{"{postId}"}/reactions</code> — alias of{" "}
          <code>PUT /posts/{"{postId}"}/reactions</code>.
        </li>
        <li>
          <code>POST /notifications/{"{notificationId}"}/read</code> — alias
          of <code>PATCH /notifications/{"{notificationId}"}/read</code>.
        </li>
        <li>
          <code>PUT /notifications/email-preference</code> — alias of{" "}
          <code>PATCH /notifications/email-preference</code>.
        </li>
      </ul>

      <Callout variant="info" title="See it in the reference">
        Deprecated operations show a deprecated badge in the{" "}
        <Link href="/reference">API reference</Link>. The same flag drives
        codegen warnings in the generated TypeScript client.
      </Callout>
    </article>
  );
}
