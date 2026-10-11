import { createHash } from "node:crypto";
import { db, articles, recapCreationRequests } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";

export const RECAP_CREATION_MIGRATION = `
CREATE TABLE IF NOT EXISTS recap_creation_requests (
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_key text NOT NULL,
  fingerprint text NOT NULL,
  article_id uuid REFERENCES articles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, request_key)
);`;

export class RecapCreationConflict extends Error {}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

export async function createRecapOnce(
  actorId: string,
  key: string | undefined,
  request: unknown,
  values: typeof articles.$inferInsert,
) {
  if (!key) {
    const [article] = await db.insert(articles).values(values).returning();
    return { article, replayed: false };
  }
  const fingerprint = createHash("sha256").update(JSON.stringify(canonical(request))).digest("hex");
  return db.transaction(async (tx) => {
    // Transaction-scoped database lock works across processes/instances. The
    // primary key is an additional durable constraint, not an in-memory cache.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${actorId}:${key}`}, 0))`);
    const [previous] = await tx.select().from(recapCreationRequests).where(and(
      eq(recapCreationRequests.actorId, actorId), eq(recapCreationRequests.requestKey, key),
    ));
    if (previous) {
      if (previous.fingerprint !== fingerprint || !previous.articleId) {
        throw new RecapCreationConflict("This request key has already been used for a different or deleted recap.");
      }
      const [article] = await tx.select().from(articles).where(eq(articles.id, previous.articleId));
      if (!article) throw new RecapCreationConflict("The original recap no longer exists.");
      return { article, replayed: true };
    }
    const [article] = await tx.insert(articles).values(values).returning();
    await tx.insert(recapCreationRequests).values({
      actorId, requestKey: key, fingerprint, articleId: article.id,
    });
    return { article, replayed: false };
  });
}
