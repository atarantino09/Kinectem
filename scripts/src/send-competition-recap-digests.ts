// Durable recipient/window worker. Run every minute in a Scheduled Deployment,
// separately from Autoscale. --dry-run only counts due batches (no writes/mail).
import { createDecipheriv, scryptSync } from "node:crypto";
import { db, emailProviderKeys, pool } from "@workspace/db";
import { deliverCompetitionRecaps, recapWindowStart } from "@workspace/competition-recap-alerts";
import { renderBrandedEmailHtml } from "@workspace/email-template";
import { eq, sql } from "drizzle-orm";
import { appBaseUrl, resolveCredentials } from "./lib/email-campaign";

async function recapCredentials() {
  const [admin] = await db.select().from(emailProviderKeys).where(eq(emailProviderKeys.provider, "sendgrid"));
  if (!admin?.keyCiphertext || !admin.fromEmail) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        resolveCredentials(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Email credential lookup timed out")), 10_000); }),
      ]);
    } finally { if (timer) clearTimeout(timer); }
  }
  const explicit = process.env.AI_KEYS_ENCRYPTION_KEY;
  const secret = explicit && explicit.length >= 16 ? explicit : process.env.SESSION_SECRET;
  if (!secret) throw new Error("Email credential decryption is not configured");
  const [iv, tag, ciphertext] = admin.keyCiphertext.split(".");
  if (!iv || !tag || !ciphertext) throw new Error("Invalid stored email credential");
  const decipher = createDecipheriv("aes-256-gcm", scryptSync(secret, "kinectem-ai-keys-v1", 32), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return {
    apiKey: Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8"),
    from: admin.fromEmail,
  };
}

async function main() {
  if (process.argv.includes("--dry-run")) {
    const due = await db.execute<{ count: number }>(sql`
      SELECT count(*)::int count FROM (
        SELECT DISTINCT recipient_id,CASE WHEN mode='immediate' THEN article_id::text ELSE window_start::text END
        FROM competition_recap_mail WHERE finished_at IS NULL
        AND (mode='immediate' OR window_start<${recapWindowStart(new Date())})
      ) batches`);
    console.log(`Due competition recap batches: ${due.rows[0]?.count ?? 0}. Dry run: nothing sent or claimed.`);
    return;
  }
  const baseUrl = appBaseUrl();
  const result = await deliverCompetitionRecaps({
    baseUrl, maxBatches: 50,
    send: async message => {
      const creds = await recapCredentials();
      if (!creds) throw new Error("Email is not configured");
      const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST", signal: AbortSignal.timeout(30_000),
        headers: { Authorization: `Bearer ${creds.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: message.to }] }], from: { email: creds.from },
          subject: message.subject,
          content: [
            { type: "text/plain", value: message.text },
            { type: "text/html", value: renderBrandedEmailHtml({ bodyHtml: message.html, subject: message.subject, baseUrl }) },
          ],
        }),
      });
      if (!response.ok) throw new Error(`Email delivery failed (${response.status})`);
    },
  });
  console.log(`Competition recap batches: sent=${result.sent}, suppressed=${result.suppressed}, retrying=${result.failed}`);
  if (result.failed) process.exitCode = 1;
}
main().catch(() => {
  // Do not print provider/credential errors or recipient information.
  console.error("Competition recap worker failed; check database and email configuration.");
  process.exitCode = 1;
}).finally(() => pool.end());
