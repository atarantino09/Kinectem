import { Router, type IRouter } from "express";
import { db, announcements } from "@workspace/db";
import { and, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { asyncHandler } from "../lib/async-handler";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

// GET /announcements/active — active, in-window platform announcements for the
// global in-app banner. Any logged-in user may read; authoring lives under the
// admin router. The optional startsAt/endsAt window scopes visibility.
router.get(
  "/announcements/active",
  requireAuth,
  asyncHandler(async (_req, res) => {
    const now = new Date();
    const rows = await db
      .select({
        id: announcements.id,
        title: announcements.title,
        body: announcements.body,
        level: announcements.level,
      })
      .from(announcements)
      .where(
        and(
          eq(announcements.active, true),
          or(isNull(announcements.startsAt), lte(announcements.startsAt, now)),
          or(isNull(announcements.endsAt), gte(announcements.endsAt, now)),
        ),
      )
      .orderBy(desc(announcements.createdAt))
      .limit(20);
    res.json({ data: rows });
  }),
);

export default router;
