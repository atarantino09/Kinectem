import { KinectemApiError, KinectemAuthError } from "./errors.js";
import { InMemoryTokenStorage, type TokenStorage } from "./storage.js";
import type {
  ApiErrorBody,
  KinectemUser,
  TokenIssueResponse,
  TokenPair,
  TokenRefreshResponse,
} from "./types.js";

export interface KinectemClientOptions {
  /**
   * Base URL of the Kinectem API including the version prefix, e.g.
   * `https://kinectem.example.com/api/v1`. **No trailing slash.** Do
   * not include `/auth/...` — the SDK appends paths.
   */
  baseUrl: string;
  /** Token persistence. Defaults to {@link InMemoryTokenStorage}. */
  storage?: TokenStorage;
  /**
   * Override the global `fetch`. Useful for tests or for environments
   * where you need to install a custom fetch (most React Native /
   * Expo runtimes already provide a global one).
   */
  fetch?: typeof fetch;
  /**
   * Refresh the access token this many seconds before it actually
   * expires, to avoid 401s caused by clock skew. Defaults to 30s.
   */
  refreshSkewSeconds?: number;
  /**
   * Optional human label sent with `/auth/token` so a future "active
   * sessions" UI can tell devices apart (e.g. `"iPhone 15 Pro"`).
   */
  deviceLabel?: string;
  /**
   * Called whenever the user is signed out — either explicitly via
   * {@link KinectemClient.logout} or implicitly because the refresh
   * token was rejected. Useful for routing to the login screen.
   */
  onSignOut?: () => void;
}

/**
 * Body of `POST /auth/token` and `POST /auth/refresh` errors. Surfaced
 * verbatim through {@link KinectemApiError.body}.
 */
type LoginResult = { user: KinectemUser; tokens: TokenPair };

const DEFAULT_REFRESH_SKEW_SECONDS = 30;

export class KinectemClient {
  private readonly baseUrl: string;
  private readonly storage: TokenStorage;
  private readonly fetchImpl: typeof fetch;
  private readonly refreshSkewMs: number;
  private readonly deviceLabel: string | undefined;
  private readonly onSignOut: (() => void) | undefined;
  /** In-flight refresh deduplication so concurrent 401s share one call. */
  private refreshInFlight: Promise<TokenPair> | null = null;

  constructor(opts: KinectemClientOptions) {
    if (!opts.baseUrl) throw new Error("KinectemClient: baseUrl is required");
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.storage = opts.storage ?? new InMemoryTokenStorage();
    const f = opts.fetch ?? globalThis.fetch;
    if (!f)
      throw new Error(
        "KinectemClient: no global `fetch` available. Pass `fetch` in options.",
      );
    this.fetchImpl = f.bind(globalThis);
    this.refreshSkewMs =
      (opts.refreshSkewSeconds ?? DEFAULT_REFRESH_SKEW_SECONDS) * 1000;
    this.deviceLabel = opts.deviceLabel;
    this.onSignOut = opts.onSignOut;
  }

  // ----- Auth surface ----------------------------------------------------

  /**
   * Exchanges email + password for a fresh token pair, persists them,
   * and returns the authenticated user. Throws {@link KinectemApiError}
   * on bad credentials, rate limiting, or pending guardian confirmation
   * (status 403, body has `pendingGuardianConfirmation: true`).
   */
  async login(
    email: string,
    password: string,
    deviceLabel?: string,
  ): Promise<LoginResult> {
    const body: Record<string, unknown> = { email, password };
    const label = deviceLabel ?? this.deviceLabel;
    if (label) body.deviceLabel = label;
    const res = await this.rawJson<TokenIssueResponse>("POST", "/auth/token", {
      body,
    });
    const tokens = extractTokenPair(res);
    await this.storage.set(tokens);
    return { user: res.user, tokens };
  }

  /**
   * Revokes the current refresh token on the server (if any) and
   * clears local storage. Safe to call when not signed in.
   */
  async logout(): Promise<void> {
    const current = await this.storage.get();
    await this.storage.set(null);
    if (current?.refreshToken) {
      try {
        await this.rawJson<unknown>("POST", "/auth/logout", {
          body: { refreshToken: current.refreshToken },
        });
      } catch {
        // Server-side revoke is best-effort: the local copy is already
        // gone, and the refresh token has a hard 30-day cap anyway.
      }
    }
    this.onSignOut?.();
  }

  /** Returns the current persisted token pair without refreshing. */
  async getTokens(): Promise<TokenPair | null> {
    return this.storage.get();
  }

  /** True if a usable refresh token is on hand (access may be expired). */
  async isAuthenticated(): Promise<boolean> {
    const t = await this.storage.get();
    if (!t) return false;
    return Date.parse(t.refreshTokenExpiresAt) > Date.now();
  }

  /**
   * Returns a valid access token, refreshing it first if it's expired
   * or about to expire. Throws {@link KinectemAuthError} if the user
   * needs to sign in again.
   */
  async getAccessToken(): Promise<string> {
    const t = await this.storage.get();
    if (!t) throw new KinectemAuthError("Not signed in");
    if (Date.parse(t.accessTokenExpiresAt) - this.refreshSkewMs > Date.now()) {
      return t.accessToken;
    }
    const refreshed = await this.refreshTokens();
    return refreshed.accessToken;
  }

  // ----- Generic typed request ------------------------------------------

  /**
   * Make an authenticated JSON request against the API. The path is
   * appended to `baseUrl` so pass it as `/feed`, `/users/me`, etc.
   *
   * - Attaches `Authorization: Bearer <accessToken>` automatically.
   * - Refreshes the access token transparently on a single 401.
   * - Parses JSON responses; returns `undefined` for 204 No Content.
   * - Throws {@link KinectemApiError} for any non-2xx response.
   *
   * Type the response by passing a generic, e.g.
   * `client.request<FeedPage>("/feed")`. Generate full types from the
   * bundled OpenAPI spec for end-to-end safety (see README).
   */
  async request<TResponse = unknown>(
    path: string,
    init: {
      method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
      body?: unknown;
      query?: Record<string, string | number | boolean | undefined | null>;
      headers?: Record<string, string>;
      /** Skip auth headers (e.g. for `/auth/password-reset/request`). */
      anonymous?: boolean;
      signal?: AbortSignal;
    } = {},
  ): Promise<TResponse> {
    const method = init.method ?? "GET";
    const url = this.buildUrl(path, init.query);
    const headers: Record<string, string> = { ...(init.headers ?? {}) };
    if (init.body !== undefined && !("Content-Type" in headers)) {
      headers["Content-Type"] = "application/json";
    }
    if (!init.anonymous) {
      headers.Authorization = `Bearer ${await this.getAccessToken()}`;
    }
    const doFetch = (auth: string | undefined): Promise<Response> => {
      const h = { ...headers };
      if (auth) h.Authorization = `Bearer ${auth}`;
      return this.fetchImpl(url, {
        method,
        headers: h,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: init.signal,
      });
    };
    let res = await doFetch(undefined);
    if (res.status === 401 && !init.anonymous) {
      // Try once: refresh, then retry.
      try {
        const refreshed = await this.refreshTokens();
        res = await doFetch(refreshed.accessToken);
      } catch (err) {
        if (err instanceof KinectemAuthError) throw err;
        throw new KinectemAuthError("Session expired", err);
      }
    }
    return parseResponse<TResponse>(res, method, url);
  }

  // ----- Internals -------------------------------------------------------

  private buildUrl(
    path: string,
    query?: Record<string, string | number | boolean | undefined | null>,
  ): string {
    const p = path.startsWith("/") ? path : `/${path}`;
    let url = `${this.baseUrl}${p}`;
    if (query) {
      const usp = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null) continue;
        usp.append(k, String(v));
      }
      const qs = usp.toString();
      if (qs) url += (url.includes("?") ? "&" : "?") + qs;
    }
    return url;
  }

  /**
   * Internal raw JSON helper that does not attach a bearer token. Used
   * by login / refresh / logout to avoid recursion through `request()`.
   */
  private async rawJson<T>(
    method: "POST" | "GET",
    path: string,
    init: { body?: unknown } = {},
  ): Promise<T> {
    const url = this.buildUrl(path);
    const res = await this.fetchImpl(url, {
      method,
      headers:
        init.body === undefined ? {} : { "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    return parseResponse<T>(res, method, url);
  }

  private async refreshTokens(): Promise<TokenPair> {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = (async () => {
      const current = await this.storage.get();
      if (!current?.refreshToken) {
        await this.storage.set(null);
        this.onSignOut?.();
        throw new KinectemAuthError("No refresh token on file");
      }
      try {
        const res = await this.rawJson<TokenRefreshResponse>(
          "POST",
          "/auth/refresh",
          { body: { refreshToken: current.refreshToken } },
        );
        const tokens = extractTokenPair(res);
        await this.storage.set(tokens);
        return tokens;
      } catch (err) {
        if (err instanceof KinectemApiError && err.status === 401) {
          // Refresh token was revoked / replayed / expired — sign out.
          await this.storage.set(null);
          this.onSignOut?.();
          throw new KinectemAuthError(
            "Refresh token rejected; please sign in again",
            err,
          );
        }
        throw err;
      } finally {
        this.refreshInFlight = null;
      }
    })();
    return this.refreshInFlight;
  }
}

function extractTokenPair(res: TokenRefreshResponse): TokenPair {
  return {
    accessToken: res.accessToken,
    accessTokenExpiresAt: res.accessTokenExpiresAt,
    refreshToken: res.refreshToken,
    refreshTokenExpiresAt: res.refreshTokenExpiresAt,
  };
}

async function parseResponse<T>(
  res: Response,
  method: string,
  url: string,
): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (!res.ok) {
    const body = isErrorBody(parsed) ? parsed : undefined;
    throw new KinectemApiError({
      message: body?.error ?? `HTTP ${res.status} ${res.statusText}`.trim(),
      status: res.status,
      code: body?.code ?? `HTTP_${res.status}`,
      body,
      url,
      method,
    });
  }
  return parsed as T;
}

function isErrorBody(x: unknown): x is ApiErrorBody {
  return (
    typeof x === "object" &&
    x !== null &&
    typeof (x as { error?: unknown }).error === "string"
  );
}
