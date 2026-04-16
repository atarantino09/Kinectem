import { Router, type IRouter } from "express";
import { db, notifications } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { asyncHandler } from "../lib/async-handler";
import { requireAuth } from "../lib/auth";
import { toNotification } from "../lib/serializers";

const router: IRouter = Router();

router.get(
  "/me/notifications",
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, req.sessionUser!.id))
      .orderBy(desc(notifications.createdAt))
      .limit(50);
    res.json(rows.map(toNotification));
  }),
);

router.post(
  "/me/notifications/:notificationId/read",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { notificationId } = req.params;
    await db
      .update(notifications)
      .set({ read: true })
      .where(and(eq(notifications.id, notificationId), eq(notifications.userId, req.sessionUser!.id)));
    res.status(204).end();
  }),
);

export default router;
