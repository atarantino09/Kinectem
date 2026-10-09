import { customFetch } from "@workspace/api-client-react";
import type { WhoamiResponse } from "@/hooks/useWhoami";
import { safeInternalPath } from "@/lib/safePath";

const PREFIX = "kinectem:parent-invite-account:";
const TTL = 2 * 60 * 60 * 1000;

export function inviteAccountToken(destination: string | null): string | null {
  const path = safeInternalPath(destination);
  return path ? /^\/invites\/([^/?#]+)\/?$/.exec(path)?.[1] ?? null : null;
}

export function rememberInviteAccount(token: string, userId: string) {
  try {
    sessionStorage.setItem(PREFIX + token, JSON.stringify({ userId, at: Date.now() }));
  } catch { /* Without storage, the explicit account choice remains available. */ }
}

export function hasInviteAccount(token: string, userId: string): boolean {
  try {
    const saved = JSON.parse(sessionStorage.getItem(PREFIX + token) ?? "null");
    return saved?.userId === userId && typeof saved.at === "number" &&
      Date.now() - saved.at >= 0 && Date.now() - saved.at < TTL;
  } catch { return false; }
}

export function forgetInviteAccount(token: string) {
  try { sessionStorage.removeItem(PREFIX + token); } catch { /* storage unavailable */ }
}

/** Called only after successful authentication, never just on visiting login. */
export async function completeInviteAuthentication(destination: string | null, authenticatedUserId: string | undefined) {
  const token = inviteAccountToken(destination);
  if (!token) return;
  const session = await customFetch<WhoamiResponse>("/api/v1/auth/whoami", { method: "GET" });
  const user = session.isMasquerading ? session.viewingAs : session.realUser;
  if (!session.authenticated || !user || !authenticatedUserId || user.id !== authenticatedUserId) {
    throw new Error("Your session could not be confirmed for the account you just used. Please sign in again to continue your invitation.");
  }
  rememberInviteAccount(token, user.id);
}
