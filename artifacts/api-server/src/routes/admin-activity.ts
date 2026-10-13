import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { requireAdmin } from "../lib/auth";

const router = Router();
router.use(requireAdmin);

// Legacy audit records include some coach/org-admin actions: classify by the
// actor's role, not by the misleading legacy table/column names.
const activity = sql`
  SELECT a.id::text, a.admin_user_id AS actor_id,
    CASE WHEN u.role='admin' THEN 'admin' ELSE 'user' END AS actor_type,
    a.action_type::text, a.target_type::text, a.target_id::text,
    a.metadata, a.created_at AT TIME ZONE 'UTC' AS created_at,
    'audit' AS source, NULL::uuid AS effective_user_id
  FROM admin_activity_log a LEFT JOIN users u ON u.id=a.admin_user_id
  UNION ALL
  SELECT a.id::text, a.actor_id, a.actor_type, a.action_type,
    a.resource, NULL::text,
    json_build_object('route',a.route)::text, a.created_at,
    'activity', a.effective_user_id
  FROM user_activity_log a
`;
const filters = z.object({
  actorType: z.enum(["all", "user", "admin"]).default("all"),
  adminUserId: z.string().uuid().optional(),
  actionType: z.string().max(100).optional(),
  order: z.enum(["newest", "oldest"]).default("newest"),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

router.get("/activity", asyncHandler(async (req, res) => {
  const parsed = filters.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Invalid activity filters." }); return; }
  const f = parsed.data;
  const where = sql`
    (${f.actorType}='all' OR a.actor_type=${f.actorType})
    AND (${f.adminUserId ?? null}::uuid IS NULL OR a.actor_id=${f.adminUserId ?? null}::uuid)
    AND (${f.actionType ?? null}::text IS NULL OR a.action_type=${f.actionType ?? null})
  `;
  const [rows, counts] = await Promise.all([
    db.execute(sql`WITH activity AS (${activity})
      SELECT a.*, u.name, u.email FROM activity a
      LEFT JOIN users u ON u.id=a.actor_id WHERE ${where}
      ORDER BY a.created_at ${f.order === "oldest" ? sql`ASC` : sql`DESC`}, a.id
      LIMIT ${f.limit} OFFSET ${f.offset}`),
    db.execute(sql`WITH activity AS (${activity})
      SELECT count(*)::int AS total FROM activity a WHERE ${where}`),
  ]);
  const total = Number(counts.rows[0]?.total ?? 0);
  res.json({
    data: rows.rows.map((r) => ({
      id: `${r.source}-${r.id}`, actionType: r.action_type,
      actorType: r.actor_type, source: r.source, effectiveUserId: r.effective_user_id,
      targetType: r.target_type, targetId: r.target_id,
      metadata: parseMetadata(r.metadata),
      createdAt: new Date(r.created_at as string).toISOString(),
      admin: r.actor_id ? { id: r.actor_id, name: r.name ?? "Deleted user", email: r.email } : null,
    })),
    pagination: { nextCursor: null, hasMore: f.offset + rows.rows.length < total, totalCount: total, limit: f.limit, offset: f.offset },
  });
}));

function parseMetadata(value: unknown) {
  if (typeof value !== "string") return null;
  try { return JSON.parse(value); } catch { return null; }
}

router.get("/activity/admins", asyncHandler(async (_req, res) => {
  const rows = await db.execute(sql`WITH activity AS (${activity})
    SELECT DISTINCT u.id,u.name,u.email FROM activity a
    JOIN users u ON u.id=a.actor_id ORDER BY u.name,u.id`);
  res.json({ data: rows.rows });
}));
router.get("/activity/actions", asyncHandler(async (_req, res) => {
  const rows = await db.execute(sql`WITH activity AS (${activity})
    SELECT DISTINCT action_type FROM activity ORDER BY action_type`);
  res.json({ data: rows.rows.map((r) => r.action_type) });
}));
export default router;
