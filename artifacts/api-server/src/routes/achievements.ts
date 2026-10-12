import { Router } from "express";
import { z } from "zod";
import { sql, eq, and } from "drizzle-orm";
import { db, users, teams, organizations, userFollowers } from "@workspace/db";
import { ACHIEVEMENT_CATALOG, type AchievementSubject } from "../lib/achievement-catalog";
import { asyncHandler } from "../lib/async-handler";
import { apiError, notFound } from "../lib/spec-helpers";
import { canManageTeam, canManageOrganization } from "../lib/permissions";

const router = Router();
const Subject = z.enum(["user", "team", "organization"]);
const Id = z.string().uuid();
type Executor = Pick<typeof db, "execute">;
async function rows<T>(query: Parameters<Executor["execute"]>[0], executor: Executor = db): Promise<T[]> {
  return (await executor.execute(query)).rows as T[];
}
type Award = { key: string; tier: number; threshold: number; earnedAt: string; celebrated: boolean };
async function awards(subject: AchievementSubject, id: string): Promise<Award[]> {
  return rows<Award>(sql`SELECT DISTINCT ON(key) key,tier,threshold,earned_at AS "earnedAt",celebrated
    FROM achievement_awards WHERE subject=${subject} AND subject_id=${id}::uuid ORDER BY key,tier DESC`);
}
async function settings(subject: AchievementSubject, id: string) {
  return (await rows<{ visibility: "public" | "private"; featured: string[] }>(sql`
    SELECT visibility,featured FROM achievement_settings WHERE subject=${subject} AND subject_id=${id}::uuid`))[0]
    ?? { visibility: "private" as const, featured: [] };
}
async function access(subject: AchievementSubject, id: string, viewerId?: string) {
  if (subject === "user") {
    const [u] = await db.select().from(users).where(eq(users.id, id));
    const adultCutoff = new Date();
    adultCutoff.setUTCFullYear(adultCutoff.getUTCFullYear() - 18);
    adultCutoff.setUTCHours(0, 0, 0, 0);
    // Never build an athlete achievement system, including under-18 accounts
    // not covered by the existing under-13 isMinor snapshot.
    if (!u || u.isMinor || u.deletedAt || u.accountStatus !== "active" || u.role === "admin"
      || (u.dateOfBirth && u.dateOfBirth > adultCutoff)) return null;
    const own = viewerId === id;
    let visible = u.profileVisibility === "public";
    if (!own && !visible && viewerId && u.profileVisibility === "followers") {
      visible = !!(await db.select().from(userFollowers).where(and(
        eq(userFollowers.followingUserId, id), eq(userFollowers.followerUserId, viewerId),
        eq(userFollowers.moderationStatus, "approved"),
      )))[0];
    }
    if (!own && (!visible || (await settings(subject, id)).visibility !== "public")) return null;
    return { canManage: own };
  }
  if (subject === "team") {
    const [team] = await db.select().from(teams).where(eq(teams.id, id));
    if (!team) return null;
    const canManage = !!viewerId && await canManageTeam(viewerId, team);
    if (team.archivedAt && !canManage) return null;
    return { canManage };
  }
  const [org] = await db.select().from(organizations).where(eq(organizations.id, id));
  if (!org) return null;
  return { canManage: !!viewerId && await canManageOrganization(viewerId, id) };
}

router.get("/achievements/:subject/:id", asyncHandler(async (req, res): Promise<void> => {
  const subject = Subject.safeParse(req.params.subject);
  const id = Id.safeParse(req.params.id);
  if (!subject.success || !id.success) { apiError(res, 400, "Invalid achievement subject."); return; }
  const rights = await access(subject.data, id.data, req.sessionUser?.id);
  if (!rights) { notFound(res); return; }
  // Repairs interrupted older app evaluations and serializes settings-independent awards.
  await db.execute(sql`SELECT achievement_evaluate(${subject.data},${id.data}::uuid)`);
  const earned = await awards(subject.data, id.data);
  const prefs = await settings(subject.data, id.data);
  const rollout = await rows<{ rolloutAt: string }>(sql`SELECT started_at AS "rolloutAt" FROM achievement_rollout`);
  const result: Record<string, unknown> = {
    subject: subject.data, id: id.data, ...rights,
    visibility: subject.data === "user" ? prefs.visibility : "public",
    featured: prefs.featured.filter((key) => earned.some((a) => a.key === key)),
    catalog: ACHIEVEMENT_CATALOG.filter((c) => c.subject === subject.data),
    awards: earned.map((a) => rights.canManage ? a : { key: a.key, tier: a.tier, threshold: a.threshold, earnedAt: a.earnedAt }),
    rolloutAt: rollout[0]?.rolloutAt,
  };
  if (rights.canManage) {
    const metrics = await rows<{ metric: string; value: number }>(sql`
      SELECT * FROM achievement_metrics(${subject.data},${id.data}::uuid)`);
    const byMetric = Object.fromEntries(metrics.map((m) => [m.metric, m.value]));
    result.progress = Object.fromEntries(ACHIEVEMENT_CATALOG.filter((c) => c.subject === subject.data)
      .map((c) => [c.key, byMetric[c.metric] ?? 0]));
    if (subject.data !== "organization") {
      const streaks = await rows<{ teamId: string }>(sql`SELECT s.team_id AS "teamId",t.name AS "teamName",
        CASE WHEN NOT s.paused AND s.deadline<now() THEN 0 ELSE s.current_count END AS current,
        s.best,s.paused,s.deadline,s.last_day AS "lastDay",
        CASE WHEN s.paused THEN 'paused' WHEN s.deadline<now() THEN 'expired'
          WHEN s.resumed THEN 'resumed' ELSE 'active' END AS status
        FROM achievement_streaks s JOIN teams t ON t.id=s.team_id
        WHERE (${subject.data}='team' AND s.team_id=${id.data}::uuid AND s.contributor_id='team')
          OR (${subject.data}='user' AND s.contributor_id=${id.data})`);
      result.streaks = await Promise.all(streaks.map(async (s) => ({
        ...s, canPause: (await access("team", s.teamId, req.sessionUser?.id))?.canManage === true,
      })));
    } else {
      result.participation = await rows(sql`SELECT t.id AS "teamId",t.name,
        EXISTS(SELECT 1 FROM achievement_live_contributions c WHERE c.team_id=t.id
          AND c.organization_id=t.organization_id AND c.is_public AND c.live_category IN ('current','update') AND c.eligible_at>=now()-interval '30 days') AS participating
        FROM teams t WHERE t.organization_id=${id.data}::uuid AND t.archived_at IS NULL
          AND EXISTS(SELECT 1 FROM achievement_live_contributions c WHERE c.team_id=t.id
            AND c.organization_id=t.organization_id AND c.is_public AND c.live_category IN ('current','update') AND c.eligible_at>=now()-interval '90 days')
        ORDER BY t.name,t.id`);
    }
    // The action is a normal post link; upload permission remains album-owned.
    if (subject.data === "team") {
      result.photoRecapId = (await rows<{ id: string }>(sql`SELECT 'article-'||ref_id::text AS id
        FROM achievement_live_contributions WHERE team_id=${id.data}::uuid AND is_public
          AND live_category IN ('current','retro') ORDER BY eligible_at DESC LIMIT 1`))[0]?.id ?? null;
    }
  }
  res.setHeader("Cache-Control", "private, no-store");
  res.json(result);
}));

router.put("/achievements/:subject/:id", asyncHandler(async (req, res): Promise<void> => {
  if (!req.sessionUser) { apiError(res, 401, "Not authenticated"); return; }
  const subject = Subject.safeParse(req.params.subject), id = Id.safeParse(req.params.id);
  const input = z.object({ visibility: z.enum(["private", "public"]).optional(),
    featured: z.array(z.string()).max(3).refine((v) => new Set(v).size === v.length).optional() }).strict().safeParse(req.body);
  if (!subject.success || !id.success || !input.success) { apiError(res, 400, "Invalid achievement settings."); return; }
  if (!(await access(subject.data, id.data, req.sessionUser.id))?.canManage) { apiError(res, 403, "Only the owner or authorized manager can change achievements."); return; }
  if (subject.data !== "user" && input.data.visibility) { apiError(res, 400, "Visibility is a personal achievement setting."); return; }
  const earned = await awards(subject.data, id.data);
  if (input.data.featured?.some((key) => !earned.some((a) => a.key === key))) { apiError(res, 400, "Only earned achievements can be featured."); return; }
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`achievement-settings:${subject.data}:${id.data}`},0))`);
    const old = (await rows<{ visibility: string; featured: string[] }>(sql`
      SELECT visibility,featured FROM achievement_settings WHERE subject=${subject.data} AND subject_id=${id.data}::uuid`, tx))[0];
    await tx.execute(sql`INSERT INTO achievement_settings(subject,subject_id,visibility,featured)
      VALUES(${subject.data},${id.data}::uuid,${input.data.visibility ?? old?.visibility ?? "private"},
        ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(input.data.featured ?? old?.featured ?? [])}::jsonb)) )
      ON CONFLICT(subject,subject_id) DO UPDATE SET visibility=excluded.visibility,featured=excluded.featured`);
  });
  res.json({ ok: true });
}));

router.post("/achievements/team/:id/pause", asyncHandler(async (req, res): Promise<void> => {
  if (!req.sessionUser) { apiError(res, 401, "Not authenticated"); return; }
  const id = Id.safeParse(req.params.id);
  if (!id.success || !z.object({ confirmed: z.literal(true) }).strict().safeParse(req.body).success) {
    apiError(res, 400, "Confirm this team hasn't played since its last recap."); return;
  }
  if (!(await access("team", id.data, req.sessionUser.id))?.canManage) { apiError(res, 403, "Only team managers can pause a streak."); return; }
  const updated = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('achievement-evaluation',0))`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('achievement-team:'||${id.data},0))`);
    const paused = await rows(sql`UPDATE achievement_streaks SET paused=true,resumed=false
      WHERE team_id=${id.data}::uuid AND current_count>0 AND (paused OR deadline>=now()) RETURNING team_id`, tx);
    if (paused.length) await tx.execute(sql`INSERT INTO achievement_pauses(team_id,attested_by) VALUES(${id.data}::uuid,${req.sessionUser!.id}::uuid)`);
    return paused;
  });
  if (!updated.length) { apiError(res, 409, "This streak has expired or has not started. A new recap starts a new run."); return; }
  res.json({ ok: true });
}));

router.post("/achievements/:subject/:id/acknowledge", asyncHandler(async (req, res): Promise<void> => {
  if (!req.sessionUser) { apiError(res, 401, "Not authenticated"); return; }
  const subject = Subject.safeParse(req.params.subject), id = Id.safeParse(req.params.id);
  if (!subject.success || !id.success) { apiError(res, 400, "Invalid achievement subject."); return; }
  if (!(await access(subject.data, id.data, req.sessionUser.id))?.canManage) { apiError(res, 403, "Not authorized."); return; }
  await db.execute(sql`UPDATE achievement_awards SET celebrated=true WHERE subject=${subject.data} AND subject_id=${id.data}::uuid`);
  res.json({ ok: true });
}));

router.get("/organizations/:id/contributors", asyncHandler(async (req, res): Promise<void> => {
  const id = Id.safeParse(req.params.id);
  if (!id.success) { apiError(res, 400, "Invalid organization."); return; }
  if (!(await access("organization", id.data, req.sessionUser?.id))) { notFound(res); return; }
  const people = await rows<{ id: string; name: string; role: string; teams: { id: string; name: string }[] }>(sql`
    SELECT u.id,u.name,CASE WHEN bool_or(r.role='coach') THEN 'Coach' ELSE 'Contributor' END AS role,
      jsonb_agg(DISTINCT jsonb_build_object('id',t.id,'name',t.name)) AS teams
    FROM users u JOIN teams t ON t.organization_id=${id.data}::uuid
    LEFT JOIN roster_entries r ON r.user_id=u.id AND r.team_id=t.id AND r.status='accepted'
    WHERE t.archived_at IS NULL
      AND ((r.role='coach' OR r.position IN ('author','manager','assistant_coach','head_coach'))
        OR (EXISTS(SELECT 1 FROM organization_admins oa WHERE oa.user_id=u.id AND oa.organization_id=t.organization_id
          AND oa.role IN ('owner','admin')) AND EXISTS(SELECT 1 FROM achievement_contributions c
          WHERE c.author_id=u.id AND c.team_id=t.id AND c.personal_eligible)))
      AND NOT u.is_minor AND u.role<>'admin' AND u.deleted_at IS NULL AND u.account_status='active'
      AND u.profile_visibility='public' AND (u.date_of_birth IS NULL OR u.date_of_birth<=now()-interval '18 years')
    GROUP BY u.id,u.name ORDER BY u.name,u.id`);
  const data = await Promise.all(people.map(async (p) => {
    const prefs = await settings("user", p.id);
    return { ...p, awards: prefs.visibility === "public"
      ? (await awards("user", p.id)).map(({ key, tier, threshold, earnedAt }) => ({ key, tier, threshold, earnedAt })) : [],
      featured: prefs.visibility === "public" ? prefs.featured : [] };
  }));
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ data });
}));

export default router;
