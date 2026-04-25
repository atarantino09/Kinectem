import { Link } from "wouter";
import { PageHeader } from "@/components/PageHeader";
import { CodeBlock } from "@/components/CodeBlock";
import { Callout } from "@/components/Callout";

export default function GettingStartedPage() {
  return (
    <article className="prose-doc">
      <PageHeader
        eyebrow="Tutorial · 5 min"
        title="Getting started"
        lede="Authenticate, hit your first endpoint, and learn where to look when something breaks."
      />

      <h2>1. Pick a base URL</h2>
      <p>
        The API is versioned. The current public base path is{" "}
        <code>/api/v1</code>. Backwards-incompatible changes will move to{" "}
        <code>/api/v2</code> — your existing v1 calls will keep working.
      </p>

      <table>
        <thead>
          <tr>
            <th>Environment</th>
            <th>Base URL</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Production</td>
            <td>
              <code>https://api.kinectem.example/api/v1</code>
            </td>
          </tr>
          <tr>
            <td>Local development</td>
            <td>
              <code>http://localhost:PORT/api/v1</code>
            </td>
          </tr>
        </tbody>
      </table>

      <h2>2. Sign in</h2>
      <p>
        Authentication is a server-issued cookie session. Call{" "}
        <code>POST /auth/login</code> with email and password; the server
        responds <code>200</code> and sets an <code>HttpOnly</code> cookie
        named <code>kinectem_session</code>.
      </p>

      <CodeBlock
        tabs={[
          {
            label: "curl",
            language: "bash",
            code: `curl -i -c cookies.txt -X POST \\
  'https://api.kinectem.example/api/v1/auth/login' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "email": "you@example.com",
    "password": "••••••••"
  }'`,
          },
          {
            label: "typescript",
            language: "typescript",
            code: `await fetch("https://api.kinectem.example/api/v1/auth/login", {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    email: "you@example.com",
    password: "••••••••",
  }),
});`,
          },
        ]}
      />

      <Callout variant="tip">
        Browser <code>fetch</code> needs <code>credentials: "include"</code> for
        the session cookie to be sent on subsequent calls. Server-to-server
        callers should persist the cookie jar (the <code>-c cookies.txt</code>{" "}
        flag for curl).
      </Callout>

      <h2>3. Call your first endpoint</h2>
      <p>
        Once you have a session cookie, every authenticated endpoint is open to
        you. Try fetching the current user:
      </p>

      <CodeBlock
        tabs={[
          {
            label: "curl",
            language: "bash",
            code: `curl -b cookies.txt \\
  'https://api.kinectem.example/api/v1/users/me'`,
          },
          {
            label: "typescript",
            language: "typescript",
            code: `const res = await fetch("https://api.kinectem.example/api/v1/users/me", {
  credentials: "include",
});
const me = await res.json();
console.log(\`\${me.firstName} \${me.lastName}\`);`,
          },
        ]}
      />

      <h2>4. Use the generated client (recommended)</h2>
      <p>
        The TypeScript React-Query client at{" "}
        <code>@workspace/api-client-react</code> is generated from the same
        OpenAPI spec this portal renders. You get hooks, request/response
        types, and a single source of truth.
      </p>

      <CodeBlock
        language="typescript"
        code={`import {
  useGetLoggedInUser,
  useListOrganizations,
} from "@workspace/api-client-react";

export function Dashboard() {
  const { data: me } = useGetLoggedInUser();
  const { data: orgs, isLoading } = useListOrganizations({ limit: 20 });

  if (isLoading) return <Spinner />;
  return (
    <ul>
      {orgs?.data.map((o) => (
        <li key={o.id}>{o.name}</li>
      ))}
    </ul>
  );
}`}
      />

      <h2>5. Handle errors and pagination</h2>
      <p>
        Every error has the same shape: a stable <code>code</code> and a
        human-readable <code>error</code>. Branch on <code>code</code>, surface{" "}
        <code>error</code> to humans.
      </p>

      <CodeBlock
        language="json"
        code={`{
  "error": "You must be signed in to do that.",
  "code": "AUTH_REQUIRED"
}`}
      />

      <p>
        List endpoints return cursor-based pages. Echo back{" "}
        <code>nextCursor</code> as the <code>cursor</code> query parameter to
        fetch the next page. See <Link href="/conventions">Conventions</Link>{" "}
        for the full table of error codes and pagination details.
      </p>

      <h2>Next steps</h2>
      <ul>
        <li>
          <Link href="/authentication">Authentication</Link> — what cookies
          look like and what's coming next.
        </li>
        <li>
          <Link href="/conventions">Conventions</Link> — naming, errors,
          pagination, deprecation.
        </li>
        <li>
          <Link href="/reference">API reference</Link> — every endpoint and
          schema.
        </li>
      </ul>
    </article>
  );
}
