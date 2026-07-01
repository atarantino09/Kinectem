import { Router, type IRouter } from "express";
import { db, dailyAdminDigestRecipients } from "@workspace/db";
import {
  buildDailyAdminDigest,
  getDigestWindow,
  DEFAULT_DIGEST_TIME_ZONE,
} from "@workspace/daily-admin-digest";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { rateLimit, ipKey } from "../middlewares/rate-limit";
import { requireAdmin } from "../middlewares/auth";
import { apiError } from "../lib/spec-helpers";
import { appBaseUrl, sendEmail } from "../lib/email";

const router: IRouter = Router();

const ONE_MINUTE = 60 * 1000;

// The IANA zone used to decide what "yesterday" means for the digest window.
function digestTimeZone(): string {
  return process.env.ADMIN_DIGEST_TIME_ZONE || DEFAULT_DIGEST_TIME_ZONE;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function serialize(row: typeof dailyAdminDigestRecipients.$inferSelect) {
  return {
    id: row.id,
    email: row.email,
    label: row.label,
    enabled: row.enabled,
    lastSentAt: row.lastSentAt ? row.lastSentAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

// Throttle "send preview now" so the button can't be used to fire mail in a
// loop or run repeated (relatively expensive) digest queries.
const previewLimiter = rateLimit({
  name: "daily-digest-preview",
  windowMs: ONE_MINUTE,
  max: 5,
  keys: (req) => [req.sessionUser?.id ?? ipKey(req)],
  message: "You're sending previews too quickly. Please wait a moment.",
});

// Admin-only: list every recipient (enabled and disabled), oldest first.
router.get(
  "/admin/daily-digest/recipients",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const rows = await db
      .select()
      .from(dailyAdminDigestRecipients)
      .orderBy(dailyAdminDigestRecipients.createdAt);
    res.json({ data: rows.map(serialize) });
  }),
);

const CreateBody = z.object({
  email: z.string().trim().email().max(320),
  label: z.string().trim().max(120).optional().nullable(),
});

// Admin-only: add a recipient. Duplicate addresses (case-insensitive) are
// rejected with a 409 rather than silently creating a second row.
router.post(
  "/admin/daily-digest/recipients",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) {
      apiError(res, 400, parsed.error.errors[0]?.message ?? "Invalid request.", {
        code: "VALIDATION_FAILED",
      });
      return;
    }
    const email = parsed.data.email.trim();
    const normalizedEmail = normalizeEmail(email);
    const label = parsed.data.label?.trim() || null;

    const [existing] = await db
      .select({ id: dailyAdminDigestRecipients.id })
      .from(dailyAdminDigestRecipients)
      .where(eq(dailyAdminDigestRecipients.normalizedEmail, normalizedEmail))
      .limit(1);
    if (existing) {
      apiError(res, 409, "That email address is already a recipient.", {
        code: "RECIPIENT_EXISTS",
      });
      return;
    }

    const [row] = await db
      .insert(dailyAdminDigestRecipients)
      .values({
        email,
        normalizedEmail,
        label,
        createdById: req.realUser?.id ?? null,
      })
      .returning();
    res.status(201).json(serialize(row));
  }),
);

const UpdateBody = z.object({
  enabled: z.boolean().optional(),
  label: z.string().trim().max(120).optional().nullable(),
});

// Admin-only: toggle a recipient on/off or rename its label.
router.patch(
  "/admin/daily-digest/recipients/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const parsed = UpdateBody.safeParse(req.body);
    if (!parsed.success) {
      apiError(res, 400, parsed.error.errors[0]?.message ?? "Invalid request.", {
        code: "VALIDATION_FAILED",
      });
      return;
    }
    const patch: Partial<typeof dailyAdminDigestRecipients.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (parsed.data.enabled !== undefined) patch.enabled = parsed.data.enabled;
    if (parsed.data.label !== undefined) {
      patch.label = parsed.data.label?.trim() || null;
    }

    const [row] = await db
      .update(dailyAdminDigestRecipients)
      .set(patch)
      .where(eq(dailyAdminDigestRecipients.id, String(req.params.id)))
      .returning();
    if (!row) {
      apiError(res, 404, "Recipient not found.", { code: "NOT_FOUND" });
      return;
    }
    res.json(serialize(row));
  }),
);

// Admin-only: remove a recipient entirely.
router.delete(
  "/admin/daily-digest/recipients/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const [row] = await db
      .delete(dailyAdminDigestRecipients)
      .where(eq(dailyAdminDigestRecipients.id, String(req.params.id)))
      .returning();
    if (!row) {
      apiError(res, 404, "Recipient not found.", { code: "NOT_FOUND" });
      return;
    }
    res.json({ ok: true });
  }),
);

const PreviewBody = z.object({
  to: z.string().trim().email().max(320).optional(),
});

// Admin-only: build yesterday's digest and send it to a single address (the
// requesting admin by default) so they can preview the real output without
// emailing the whole recipient list. Uses the admin-aware sender.
router.post(
  "/admin/daily-digest/send-preview",
  requireAdmin,
  previewLimiter,
  asyncHandler(async (req, res) => {
    const parsed = PreviewBody.safeParse(req.body);
    if (!parsed.success) {
      apiError(res, 400, parsed.error.errors[0]?.message ?? "Invalid request.", {
        code: "VALIDATION_FAILED",
      });
      return;
    }
    const to = parsed.data.to?.trim() || req.realUser?.email;
    if (!to) {
      apiError(res, 400, "No preview address available.", {
        code: "PREVIEW_ADDRESS_REQUIRED",
      });
      return;
    }

    const tz = digestTimeZone();
    const window = getDigestWindow(new Date(), tz);
    const digest = await buildDailyAdminDigest(db, {
      start: window.start,
      end: window.end,
      appBaseUrl: appBaseUrl(),
      label: window.label,
    });

    try {
      await sendEmail({
        to,
        subject: `[Preview] ${digest.subject}`,
        text: digest.text,
        html: digest.html,
        kind: "daily_admin_digest_preview",
      });
    } catch (err) {
      req.log.error({ err }, "Daily digest preview send failed");
      apiError(res, 502, "Preview failed to send. Check the email configuration.", {
        code: "PREVIEW_SEND_FAILED",
      });
      return;
    }

    res.json({
      ok: true,
      sentTo: to,
      window: { start: window.start.toISOString(), end: window.end.toISOString(), label: window.label },
      totalEvents: digest.totalEvents,
    });
  }),
);

export default router;
