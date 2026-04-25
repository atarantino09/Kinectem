import { PageHeader } from "@/components/PageHeader";
import { CodeBlock } from "@/components/CodeBlock";
import { Callout } from "@/components/Callout";

export default function AuthenticationPage() {
  return (
    <article className="prose-doc">
      <PageHeader
        eyebrow="Concepts"
        title="Authentication"
        lede="The Kinectem API uses cookie sessions today. API keys and OAuth are on the roadmap."
      />

      <h2>Cookie sessions (today)</h2>
      <p>
        The current production model is a server-issued <strong>cookie session</strong>.
        On a successful <code>POST /auth/login</code> or{" "}
        <code>POST /auth/signup</code>, the server sets an <code>HttpOnly</code>{" "}
        cookie named <code>kinectem_session</code>. Every authenticated
        endpoint requires this cookie. Sessions live for 30 days.
      </p>

      <h3>What gets set</h3>
      <CodeBlock
        language="http"
        code={`HTTP/1.1 200 OK
Set-Cookie: kinectem_session=eyJhbGciOi…; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000
Content-Type: application/json

{ "id": "usr_…", "firstName": "Casey", "lastName": "Reyes", "email": "you@example.com" }`}
      />

      <h3>Sending the cookie</h3>
      <p>
        Browsers send the cookie automatically on same-origin requests. From
        cross-origin browser code, set <code>credentials: "include"</code>.
        Server-to-server callers must persist the cookie between requests.
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

      <h3>Logging out</h3>
      <p>
        <code>POST /auth/logout</code> destroys the session and clears the
        cookie. The next call returns <code>401 AUTH_REQUIRED</code>.
      </p>

      <h3>Public endpoints</h3>
      <p>
        A handful of endpoints intentionally need no session — they're marked
        with empty security in the spec:
      </p>
      <ul>
        <li>
          <code>POST /auth/login</code>, <code>POST /auth/signup</code>
        </li>
        <li>
          <code>POST /auth/password-reset/request</code> and{" "}
          <code>POST /auth/password-reset/complete</code>
        </li>
        <li>Guardian confirmation flow</li>
        <li>
          Invite preview / landing endpoints
        </li>
        <li>
          <code>GET /health</code>
        </li>
      </ul>

      <Callout variant="warn" title="Don't pattern-match error messages">
        The <code>error</code> string is for humans and may change between
        releases. Branch your code on <code>code</code> (e.g. <code>AUTH_REQUIRED</code>,{" "}
        <code>FORBIDDEN</code>) instead.
      </Callout>

      <h2>API keys (coming soon)</h2>
      <Callout variant="soon" title="Reserved, not implemented">
        A long-lived <strong>API key</strong> scheme is reserved in the spec
        for forward compatibility. The current server rejects the{" "}
        <code>X-API-Key</code> header. Building a server-to-server integration
        today? Use the cookie-session flow with a service account; we'll
        provide a migration path when keys ship.
      </Callout>

      <p>
        When API keys ship, the calling pattern will look like this:
      </p>

      <CodeBlock
        language="bash"
        code={`# Future API-key flow — not yet active
curl 'https://api.kinectem.example/api/v1/organizations' \\
  -H 'X-API-Key: kk_live_••••••••••••'`}
      />

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
            <td>No session cookie, or the session has expired.</td>
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
