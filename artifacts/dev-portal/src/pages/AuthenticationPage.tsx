import { PageHeader } from "@/components/PageHeader";
import { CodeBlock } from "@/components/CodeBlock";
import { Callout } from "@/components/Callout";

export default function AuthenticationPage() {
  return (
    <article className="prose-doc">
      <PageHeader
        eyebrow="Concepts"
        title="Authentication"
        lede="Two equivalent ways to sign in: bearer tokens for mobile and external clients, cookie sessions for the website."
      />

      <h2>Pick a scheme</h2>
      <p>
        Every protected endpoint accepts <strong>either</strong> a server-issued
        cookie session <strong>or</strong> a bearer access token. Cookies are
        the right fit for the website (browsers send them automatically and
        the token never touches JavaScript). Bearer tokens are the right fit
        for the mobile app and any other non-browser client — there's no
        cookie jar to manage and the token can be sent over plain
        <code>fetch</code>.
      </p>
      <ul>
        <li>
          <strong>Bearer token (mobile, external)</strong> —{" "}
          <code>POST /auth/token</code> exchanges email + password for an
          access token + refresh token pair. Send the access token as{" "}
          <code>Authorization: Bearer …</code>.
        </li>
        <li>
          <strong>Cookie session (website)</strong> —{" "}
          <code>POST /auth/login</code> sets an <code>HttpOnly</code> cookie
          called <code>kinectem_session</code>. Send credentials with{" "}
          <code>credentials: "include"</code>.
        </li>
      </ul>

      <h2>Bearer tokens</h2>
      <p>
        A successful <code>POST /auth/token</code> returns a short-lived{" "}
        <strong>access token</strong> (15 minutes) and a long-lived{" "}
        <strong>refresh token</strong> (30 days). Store both on the device.
        Send the access token on every request; when it expires, exchange the
        refresh token for a fresh pair.
      </p>

      <h3>Issue a token pair</h3>
      <CodeBlock
        tabs={[
          {
            label: "curl",
            language: "bash",
            code: `curl -X POST 'https://api.kinectem.example/api/v1/auth/token' \\
  -H 'Content-Type: application/json' \\
  -d '{"email":"you@example.com","password":"…","deviceLabel":"iPhone 15 Pro"}'

# {
#   "tokenType": "Bearer",
#   "accessToken":  "eyJ…",          // send as Authorization: Bearer
#   "expiresIn":    900,             // seconds until accessToken expires
#   "accessTokenExpiresAt":  "2026-05-02T18:15:00.000Z",
#   "refreshToken": "a1b2c3…",       // long-lived, single-use
#   "refreshTokenExpiresAt": "2026-06-01T18:00:00.000Z",
#   "user": { "id": "usr_…", "firstName": "Casey", … }
# }`,
          },
          {
            label: "fetch",
            language: "typescript",
            code: `const r = await fetch("https://api.kinectem.example/api/v1/auth/token", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    email: "you@example.com",
    password: "…",
    deviceLabel: "iPhone 15 Pro",
  }),
});
const { accessToken, refreshToken, expiresIn } = await r.json();`,
          },
        ]}
      />

      <h3>Call a protected endpoint</h3>
      <CodeBlock
        tabs={[
          {
            label: "curl",
            language: "bash",
            code: `curl 'https://api.kinectem.example/api/v1/users/me' \\
  -H "Authorization: Bearer $ACCESS_TOKEN"`,
          },
          {
            label: "fetch",
            language: "typescript",
            code: `await fetch("https://api.kinectem.example/api/v1/users/me", {
  headers: { Authorization: \`Bearer \${accessToken}\` },
});`,
          },
        ]}
      />

      <h3>Refresh the access token</h3>
      <p>
        When the server returns <code>401 AUTH_REQUIRED</code>, swap the
        refresh token for a new pair. Refresh tokens <strong>rotate</strong>{" "}
        on every use — the old refresh token is invalidated atomically.
        Reusing a consumed refresh token returns <code>401</code>, which
        means the token may have been stolen; sign the user out and force a
        fresh login.
      </p>
      <CodeBlock
        language="bash"
        code={`curl -X POST 'https://api.kinectem.example/api/v1/auth/refresh' \\
  -H 'Content-Type: application/json' \\
  -d '{"refreshToken":"a1b2c3…"}'

# Returns the same shape as /auth/token (minus the user object).
# Replace BOTH stored tokens with the new ones.`}
      />

      <h3>Log out</h3>
      <p>
        Send the refresh token in the body so the server can revoke it. The
        endpoint also clears any session cookie on the same request, so the
        same call works for either auth scheme.
      </p>
      <CodeBlock
        language="bash"
        code={`curl -X POST 'https://api.kinectem.example/api/v1/auth/logout' \\
  -H "Authorization: Bearer $ACCESS_TOKEN" \\
  -H 'Content-Type: application/json' \\
  -d '{"refreshToken":"a1b2c3…"}'

# 204 No Content. Subsequent /auth/refresh with the same token returns 401.`}
      />

      <Callout variant="warn" title="Store refresh tokens securely">
        On a mobile device, put the refresh token in the OS keychain (iOS
        Keychain / Android Keystore), not in plain <code>AsyncStorage</code>.
        On a backend service, treat it like a password.
      </Callout>

      <h2>Cookie sessions (website)</h2>
      <p>
        The website uses a server-issued <strong>cookie session</strong>. On
        a successful <code>POST /auth/login</code> or{" "}
        <code>POST /auth/signup</code>, the server sets an <code>HttpOnly</code>{" "}
        cookie named <code>kinectem_session</code>. Sessions live for 30 days.
      </p>
      <CodeBlock
        tabs={[
          {
            label: "browser",
            language: "typescript",
            code: `await fetch("https://api.kinectem.example/api/v1/users/me", {
  credentials: "include",
});`,
          },
          {
            label: "curl",
            language: "bash",
            code: `# Save cookies on login
curl -c cookies.txt -X POST \\
  'https://api.kinectem.example/api/v1/auth/login' \\
  -H 'Content-Type: application/json' \\
  -d '{"email":"…","password":"…"}'

# Reuse them on subsequent calls
curl -b cookies.txt 'https://api.kinectem.example/api/v1/users/me'`,
          },
        ]}
      />
      <p>
        <code>POST /auth/logout</code> destroys the session and clears the
        cookie. The next call returns <code>401 AUTH_REQUIRED</code>.
      </p>

      <h2>Public endpoints</h2>
      <p>
        A handful of endpoints intentionally need no auth — they're marked
        with empty security in the spec:
      </p>
      <ul>
        <li>
          <code>POST /auth/login</code>, <code>POST /auth/signup</code>
        </li>
        <li>
          <code>POST /auth/token</code>, <code>POST /auth/refresh</code>
        </li>
        <li>
          <code>POST /auth/password-reset/request</code> and{" "}
          <code>POST /auth/password-reset/complete</code>
        </li>
        <li>Guardian confirmation flow</li>
        <li>Invite preview / landing endpoints</li>
        <li>
          <code>GET /health</code>
        </li>
      </ul>

      <h2>Fetching the spec</h2>
      <p>
        The full OpenAPI document is served unauthenticated at{" "}
        <code>/api/openapi.public.json</code> (and{" "}
        <code>/api/openapi.public.yaml</code>) so codegen tools like Orval,
        OpenAPI Generator, or Swagger Codegen can fetch it directly:
      </p>
      <CodeBlock
        language="bash"
        code={`curl 'https://api.kinectem.example/api/openapi.public.json' \\
  > openapi.json`}
      />

      <Callout variant="warn" title="Don't pattern-match error messages">
        The <code>error</code> string is for humans and may change between
        releases. Branch your code on <code>code</code> (e.g. <code>AUTH_REQUIRED</code>,{" "}
        <code>FORBIDDEN</code>) instead.
      </Callout>

      <h2>API keys</h2>
      <p>
        For long-running server-to-server integrations, mint a{" "}
        <strong>long-lived API key</strong> from the developer portal at{" "}
        <a href="/dev-portal/api-keys">
          <code>/dev-portal/api-keys</code>
        </a>
        . API keys begin with the literal prefix <code>kk_</code> and are sent
        the same way as a short-lived access token —{" "}
        <code>Authorization: Bearer kk_…</code>. The server uses the prefix to
        route the credential to the API-key table instead of trying to verify
        it as a signed access-token envelope.
      </p>
      <CodeBlock
        language="bash"
        code={`# Create a key from the dev portal, then:
curl 'https://api.kinectem.example/api/v1/users/me' \\
  -H "Authorization: Bearer kk_a1b2c3d4e5f6…"`}
      />
      <Callout variant="warn" title="Plaintext is shown only once">
        The full key is returned only by <code>POST /auth/api-keys</code> at
        creation time. The server stores only its sha256 hash, so a lost key
        cannot be recovered — revoke it and create a replacement.
      </Callout>

      <h2>OAuth (coming soon)</h2>
      <Callout variant="soon" title="On the roadmap">
        Third-party apps acting on behalf of a Kinectem user will use a
        standard authorization-code OAuth 2.0 flow with PKCE. Details — scopes,
        consent screen, token lifetimes — will land here when the endpoints
        are live.
      </Callout>

      <h2>What you'll see when it fails</h2>
      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>
              <code>code</code>
            </th>
            <th>What it means</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>401</td>
            <td>
              <code>AUTH_REQUIRED</code>
            </td>
            <td>
              No session cookie / bearer token, or the access token has
              expired. Try <code>/auth/refresh</code>.
            </td>
          </tr>
          <tr>
            <td>403</td>
            <td>
              <code>FORBIDDEN</code>
            </td>
            <td>You're signed in but not allowed to do this.</td>
          </tr>
          <tr>
            <td>429</td>
            <td>
              <code>RATE_LIMITED</code>
            </td>
            <td>Per-endpoint rate limit hit; back off and retry.</td>
          </tr>
        </tbody>
      </table>
    </article>
  );
}
