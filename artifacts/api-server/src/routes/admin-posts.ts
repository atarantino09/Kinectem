import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "../lib/auth";
import { asyncHandler } from "../lib/async-handler";

const router: IRouter = Router();
router.use(requireAdmin);

const POST_TYPES = [
  { value: "game_recap", label: "Game recap" },
  { value: "combined_recap", label: "Combined recap" },
  { value: "historical_recap", label: "Historical recap" },
  { value: "practice_plan", label: "Practice plan" },
  { value: "highlight", label: "Highlight" },
  { value: "org_post", label: "Organization post" },
  { value: "news", label: "In the news" },
];

const querySchema = z.object({
  q: z.string().trim().max(200).optional(),
  sport: z.string().trim().max(120).optional(),
  location: z.string().trim().max(200).optional(),
  organizationId: z.union([z.string().uuid(), z.literal("none")]).optional(),
  postType: z.enum(["game_recap", "combined_recap", "historical_recap", "practice_plan", "highlight", "org_post", "news"]).optional(),
  sort: z.enum(["newest", "oldest", "sport", "location", "organization", "post_type"]).default("newest"),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

// Deliberately separate from public-feed queries: this is a strictly
// platform-admin, read-only inventory including nonpublic content. It must
// never be mounted without requireAdmin or reused in public/community feeds.
const inventory = sql`
  WITH sources AS (
    SELECT 'article-' || a.id::text AS id, a.id AS source_id,
      CASE WHEN a.article_kind = 'practice_plan' THEN 'practice_plan'
        WHEN a.historical IS NOT NULL THEN 'historical_recap'
        WHEN a.recap_kind = 'combined' THEN 'combined_recap'
        ELSE 'game_recap' END AS type,
      a.title, LEFT(COALESCE(NULLIF(a.summary, ''), a.body, ''), 600) AS excerpt,
      a.created_at, a.status::text AS status, a.hidden_at IS NOT NULL AS hidden,
      a.author_id, a.team_id, NULL::uuid AS direct_org_id
    FROM articles a
    UNION ALL
    SELECT 'highlight-' || h.id::text, h.id, 'highlight', h.title,
      LEFT(COALESCE(h.description, ''), 600), h.created_at,
      h.approval_status::text, h.hidden_at IS NOT NULL,
      h.uploader_id, h.team_id, NULL::uuid
    FROM highlights h
    UNION ALL
    SELECT 'orgpost-' || p.id::text, p.id,
      CASE WHEN p.historical IS NOT NULL THEN 'historical_recap'
        WHEN p.recap_kind = 'combined' THEN 'combined_recap'
        ELSE 'org_post' END,
      p.title, LEFT(p.body, 600), p.created_at, p.status::text,
      p.hidden_at IS NOT NULL, p.author_id, NULL::uuid, p.organization_id
    FROM org_posts p
    UNION ALL
    SELECT 'news-' || n.id::text, n.id, 'news', n.title,
      LEFT(COALESCE(n.description, ''), 600), n.created_at, 'published',
      FALSE, n.added_by_user_id, n.team_id, NULL::uuid
    FROM team_news_links n
  ), posts AS (
    SELECT s.*, u.name AS author_name, t.name AS team_name,
      o.id AS organization_id, o.name AS organization_name,
      NULLIF(LOWER(TRIM(COALESCE(NULLIF(o.sport, ''), NULLIF(t.sport, ''), u.sport, ''))), '') AS sport,
      COALESCE(
        NULLIF(CONCAT_WS(', ', NULLIF(TRIM(o.city), ''), NULLIF(TRIM(o.state), '')), ''),
        NULLIF(TRIM(o.location), ''),
        NULLIF(CONCAT_WS(', ', NULLIF(TRIM(u.city), ''), NULLIF(TRIM(u.state), '')), ''),
        NULLIF(TRIM(u.location), '')
      ) AS location
    FROM sources s
    LEFT JOIN users u ON u.id = s.author_id
    LEFT JOIN teams t ON t.id = s.team_id
    LEFT JOIN organizations o ON o.id = COALESCE(s.direct_org_id, t.organization_id)
  )
`;

const sorts: Record<z.infer<typeof querySchema>["sort"], SQL> = {
  newest: sql`p.created_at DESC, p.id DESC`,
  oldest: sql`p.created_at ASC, p.id ASC`,
  sport: sql`p.sport ASC NULLS LAST, p.created_at DESC, p.id DESC`,
  location: sql`LOWER(p.location) ASC NULLS LAST, p.created_at DESC, p.id DESC`,
  organization: sql`LOWER(p.organization_name) ASC NULLS LAST, p.created_at DESC, p.id DESC`,
  post_type: sql`p.type ASC, p.created_at DESC, p.id DESC`,
};

type InventoryRow = {
  id: string;
  source_id: string;
  type: string;
  title: string;
  excerpt: string;
  created_at: Date | string;
  status: string;
  hidden: boolean;
  sport: string | null;
  location: string | null;
  author_id: string | null;
  author_name: string | null;
  team_id: string | null;
  team_name: string | null;
  organization_id: string | null;
  organization_name: string | null;
};

function likePattern(value: string) {
  return `%${value.replace(/[\\%_]/g, "\\$&")}%`;
}

function plainExcerpt(value: string) {
  const plain = value.replace(/@\[([^\]]+)\]\(user:[^)]+\)/g, "$1")
    .replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  return plain.length > 220 ? `${plain.slice(0, 220)}…` : plain;
}

router.get("/posts", asyncHandler(async (req, res) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid post filters", details: parsed.error.flatten() });
    return;
  }
  const filters = parsed.data;
  const conditions: SQL[] = [];
  if (filters.postType) conditions.push(sql`p.type = ${filters.postType}`);
  if (filters.sport) conditions.push(sql`p.sport = ${filters.sport.toLowerCase()}`);
  if (filters.location) conditions.push(sql`p.location ILIKE ${likePattern(filters.location)}`);
  if (filters.organizationId === "none") conditions.push(sql`p.organization_id IS NULL`);
  else if (filters.organizationId) conditions.push(sql`p.organization_id = ${filters.organizationId}`);
  if (filters.q) {
    const pattern = likePattern(filters.q);
    conditions.push(sql`(p.title ILIKE ${pattern} OR p.author_name ILIKE ${pattern}
      OR p.team_name ILIKE ${pattern} OR p.organization_name ILIKE ${pattern})`);
  }
  const where = conditions.length ? sql.join(conditions, sql` AND `) : sql`TRUE`;
  const [items, counts, facets] = await Promise.all([
    db.execute(sql`${inventory} SELECT p.* FROM posts p WHERE ${where}
      ORDER BY ${sorts[filters.sort]} LIMIT ${filters.limit} OFFSET ${filters.offset}`),
    db.execute(sql`${inventory} SELECT COUNT(*)::int AS total FROM posts p WHERE ${where}`),
    db.execute(sql`${inventory} SELECT
      ARRAY(SELECT DISTINCT sport FROM posts WHERE sport IS NOT NULL ORDER BY sport) AS sports,
      ARRAY(SELECT DISTINCT location FROM posts WHERE location IS NOT NULL ORDER BY location) AS locations,
      COALESCE((SELECT JSON_AGG(r ORDER BY r.name, r.id) FROM (
        SELECT DISTINCT COALESCE(organization_id::text, 'none') AS id,
          COALESCE(organization_name, 'Independent teams / profile only') AS name
        FROM posts
      ) r), '[]'::json) AS organizations`),
  ]);
  const totalCount = Number(counts.rows[0]?.total ?? 0);
  const rows = items.rows as unknown as InventoryRow[];
  res.json({
    data: rows.map((row) => ({
      id: row.id,
      sourceId: row.source_id,
      type: row.type,
      title: row.title,
      excerpt: plainExcerpt(row.excerpt),
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
      status: row.status,
      hidden: row.hidden,
      sport: row.sport,
      location: row.location,
      author: row.author_id ? { id: row.author_id, name: row.author_name ?? "Deleted user" } : null,
      team: row.team_id ? { id: row.team_id, name: row.team_name ?? "Removed team" } : null,
      organization: row.organization_id ? { id: row.organization_id, name: row.organization_name } : null,
    })),
    pagination: {
      totalCount,
      limit: filters.limit,
      offset: filters.offset,
      hasMore: filters.offset + rows.length < totalCount,
    },
    facets: { ...facets.rows[0], postTypes: POST_TYPES },
  });
}));

export default router;
