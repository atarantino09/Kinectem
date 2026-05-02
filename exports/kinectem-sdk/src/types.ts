/**
 * Hand-written types covering the auth surface the SDK uses directly.
 * The full OpenAPI spec is bundled at `@kinectem/sdk/openapi.json` if
 * you want to generate types for the rest of the API (recommended:
 * `openapi-typescript ./node_modules/@kinectem/sdk/openapi.json -o
 * src/api-types.ts`).
 */

export type UserRole = "athlete" | "coach" | "admin" | "parent";

export interface KinectemUser {
  id: string;
  email: string;
  role: UserRole;
  firstName?: string | null;
  lastName?: string | null;
  avatarUrl?: string | null;
  parentId?: string | null;
  // Spec exposes additional public fields (bio, city, state, …); they
  // pass through untyped so the SDK never lies about what the server
  // returns.
  [key: string]: unknown;
}

export interface TokenPair {
  accessToken: string;
  /** Absolute expiry of `accessToken` (ISO 8601, from the server). */
  accessTokenExpiresAt: string;
  refreshToken: string;
  /** Absolute expiry of `refreshToken` (ISO 8601, 30 days from issue). */
  refreshTokenExpiresAt: string;
}

/** Response body of `POST /auth/token`. */
export interface TokenIssueResponse extends TokenPair {
  tokenType: "Bearer";
  /** Seconds until `accessToken` expires. */
  expiresIn: number;
  user: KinectemUser;
}

/** Response body of `POST /auth/refresh`. */
export interface TokenRefreshResponse extends TokenPair {
  tokenType: "Bearer";
  expiresIn: number;
}

/** Standard error envelope used by every endpoint. */
export interface ApiErrorBody {
  error: string;
  code: string;
  /** Reserved for structured logging. */
  correlationId?: string;
  /** Some endpoints attach extra fields (e.g. pendingGuardianConfirmation). */
  [key: string]: unknown;
}
