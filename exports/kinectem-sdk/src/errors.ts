import type { ApiErrorBody } from "./types.js";

/**
 * Thrown for every non-2xx response. `body` is whatever the server
 * returned (usually `ApiErrorBody`, but may be `undefined` for empty
 * bodies or non-JSON responses). `code` mirrors the server's machine-
 * readable error code when present, otherwise a SDK-supplied fallback
 * like `HTTP_404`.
 */
export class KinectemApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: ApiErrorBody | undefined;
  readonly url: string;
  readonly method: string;
  constructor(args: {
    message: string;
    status: number;
    code: string;
    body: ApiErrorBody | undefined;
    url: string;
    method: string;
  }) {
    super(args.message);
    this.name = "KinectemApiError";
    this.status = args.status;
    this.code = args.code;
    this.body = args.body;
    this.url = args.url;
    this.method = args.method;
  }
}

/**
 * Thrown by `request()` when the SDK cannot recover the session — for
 * example, the refresh token is missing, expired, or has been replayed.
 * The caller should treat this as "user is signed out" and route to a
 * login screen. Storage is cleared by the SDK before this is thrown.
 */
export class KinectemAuthError extends Error {
  readonly cause: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "KinectemAuthError";
    this.cause = cause;
  }
}
