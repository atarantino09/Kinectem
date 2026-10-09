// Pure helpers for the shared family setup flow. The draft lives in
// sessionStorage, is scoped to a user id, expires, and never holds passwords.
export type Relationship = "parent" | "legal_guardian";

export interface FamilyDraft {
  stage: "checkpoint" | "coparent" | "player" | "done";
  coParent: { firstName: string; lastName: string; email: string; relationshipType: Relationship } | null;
  requestId: string;
  requestName: { firstName: string; lastName: string } | null;
  attempted: boolean;
  childId: string | null;
  childName: string | null;
  invitation: { id: string; emailSent: boolean | null } | null;
  savedAt: number;
}

export const DRAFT_TTL_MS = 2 * 60 * 60 * 1000;
const PREFIX = "kinectem:family-setup:";

export function newRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  const h = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
  return `${h()}${h()}-${h()}-4${h().slice(1)}-a${h().slice(1)}-${h()}${h()}${h()}`;
}

export function emptyDraft(): FamilyDraft {
  return {
    stage: "checkpoint", coParent: null, requestId: newRequestId(), requestName: null,
    attempted: false, childId: null, childName: null, invitation: null, savedAt: Date.now(),
  };
}

export const draftKey = (userId: string, scope: string) => `${PREFIX}${userId}:${scope}`;

export function loadDraft(userId: string, scope: string, now = Date.now()): FamilyDraft | null {
  try {
    const raw = sessionStorage.getItem(draftKey(userId, scope));
    if (!raw) return null;
    const d = JSON.parse(raw) as FamilyDraft;
    if (!d || typeof d.savedAt !== "number" || now - d.savedAt > DRAFT_TTL_MS) {
      sessionStorage.removeItem(draftKey(userId, scope));
      return null;
    }
    return d;
  } catch {
    return null;
  }
}

export function saveDraft(userId: string, scope: string, d: FamilyDraft) {
  try {
    sessionStorage.setItem(draftKey(userId, scope), JSON.stringify({ ...d, savedAt: Date.now() }));
  } catch { /* storage unavailable */ }
}

export function clearDraft(userId: string, scope: string) {
  try { sessionStorage.removeItem(draftKey(userId, scope)); } catch { /* ignore */ }
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Decide which idempotency key a submit should use. The same name keeps the
 * key (retries/double clicks/reload). A changed name after an attempt that may
 * have committed is reported so the caller can re-check before rotating.
 */
export function planRequest(d: FamilyDraft, firstName: string, lastName: string):
  | { kind: "reuse" | "fresh" }
  | { kind: "changed-after-attempt"; previous: { firstName: string; lastName: string } } {
  if (!d.requestName) return { kind: "fresh" };
  const same = norm(d.requestName.firstName) === norm(firstName) && norm(d.requestName.lastName) === norm(lastName);
  if (same) return { kind: "reuse" };
  if (d.attempted) return { kind: "changed-after-attempt", previous: d.requestName };
  return { kind: "fresh" };
}

export function isEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

export function errorCode(err: unknown): string | undefined {
  const e = err as { code?: string; data?: { code?: string } | null; body?: { code?: string } } | null;
  return e?.code ?? e?.data?.code ?? e?.body?.code;
}
export function errorStatus(err: unknown): number | undefined {
  return (err as { status?: number } | null)?.status;
}

/** "Sent" only when the server says so; false/null are never "delivered". */
export function deliveryLabel(emailSent: boolean | null | undefined): "sent" | "failed" | "saved" {
  return emailSent === true ? "sent" : emailSent === false ? "failed" : "saved";
}

export function defaultSignupDest(role: string, returnTo: string | null): string | null {
  if (returnTo) return null;
  return role === "parent" ? "/family?setup=1" : null;
}
