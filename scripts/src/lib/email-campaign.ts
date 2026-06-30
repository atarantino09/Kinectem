// Self-contained email-campaign helpers for scheduled @workspace/scripts jobs
// (weekly digest, inactivity nudge).
//
// Leaf workspace packages can't import the api-server's email/notification
// helpers, so the SendGrid send, the COPPA minor->guardian routing, the
// preference gate, and the unsubscribe-link construction are reproduced here.
// Keep this in lockstep with api-server/src/lib/{email,notification-email,
// notification-prefs}.ts — especially the unsubscribe route shape and the
// category->column mapping.

import { db, users, notificationPreferences } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";

// The two engagement categories these scripts send. (The full set lives in
// notification-prefs.ts; scripts only need the ones they dispatch.)
export type EmailCategory = "digest_weekly" | "motivational";

type PrefsRow = typeof notificationPreferences.$inferSelect;

const FIELD_BY_CATEGORY: Record<EmailCategory, keyof PrefsRow> = {
  digest_weekly: "digestWeekly",
  motivational: "motivational",
};

export function appBaseUrl(): string {
  return (process.env.APP_BASE_URL ?? "https://kinectem.replit.app").replace(
    /\/+$/,
    "",
  );
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || "there";
}

export function escapeHtml(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildUnsubscribeUrl(
  token: string,
  category: EmailCategory | "all",
): string {
  const params = new URLSearchParams({ token, cat: category });
  return `${appBaseUrl()}/api/v1/notifications/unsubscribe?${params.toString()}`;
}

// Resolve SendGrid credentials, preferring the Replit connector and falling
// back to env vars. Mirrors api-server/src/lib/email.ts (which scripts can't
// import). Returns null when nothing is configured.
export async function resolveCredentials(): Promise<{
  apiKey: string;
  from: string;
} | null> {
  const envKey = process.env.SENDGRID_API_KEY;
  const envFrom = process.env.EMAIL_FROM;

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? `repl ${process.env.REPL_IDENTITY}`
    : process.env.WEB_REPL_RENEWAL
      ? `depl ${process.env.WEB_REPL_RENEWAL}`
      : null;

  if (hostname && xReplitToken) {
    try {
      const res = await fetch(
        `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=sendgrid`,
        {
          headers: {
            Accept: "application/json",
            "X-Replit-Token": xReplitToken,
          },
        },
      );
      if (res.ok) {
        const data = (await res.json()) as {
          items?: Array<{
            settings?: { api_key?: string; from_email?: string };
          }>;
        };
        const s = data.items?.[0]?.settings;
        const apiKey = s?.api_key ?? envKey;
        const from = s?.from_email ?? envFrom;
        if (apiKey && from) return { apiKey, from };
      }
    } catch {
      // Fall through to env vars.
    }
  }

  if (envKey && envFrom) return { apiKey: envKey, from: envFrom };
  return null;
}

export async function sendEmail(
  creds: { apiKey: string; from: string },
  to: string,
  subject: string,
  text: string,
  html: string,
): Promise<void> {
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: creds.from },
      subject,
      content: [
        { type: "text/plain", value: text },
        { type: "text/html", value: html },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`SendGrid ${res.status} ${body.slice(0, 200)}`);
  }
}

// Lazily create + return the preference row for a user, minting the unsubscribe
// token on first read. Mirrors notification-prefs.ts#getOrCreatePreferences.
async function getOrCreatePreferences(userId: string): Promise<PrefsRow> {
  const [existing] = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .limit(1);
  if (existing) return existing;

  await db
    .insert(notificationPreferences)
    .values({ userId, unsubscribeToken: randomBytes(32).toString("hex") })
    .onConflictDoNothing();

  const [row] = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .limit(1);
  return row;
}

export interface ResolvedRecipient {
  // The user the email is actually sent to (the guardian for a minor target).
  recipientUserId: string;
  to: string;
  recipientName: string;
  // The in-app notification target's name (the minor's, for a guardian copy).
  subjectName: string;
  isGuardianCopy: boolean;
  unsubscribeUrl: string;
}

// Apply the COPPA minor->guardian routing and the recipient's preference gate
// for an engagement email about `targetUserId`. Returns null when the email
// must be suppressed (no recipient email, no guardian for a minor, master pause,
// or the category toggle is off). Mirrors notification-email.ts#dispatch.
export async function resolveRecipient(
  targetUserId: string,
  category: EmailCategory,
): Promise<ResolvedRecipient | null> {
  const [target] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      isMinor: users.isMinor,
      parentId: users.parentId,
    })
    .from(users)
    .where(eq(users.id, targetUserId))
    .limit(1);
  if (!target) return null;

  let recipientId = target.id;
  let recipientEmail = target.email;
  let recipientName = target.name;
  let isGuardianCopy = false;
  const subjectName = target.name;

  if (target.isMinor) {
    // COPPA — never email a minor's own inbox for engagement. Route to the
    // linked guardian; if there is none, suppress.
    if (!target.parentId) return null;
    const [guardian] = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, target.parentId))
      .limit(1);
    if (!guardian?.email) return null;
    recipientId = guardian.id;
    recipientEmail = guardian.email;
    recipientName = guardian.name;
    isGuardianCopy = true;
  }

  if (!recipientEmail) return null;

  const prefs = await getOrCreatePreferences(recipientId);
  if (prefs.pauseAll) return null;
  if (prefs[FIELD_BY_CATEGORY[category]] !== true) return null;

  return {
    recipientUserId: recipientId,
    to: recipientEmail,
    recipientName,
    subjectName,
    isGuardianCopy,
    unsubscribeUrl: buildUnsubscribeUrl(prefs.unsubscribeToken, category),
  };
}

// Shared HTML wrapper so campaign emails share the unsubscribe footer styling.
export function wrapHtml(bodyHtml: string, unsubscribeUrl: string): string {
  return `${bodyHtml}
<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0" />
<p style="font-size:12px;color:#6b7280">You're receiving this because email updates are on for your Kinectem account. <a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe from these emails</a>.</p>`;
}

export function unsubscribeText(unsubscribeUrl: string): string {
  return `\n\n—\nYou're receiving this because email updates are on for your Kinectem account. Unsubscribe: ${unsubscribeUrl}`;
}
