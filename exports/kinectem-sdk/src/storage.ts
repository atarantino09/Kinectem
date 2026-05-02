import type { TokenPair } from "./types.js";

/**
 * Pluggable persistence for the access + refresh token pair. The SDK
 * never reads or writes tokens anywhere else, so swapping this out is
 * how you control where tokens live (Expo SecureStore, react-native
 * Keychain, browser localStorage, an in-memory test stub, etc.).
 *
 * Implementations must be safe to call concurrently — the SDK awaits
 * `set(...)` before resolving auth-changing operations, but refresh-on-
 * 401 may call `get()` from many places at once.
 */
export interface TokenStorage {
  get(): Promise<TokenPair | null>;
  set(tokens: TokenPair | null): Promise<void>;
}

/**
 * Default in-memory storage. Fine for tests and quick scripts; tokens
 * vanish on process exit. **Do not** use this in a real mobile app —
 * use the Expo SecureStore adapter from the README instead.
 */
export class InMemoryTokenStorage implements TokenStorage {
  private tokens: TokenPair | null = null;
  async get(): Promise<TokenPair | null> {
    return this.tokens;
  }
  async set(tokens: TokenPair | null): Promise<void> {
    this.tokens = tokens;
  }
}
