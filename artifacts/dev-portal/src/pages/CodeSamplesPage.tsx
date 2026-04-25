import { Link } from "wouter";
import { PageHeader } from "@/components/PageHeader";
import { CodeBlock } from "@/components/CodeBlock";
import { Callout } from "@/components/Callout";

export default function CodeSamplesPage() {
  return (
    <article className="prose-doc">
      <PageHeader
        eyebrow="Build"
        title="Code samples"
        lede="Copy-paste snippets for the most common flows. curl on the left, TypeScript on the right."
      />

      <Callout variant="info">
        TypeScript samples use plain <code>fetch</code> for portability.
        Inside the monorepo, prefer the generated React-Query client at{" "}
        <code>@workspace/api-client-react</code> — see{" "}
        <Link href="/getting-started">Getting started</Link>.
      </Callout>

      <h2>Sign in</h2>
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
            code: `const res = await fetch(
  "https://api.kinectem.example/api/v1/auth/login",
  {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "you@example.com",
      password: "••••••••",
    }),
  },
);
if (!res.ok) {
  const { code, error } = await res.json();
  throw new Error(\`\${code}: \${error}\`);
}
const me = await res.json();`,
          },
        ]}
      />

      <h2>Get the current user</h2>
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
            code: `const res = await fetch(
  "https://api.kinectem.example/api/v1/users/me",
  { credentials: "include" },
);
const me = await res.json();`,
          },
        ]}
      />

      <h2>Read the home feed</h2>
      <p>
        <code>GET /feed</code> returns the authenticated user's unified feed —
        their own posts plus posts from people, teams, and orgs they follow or
        are members of. The response is paginated like every list endpoint.
      </p>
      <CodeBlock
        tabs={[
          {
            label: "curl",
            language: "bash",
            code: `curl -b cookies.txt \\
  'https://api.kinectem.example/api/v1/feed?limit=20'

# Next page (echo nextCursor back as cursor):
curl -b cookies.txt \\
  'https://api.kinectem.example/api/v1/feed?limit=20&cursor=OPAQUE'`,
          },
          {
            label: "typescript",
            language: "typescript",
            code: `async function loadFeed(cursor?: string) {
  const url = new URL("https://api.kinectem.example/api/v1/feed");
  url.searchParams.set("limit", "20");
  if (cursor) url.searchParams.set("cursor", cursor);

  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(\`Feed failed: \${res.status}\`);

  const page = await res.json();
  return {
    items: page.data,
    nextCursor: page.pagination.hasMore
      ? page.pagination.nextCursor
      : undefined,
  };
}`,
          },
        ]}
      />

      <h2>List organizations (with pagination)</h2>
      <CodeBlock
        tabs={[
          {
            label: "curl",
            language: "bash",
            code: `curl -b cookies.txt \\
  'https://api.kinectem.example/api/v1/organizations?limit=20'

# Next page (nextCursor from the previous response):
curl -b cookies.txt \\
  'https://api.kinectem.example/api/v1/organizations?limit=20&cursor=OPAQUE'`,
          },
          {
            label: "typescript",
            language: "typescript",
            code: `async function* listAllOrganizations() {
  let cursor: string | undefined;
  do {
    const url = new URL(
      "https://api.kinectem.example/api/v1/organizations",
    );
    url.searchParams.set("limit", "50");
    if (cursor) url.searchParams.set("cursor", cursor);

    const res = await fetch(url, { credentials: "include" });
    const page = await res.json();
    yield* page.data;
    cursor = page.pagination.hasMore
      ? page.pagination.nextCursor
      : undefined;
  } while (cursor);
}`,
          },
        ]}
      />

      <h2>Create a post</h2>
      <CodeBlock
        tabs={[
          {
            label: "curl",
            language: "bash",
            code: `curl -b cookies.txt -X POST \\
  'https://api.kinectem.example/api/v1/posts' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "body": "Hello world",
    "visibility": "public"
  }'`,
          },
          {
            label: "typescript",
            language: "typescript",
            code: `const res = await fetch(
  "https://api.kinectem.example/api/v1/posts",
  {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      body: "Hello world",
      visibility: "public",
    }),
  },
);
const post = await res.json();`,
          },
        ]}
      />

      <h2>Upload an asset (three-step)</h2>
      <p>
        Asset uploads use a three-step flow: request a signed URL, PUT the
        bytes directly to object storage using the headers the server hands
        back, then confirm.
      </p>
      <CodeBlock
        tabs={[
          {
            label: "curl",
            language: "bash",
            code: `# 1. Request an upload URL
RESP=$(curl -b cookies.txt -X POST \\
  'https://api.kinectem.example/api/v1/assets/upload' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "fileName": "photo.jpg",
    "fileType": "image/jpeg",
    "fileSize": 482144
  }')

ASSET_ID=$(echo "$RESP" | jq -r .assetId)
PUT_URL=$(echo "$RESP"  | jq -r .uploadUrl)

# 2. PUT the bytes directly to storage (no Kinectem auth — the URL is signed).
#    Use the exact headers from uploadHeaders in the response.
curl -X PUT --data-binary @photo.jpg \\
  -H 'Content-Type: image/jpeg' "$PUT_URL"

# 3. Confirm so the backend marks the asset as ready
curl -b cookies.txt -X POST \\
  "https://api.kinectem.example/api/v1/assets/\${ASSET_ID}/confirm"`,
          },
          {
            label: "typescript",
            language: "typescript",
            code: `async function uploadAsset(file: File) {
  const base = "https://api.kinectem.example/api/v1";

  // 1. Ask the server for a signed upload URL.
  const init = await fetch(\`\${base}/assets/upload\`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
    }),
  }).then((r) => r.json());
  // init: { assetId, uploadUrl, uploadHeaders, expiresIn }

  // 2. PUT the bytes straight to storage with the headers the server chose.
  await fetch(init.uploadUrl, {
    method: "PUT",
    headers: init.uploadHeaders,
    body: file,
  });

  // 3. Confirm so the backend can verify and mark the asset \`confirmed\`.
  await fetch(\`\${base}/assets/\${init.assetId}/confirm\`, {
    method: "POST",
    credentials: "include",
  });

  return init.assetId as string;
}`,
          },
        ]}
      />

      <h2>Handle errors</h2>
      <CodeBlock
        tabs={[
          {
            label: "curl",
            language: "bash",
            code: `# 401 example — no cookie sent
curl -i 'https://api.kinectem.example/api/v1/users/me'

# Response body:
# { "error": "Sign in to continue.", "code": "AUTH_REQUIRED" }`,
          },
          {
            label: "typescript",
            language: "typescript",
            code: `type ApiError = { error: string; code: string };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(\`https://api.kinectem.example\${path}\`, {
    credentials: "include",
    ...init,
  });
  if (!res.ok) {
    const err = (await res.json()) as ApiError;
    if (err.code === "AUTH_REQUIRED") redirectToLogin();
    if (err.code === "RATE_LIMITED") backoffAndRetry();
    throw new Error(\`\${err.code}: \${err.error}\`);
  }
  return res.json() as Promise<T>;
}`,
          },
        ]}
      />
    </article>
  );
}
