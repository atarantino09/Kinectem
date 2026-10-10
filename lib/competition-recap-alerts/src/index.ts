import { randomBytes } from "node:crypto";
import { db, notificationPreferences } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
export { COMPETITION_RECAP_MIGRATION } from "./migration";

export const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
/** Shared category gate, also used by the ordinary notification-email boundary. */
export function competitionRecapEmailEnabled(prefs: { pauseAll: boolean; competitionRecapMode: string }) {
  return !prefs.pauseAll && (prefs.competitionRecapMode === "digest" || prefs.competitionRecapMode === "immediate");
}
export function recapWindowStart(now: Date): Date {
  return new Date(Math.floor(now.getTime() / TWO_HOURS_MS) * TWO_HOURS_MS);
}

// Identical eligibility is used by counts, list, decisions and the mail worker.
// No permission grant is inferred from curation; takedowns/private content
// remain excluded rather than readable via a new administrator bypass.
const eligibleRecapText = `
 a.status='published' AND a.article_kind='recap' AND a.hidden_at IS NULL
 AND a.recap_kind IS NULL AND a.historical IS NULL
 AND EXISTS (SELECT 1 FROM teams t WHERE t.id=a.team_id AND t.archived_at IS NULL)
 AND (a.author_id IS NULL OR EXISTS (
   SELECT 1 FROM users au WHERE au.id=a.author_id AND au.profile_visibility='public'
   AND au.deleted_at IS NULL AND au.account_status='active'))
 AND NOT EXISTS (SELECT 1 FROM takedown_requests tr WHERE tr.post_kind='article'
   AND tr.post_ref_id=a.id AND tr.status='pending')`;
export function eligibleRecapConditions(alias: "a" | "articles" = "a") {
  return sql.raw(eligibleRecapText.replace(/\ba\./g, `${alias}.`));
}
export const eligibleRecapSql = eligibleRecapConditions();

export async function pendingRecapCount(competitionId: string): Promise<number> {
  const result = await db.execute<{ count: number }>(sql`
    SELECT count(*)::int count FROM articles a WHERE a.competition_id=${competitionId}
    AND a.competition_reviewed_at IS NULL AND NOT a.featured AND ${eligibleRecapSql}`);
  return result.rows[0]?.count ?? 0;
}

export interface RecapMailMessage {
  to: string; subject: string; text: string; html: string; kind: string;
}
export interface RecapMailItem {
  [key: string]: unknown;
  title: string; team: string; competition: string; slug: string; competitionId: string;
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
export function buildRecapMail(args: {
  to: string; name: string; items: RecapMailItem[]; baseUrl: string; token: string; immediate: boolean;
}): RecapMailMessage {
  const base = args.baseUrl.replace(/\/$/, "");
  const groups = new Map<string, RecapMailItem[]>();
  for (const item of args.items) {
    const group = groups.get(item.competitionId) ?? [];
    group.push(item);
    groups.set(item.competitionId, group);
  }
  const settings = `${base}/app/settings`;
  const unsubscribe = `${base}/api/v1/notifications/unsubscribe?${new URLSearchParams({ token: args.token, cat: "competition_recap" })}`;
  const subject = args.immediate ? "A competition recap is ready to review" : `${args.items.length} competition recap${args.items.length === 1 ? "" : "s"} to review`;
  const textParts = [`Hi ${args.name},`, "New coach recaps are ready for your competition review. Reviewing does not change the team's published post."];
  const htmlParts = ["<p>New coach recaps are ready for your competition review. Reviewing does not change the team's published post.</p>"];
  for (const items of groups.values()) {
    const first = items[0]!;
    const link = `${base}/app/competitions/${first.competitionId}?recaps=pending#recaps`;
    textParts.push(`\n${first.competition}`, ...items.map(i => `• ${i.team}: ${i.title}`), `Review recaps: ${link}`);
    htmlParts.push(`<h2>${escapeHtml(first.competition)}</h2><ul>${items.map(i => `<li>${escapeHtml(i.team)}: ${escapeHtml(i.title)}</li>`).join("")}</ul><p><a href="${escapeHtml(link)}">Review recaps</a></p>`);
  }
  textParts.push(`\nEmail settings: ${settings}`, `Unsubscribe from competition recap emails: ${unsubscribe}`);
  htmlParts.push(`<p><a href="${escapeHtml(settings)}">Email settings</a> · <a href="${escapeHtml(unsubscribe)}">Unsubscribe from competition recap emails</a></p>`);
  return { to: args.to, subject, text: textParts.join("\n"), html: htmlParts.join(""), kind: "competition_recap" };
}

// A recipient/window transaction lock is the lease: PostgreSQL releases it on
// crash/disconnect. The lock spans the bounded network send, so an expired
// timestamp cannot let a second live worker send concurrently.
// External email delivery cannot be exactly-once: a crash after provider
// acceptance but before commit may resend. See the scheduling runbook.
export async function deliverCompetitionRecaps(options: {
  baseUrl: string;
  send: (message: RecapMailMessage) => Promise<void>;
  now?: Date;
  maxBatches?: number;
}): Promise<{ sent: number; suppressed: number; failed: number }> {
  const now = options.now ?? new Date();
  const currentWindow = recapWindowStart(now);
  const limit = Math.min(50, Math.max(1, options.maxBatches ?? 25));
  const result = { sent: 0, suppressed: 0, failed: 0 };
  const candidates = await db.execute<{ recipient_id: string; batch_key: string }>(sql`
    SELECT DISTINCT m.recipient_id,
      CASE WHEN m.mode='immediate' THEN 'immediate:'||m.article_id::text
      ELSE 'digest:'||m.window_start::text END batch_key
    FROM competition_recap_mail m
    LEFT JOIN competition_recap_deliveries d ON d.recipient_id=m.recipient_id
      AND d.batch_key=CASE WHEN m.mode='immediate' THEN 'immediate:'||m.article_id::text ELSE 'digest:'||m.window_start::text END
    WHERE m.finished_at IS NULL AND (m.mode='immediate' OR m.window_start<${currentWindow})
      AND (d.retry_at IS NULL OR d.retry_at<=${now})
    ORDER BY batch_key,recipient_id LIMIT ${limit}`);
  for (const candidate of candidates.rows) {
    // Persist unsubscribe access before any irreversible provider acceptance.
    // A rollback/crash after sending must not invalidate the link in that email.
    await db.execute(sql`INSERT INTO notification_preferences(user_id,unsubscribe_token)
      SELECT id,${randomBytes(32).toString("hex")} FROM users WHERE id=${candidate.recipient_id}
      ON CONFLICT DO NOTHING`);
    await db.transaction(async tx => {
      if (candidate.batch_key.startsWith("digest:")) {
        const windowLock = await tx.execute<{ locked: boolean }>(sql`
          SELECT pg_try_advisory_xact_lock(hashtextextended(${`competition-recap-window:${candidate.batch_key.slice(7)}`},0)) locked`);
        if (!windowLock.rows[0]?.locked) return;
      }
      const lock = await tx.execute<{ locked: boolean }>(sql`
        SELECT pg_try_advisory_xact_lock(hashtextextended(${`competition-recap:${candidate.recipient_id}`},0)) locked`);
      if (!lock.rows[0]?.locked) return;
      await tx.execute(sql`INSERT INTO competition_recap_deliveries(recipient_id,batch_key)
        VALUES(${candidate.recipient_id},${candidate.batch_key}) ON CONFLICT DO NOTHING`);
      const deliveries = await tx.execute<{ completed_at: Date | null; retry_at: Date; attempts: number }>(sql`
        SELECT * FROM competition_recap_deliveries WHERE recipient_id=${candidate.recipient_id}
        AND batch_key=${candidate.batch_key} FOR UPDATE`);
      const delivery = deliveries.rows[0]!;
      if (delivery.retry_at > now) return;
      const batchCondition = sql`m.recipient_id=${candidate.recipient_id} AND m.finished_at IS NULL
        AND CASE WHEN m.mode='immediate' THEN 'immediate:'||m.article_id::text ELSE 'digest:'||m.window_start::text END=${candidate.batch_key}`;
      if (delivery.completed_at) {
        await tx.execute(sql`UPDATE competition_recap_mail m SET finished_at=${now} WHERE ${batchCondition}`);
        return;
      }
      const [prefs] = await tx.select().from(notificationPreferences).where(eq(notificationPreferences.userId, candidate.recipient_id));
      const recipients = await tx.execute<{ email: string; name: string }>(sql`
        SELECT email,name FROM users WHERE id=${candidate.recipient_id}
        AND email IS NOT NULL AND NOT is_minor AND deleted_at IS NULL AND account_status='active'`);
      const recipient = recipients.rows[0];
      const immediate = candidate.batch_key.startsWith("immediate:");
      const mode = immediate ? "immediate" : "digest";
      const items = await tx.execute<RecapMailItem>(sql`
        SELECT a.title,t.name team,c.name competition,c.slug,c.id "competitionId"
        FROM competition_recap_mail m
        JOIN competition_recap_publications p ON p.article_id=m.article_id
        JOIN articles a ON a.id=m.article_id AND a.competition_id=p.competition_id
        JOIN tournaments c ON c.id=p.competition_id JOIN teams t ON t.id=a.team_id
        WHERE ${batchCondition} AND ${eligibleRecapSql}
          AND p.created_at > ${prefs?.competitionRecapDiscardBefore ?? new Date(0)}
          AND p.actor_id IS DISTINCT FROM ${candidate.recipient_id}::uuid
          AND a.author_id IS DISTINCT FROM ${candidate.recipient_id}::uuid
          AND EXISTS (
            SELECT 1 FROM unnest(m.target_ids) target_id
            JOIN users target ON target.id=target_id
            JOIN competition_recap_admin_ids(c.id) admins ON admins.user_id=target.id
            WHERE target.deleted_at IS NULL AND target.account_status='active'
            AND target.id IS DISTINCT FROM p.actor_id
            AND target.id IS DISTINCT FROM a.author_id
            AND ((NOT target.is_minor AND target.id=${candidate.recipient_id}::uuid) OR
              (target.is_minor AND EXISTS (SELECT 1 FROM guardian_links gl
                WHERE gl.child_id=target.id AND gl.guardian_id=${candidate.recipient_id} AND gl.status='active')))
          )
        ORDER BY c.id,a.created_at,a.id`);
      try {
      if (recipient && prefs && competitionRecapEmailEnabled(prefs) && prefs.competitionRecapMode === mode && items.rows.length) {
          await options.send(buildRecapMail({
            to: recipient.email, name: recipient.name, items: items.rows,
            baseUrl: options.baseUrl, token: prefs.unsubscribeToken, immediate,
          }));
          result.sent++;
        } else {
          result.suppressed++;
        }
        await tx.execute(sql`UPDATE competition_recap_mail m SET finished_at=${now} WHERE ${batchCondition}`);
        await tx.execute(sql`UPDATE competition_recap_deliveries SET completed_at=${now}
          WHERE recipient_id=${candidate.recipient_id} AND batch_key=${candidate.batch_key}`);
      } catch {
        // Never persist provider errors, which can contain PII/credentials.
        result.failed++;
        const retryAt = new Date(now.getTime() + Math.min(2 * 60 * 60 * 1000, 60_000 * 2 ** Math.min(delivery.attempts, 7)));
        await tx.execute(sql`UPDATE competition_recap_deliveries SET attempts=attempts+1,retry_at=${retryAt}
          WHERE recipient_id=${candidate.recipient_id} AND batch_key=${candidate.batch_key}`);
      }
    });
  }
  return result;
}
