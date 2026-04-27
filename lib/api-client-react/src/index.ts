import type { UseQueryOptions } from "@tanstack/react-query";

export * from "./generated/api";
export * from "./generated/api.schemas";
export {
  setBaseUrl,
  setAuthTokenGetter,
  customFetch,
  ApiError,
} from "./custom-fetch";
export type { AuthTokenGetter, CustomFetchOptions } from "./custom-fetch";

/**
 * Pass partial UseQueryOptions to an orval-generated `useXxx` hook without
 * having to satisfy the fully-required `UseQueryOptions` type (orval requires
 * `queryKey` even though the hook fills it in for you). Use as:
 *
 *   useListUserOrganizations(id, undefined, { query: queryOpts({ enabled }) })
 *
 * This centralises the unsafe cast so call sites stay readable and free of
 * `as never`.
 */
export function queryOpts<T = unknown, E = unknown>(
  opts: Partial<UseQueryOptions<T, E, T>>,
): UseQueryOptions<T, E, T> {
  return opts as UseQueryOptions<T, E, T>;
}
