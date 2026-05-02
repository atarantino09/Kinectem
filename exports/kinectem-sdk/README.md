# @kinectem/sdk

Typed client for the Kinectem API. Works in React Native / Expo, Node.js
18+, Deno, and modern browsers. Zero runtime dependencies.

## Install

The package ships as a tarball — no public npm registry. Drop it into
your mobile project and install:

```sh
# from your new mobile project root
npm install /absolute/path/to/kinectem-sdk-0.1.0.tgz
# or
pnpm add /absolute/path/to/kinectem-sdk-0.1.0.tgz
```

## Quick start (Expo / React Native)

```ts
import { KinectemClient } from "@kinectem/sdk";
import * as SecureStore from "expo-secure-store";
import type { TokenStorage, TokenPair } from "@kinectem/sdk";

// 1. Persist tokens in the OS keychain — never AsyncStorage.
const KEY = "kinectem.tokens.v1";
const storage: TokenStorage = {
  async get() {
    const raw = await SecureStore.getItemAsync(KEY);
    return raw ? (JSON.parse(raw) as TokenPair) : null;
  },
  async set(tokens) {
    if (tokens) await SecureStore.setItemAsync(KEY, JSON.stringify(tokens));
    else await SecureStore.deleteItemAsync(KEY);
  },
};

// 2. Create one client for your whole app.
export const api = new KinectemClient({
  baseUrl: "https://YOUR-KINECTEM-DOMAIN/api/v1",
  storage,
  deviceLabel: "iPhone 15 Pro", // optional, shown in future "active sessions" UI
  onSignOut: () => {
    // navigate to login screen
  },
});

// 3. Use it.
const { user } = await api.login("coach@kinectem.demo", "demo1234");
const me = await api.request<typeof user>("/users/me");
```

The client attaches `Authorization: Bearer <accessToken>` automatically,
refreshes the access token before it expires, and transparently retries
once on a 401. If the refresh token is rejected (revoked, replayed, or
expired) the SDK clears storage, fires `onSignOut`, and throws
`KinectemAuthError` so you can route to the login screen.

## API

### `new KinectemClient(options)`

| Option | Required | Default | Description |
|---|---|---|---|
| `baseUrl` | yes | — | API base URL with version prefix, e.g. `https://…/api/v1`. No trailing slash. |
| `storage` | no | `InMemoryTokenStorage` | Token persistence. Use SecureStore on mobile. |
| `fetch` | no | `globalThis.fetch` | Custom fetch implementation. |
| `refreshSkewSeconds` | no | `30` | Refresh access token this many seconds before its real expiry. |
| `deviceLabel` | no | — | Human label sent with `/auth/token`. |
| `onSignOut` | no | — | Called when the SDK signs the user out. |

### Methods

```ts
client.login(email, password, deviceLabel?) // -> { user, tokens }
client.logout()                              // -> void; revokes refresh on server
client.getTokens()                           // -> TokenPair | null
client.isAuthenticated()                     // -> boolean
client.getAccessToken()                      // -> string; refreshes if needed

client.request<TResponse>(path, {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
  query?: Record<string, string | number | boolean | null | undefined>,
  headers?: Record<string, string>,
  anonymous?: boolean,    // skip auth header
  signal?: AbortSignal,
}): Promise<TResponse>
```

### Errors

```ts
import { KinectemApiError, KinectemAuthError } from "@kinectem/sdk";

try {
  await api.request("/users/me");
} catch (e) {
  if (e instanceof KinectemAuthError) {
    // user needs to sign in again — onSignOut was already fired
  } else if (e instanceof KinectemApiError) {
    // e.status, e.code (server's MACHINE_READABLE_CODE), e.body
  }
}
```

## End-to-end types from the OpenAPI spec

The full spec ships at `@kinectem/sdk/openapi.json`. Generate types for
every endpoint once and you'll get response shapes for free:

```sh
npm install -D openapi-typescript
# Resolve the bundled spec via node so it works with npm / pnpm / yarn
# regardless of how each manager hoists @kinectem/sdk in node_modules.
npx openapi-typescript "$(node -p "require.resolve('@kinectem/sdk/openapi.json')")" -o src/api-types.ts
```

Then:

```ts
import type { components } from "./api-types";
type FeedPage = components["schemas"]["FeedPage"];
const feed = await api.request<FeedPage>("/feed");
```

## Demo credentials

Useful while wiring up the UI against the demo dataset:

- `coach@kinectem.demo` / `demo1234`
- `lisa@kinectem.demo` / `demo1234`
- `samira@kinectem.demo` / `demo1234`
- `marcus@kinectem.demo` / `demo1234`
- `sam@kinectem.demo` / `demo1234`

## Notes

- API keys (`kk_…`) created at `/dev-portal/api-keys` are for
  server-to-server integrations. Do **not** ship one inside the mobile
  app — users sign in with their own credentials.
- Access tokens live ~15 minutes; refresh tokens live 30 days and rotate
  on every refresh. The SDK handles all of this for you.
- `/auth/refresh` and `/auth/logout` are rate-limited to 30 requests per
  minute per (IP, refresh-token-hash). Normal usage is nowhere near
  this.
