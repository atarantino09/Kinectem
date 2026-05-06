// Task #359 — COPPA Phase 1.
//
// Single home for everything age-gate / parental-consent / minor-account
// related: helpers, the verbatim notice text, audit logging, and the
// server-side enforcement primitives wired into search / messages /
// follows / comments / profile-edit / asset-upload.

import type { Request, Response } from "express";
import { db, consentAuditLog, users } from "@workspace/db";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";
import { apiError } from "./spec-helpers";
import { logger } from "./logger";

// Single source of truth for the parental-consent notice. Any change
// requires bumping `CONSENT_NOTICE_VERSION` so we can prove which
// wording a parent saw at the moment they consented.
export const CONSENT_NOTICE_VERSION = "1.0.0";
export const CONSENT_NOTICE_TEXT = `
Kinectem is a youth-sports social platform. Federal law (the Children's
Online Privacy Protection Act, "COPPA") requires us to obtain verifiable
parental consent before we collect personal information from a child
under 13.

If you confirm consent, your child's Kinectem account will be allowed to:
- Sign in and view their team roster, recaps, and highlights.
- Be tagged in posts created by coaches and teammates (you can require
  per-tag approval at any time from your Family page).
- Upload a profile photo (we automatically strip GPS / location and
  other camera metadata before storing minor uploads).

We will NOT enable for an under-13 account:
- Public profile fields beyond first initial + jersey number / sport.
- Direct messaging with anyone.
- Posting comments or new content visible to strangers.
- Following users, organizations, or teams in search.

We collect the minimum information needed: the child's first name,
last name, sport, jersey number, and date of birth (so we can tell
when they age out of these limits). You can revoke consent at any
time, which immediately disables the account and stops further data
collection. Use the "Revoke consent" link in the email we send you, or
the Revoke button on your Family page.

Questions: privacy@kinectem.com.
`.trim();

// Email-plus pacing: how long after the first guardian click we hold
// before sending the "you just consented — confirm again to finalize"
// email. Production would space this further; we use 60s here so the
// flow is testable end-to-end. The followup link itself is good for 7d.
export const FOLLOWUP_DELAY_MS = 60 * 1000;
export const FOLLOWUP_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const AGE_GATE_COOKIE = "kinectem_age_gate";
export const AGE_GATE_TTL_MS = 30 * 60 * 1000;

// HMAC secret for the short-lived age-gate cookie. The cookie carries
// only "is the visitor an under-13 athlete?" — never a date of birth —
// so there is nothing to leak even if it is replayed, but signing
// prevents a determined visitor from forging an over-13 cookie after
// failing the gate (which would otherwise let them skip parental
// consent).
function ageGateSecret(): string {
  const s = process.env.AGE_GATE_SECRET || process.env.SESSION_SECRET;
  if (s) return s;
  // Outside development we refuse to silently fall back to a hardcoded
  // value — a forgeable signed cookie would let a child re-roll the
  // gate and skip parental consent entirely.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "AGE_GATE_SECRET (or SESSION_SECRET) must be set in production for the COPPA age gate.",
    );
  }
  return "dev-age-gate-secret";
}

export interface AgeGatePayload {
  isUnder13: boolean;
  // Issued-at, ms since epoch.
  iat: number;
}

export function signAgeGate(payload: AgeGatePayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto
    .createHmac("sha256", ageGateSecret())
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
}

export function verifyAgeGate(token: string | undefined | null): AgeGatePayload | null {
  if (!token || typeof token !== "string") return null;
  const idx = token.indexOf(".");
  if (idx < 0) return null;
  const body = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = crypto
    .createHmac("sha256", ageGateSecret())
    .update(body)
    .digest("base64url");
  // Constant-time compare.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as AgeGatePayload;
    if (typeof decoded.isUnder13 !== "boolean" || typeof decoded.iat !== "number") return null;
    if (Date.now() - decoded.iat > AGE_GATE_TTL_MS) return null;
    return decoded;
  } catch {
    return null;
  }
}

// Tiny strict ISO-date parser; returns null on garbage so we never
// accidentally treat invalid input as "old enough".
export function ageInYears(isoDate: string | null | undefined, now: Date = new Date()): number | null {
  if (!isoDate || typeof isoDate !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const t = Date.parse(isoDate);
  if (Number.isNaN(t)) return null;
  return (now.getTime() - t) / (365.25 * 24 * 3600 * 1000);
}

export function isUnder13(isoDate: string | null | undefined): boolean {
  const a = ageInYears(isoDate);
  return a !== null && a < 13;
}

// Hash helper for parental-consent tokens. Stored hashed, presented in
// plaintext via email.
export function hashConsentToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export type ConsentAuditEvent =
  | "age_gate_attempt"
  | "age_gate_blocked"
  | "child_signup"
  | "guardian_email_sent"
  | "guardian_notice_viewed"
  | "guardian_first_consent"
  | "guardian_followup_sent"
  | "guardian_finalized"
  | "guardian_revoked"
  | "minor_blocked_action"
  | "exif_stripped"
  | "deletion_scheduled";

export async function logConsentEvent(args: {
  event: ConsentAuditEvent;
  childUserId?: string | null;
  consentId?: string | null;
  actorEmail?: string | null;
  actorIp?: string | null;
  details?: string | null;
}): Promise<void> {
  try {
    await db.insert(consentAuditLog).values({
      event: args.event,
      childUserId: args.childUserId ?? null,
      consentId: args.consentId ?? null,
      actorEmail: args.actorEmail ?? null,
      actorIp: args.actorIp ?? null,
      details: args.details ?? null,
    });
  } catch (err) {
    // Audit failures must not break user-facing flows.
    logger.error({ err, event: args.event }, "Failed to write consent audit log");
  }
}

export function clientIp(req: Request): string | null {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.length > 0) return xf.split(",")[0].trim();
  if (Array.isArray(xf) && xf.length > 0) return String(xf[0]).split(",")[0].trim();
  return req.ip ?? null;
}

// ---------------------------------------------------------------------------
// Server-side minor-enforcement primitives
// ---------------------------------------------------------------------------

// "Minor" for enforcement is the in-DB snapshot column. We do NOT recompute
// from date_of_birth here — the rules below have to apply even if the row
// loaded the user before the column was added (the migration backfills
// is_minor=true for everyone under 13 by DOB).
export type MinorRow = { isMinor: boolean | null | undefined } | null | undefined;

export function isMinorRow(u: MinorRow): boolean {
  return !!(u && u.isMinor);
}

// Returns true and writes a 403 when `me` is a minor and `action` is not
// allowed. Caller should `return` immediately.
export function blockMinorAction(
  res: Response,
  me: { isMinor: boolean | null | undefined },
  action: string,
): boolean {
  if (!me.isMinor) return false;
  apiError(
    res,
    403,
    "This action isn't available on under-13 accounts. Ask your parent or guardian for help.",
    { code: "MINOR_BLOCKED", extras: { minorBlocked: true, action } },
  );
  return true;
}

// Returns true and writes 403 when EITHER side of an interaction is a
// minor. Used for direct messages where neither end may participate.
export async function blockIfEitherMinor(
  res: Response,
  meId: string,
  otherUserId: string,
  action: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: users.id, isMinor: users.isMinor })
    .from(users)
    .where(eq(users.id, otherUserId))
    .limit(1);
  const other = rows[0];
  const [meRow] = await db
    .select({ id: users.id, isMinor: users.isMinor })
    .from(users)
    .where(eq(users.id, meId))
    .limit(1);
  if ((meRow?.isMinor) || (other?.isMinor)) {
    apiError(
      res,
      403,
      "Direct messages aren't available for under-13 accounts.",
      { code: "MINOR_BLOCKED", extras: { minorBlocked: true, action } },
    );
    return true;
  }
  return false;
}

// Profile fields a minor account may NOT set (data-minimization).
// `bio`, `website`, `city`, `state`, and `location` are free-text/PII
// fields that should never appear on a minor profile. Only sport,
// position, jersey number, grade, and avatar are allowed.
export const MINOR_BLOCKED_PROFILE_FIELDS = [
  "bio",
  "website",
  "city",
  "state",
  "location",
] as const;

export function rejectMinorProfileFields(
  res: Response,
  body: Record<string, unknown> | undefined,
): boolean {
  if (!body) return false;
  for (const f of MINOR_BLOCKED_PROFILE_FIELDS) {
    const v = body[f];
    // We treat an explicit `null` (clearing the field) as fine — the
    // restriction is on *adding* PII, not on removing it.
    if (v !== undefined && v !== null && !(typeof v === "string" && v.trim() === "")) {
      apiError(
        res,
        403,
        `The "${f}" field isn't available on under-13 accounts.`,
        { code: "MINOR_BLOCKED", extras: { minorBlocked: true, field: f } },
      );
      return true;
    }
  }
  return false;
}

// Public-shape filter for cross-entity search, /users discovery, the
// contacts picker, and follower listings. A minor row is preserved
// only when the viewer is (a) the minor themselves, or (b) the minor's
// linked parent. Strangers and unauthenticated callers never see minor
// rows.
//
// Each row needs an `id` so we can do the self-check; `parentId` is
// optional and, when present, gates the guardian carve-out. Callers
// that don't select `parentId` get the strict "strangers only" rule,
// which is the safe default.
export function filterOutMinors<
  T extends { id?: string | null; isMinor?: boolean | null; parentId?: string | null },
>(rows: T[], viewerId: string | null): T[] {
  return rows.filter((r) => {
    if (!r.isMinor) return true;
    if (!viewerId) return false;
    if (r.id && r.id === viewerId) return true;
    if (r.parentId && r.parentId === viewerId) return true;
    return false;
  });
}
