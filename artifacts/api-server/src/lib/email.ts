import { logger } from "./logger.js";

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

const SENDGRID_URL = "https://api.sendgrid.com/v3/mail/send";

function getConfig() {
  const apiKey = process.env.SENDGRID_API_KEY;
  const from = process.env.EMAIL_FROM;
  return { apiKey, from };
}

export function isEmailConfigured(): boolean {
  const { apiKey, from } = getConfig();
  return Boolean(apiKey && from);
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  const { apiKey, from } = getConfig();
  if (!apiKey || !from) {
    logger.warn(
      { to: message.to, subject: message.subject },
      "Email not sent: SENDGRID_API_KEY and/or EMAIL_FROM are not configured.",
    );
    return;
  }

  const body = {
    personalizations: [{ to: [{ email: message.to }] }],
    from: { email: from },
    subject: message.subject,
    content: [
      { type: "text/plain", value: message.text },
      ...(message.html
        ? [{ type: "text/html", value: message.html }]
        : []),
    ],
  };

  const res = await fetch(SENDGRID_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.error(
      { status: res.status, to: message.to, subject: message.subject, body: text },
      "SendGrid email delivery failed",
    );
    throw new Error(`Email delivery failed (${res.status})`);
  }
}

function appBaseUrl(): string {
  return (
    process.env.APP_BASE_URL ??
    (process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : "http://localhost:5173")
  ).replace(/\/+$/, "");
}

export function buildPasswordResetUrl(token: string): string {
  return `${appBaseUrl()}/reset-password/${token}`;
}

export function buildGuardianConfirmUrl(token: string): string {
  return `${appBaseUrl()}/guardian-confirm/${token}`;
}

export async function sendPasswordResetEmail(
  to: string,
  token: string,
): Promise<void> {
  const url = buildPasswordResetUrl(token);
  await sendEmail({
    to,
    subject: "Reset your Kinectem password",
    text: `Someone asked to reset the password for your Kinectem account.

Open this link within the next hour to choose a new password:
${url}

If you didn't request this, you can ignore this email and your password will stay the same.`,
    html: `<p>Someone asked to reset the password for your Kinectem account.</p>
<p>Open this link within the next hour to choose a new password:</p>
<p><a href="${url}">${url}</a></p>
<p>If you didn't request this, you can ignore this email and your password will stay the same.</p>`,
  });
}

export async function sendGuardianConfirmationEmail(
  to: string,
  athleteName: string,
  token: string,
): Promise<void> {
  const url = buildGuardianConfirmUrl(token);
  await sendEmail({
    to,
    subject: `Confirm ${athleteName}'s Kinectem account`,
    text: `${athleteName} just signed up for Kinectem and listed you as their parent or guardian.

Because they are under 13, the account cannot be used until you confirm it. Open this link to confirm:
${url}

If you don't recognize this signup, you can ignore this email and the account will stay locked.`,
    html: `<p><strong>${athleteName}</strong> just signed up for Kinectem and listed you as their parent or guardian.</p>
<p>Because they are under 13, the account cannot be used until you confirm it. Open this link to confirm:</p>
<p><a href="${url}">${url}</a></p>
<p>If you don't recognize this signup, you can ignore this email and the account will stay locked.</p>`,
  });
}
