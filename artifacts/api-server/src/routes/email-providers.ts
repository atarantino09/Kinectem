import { Router, type IRouter } from "express";
import { db, emailProviderKeys } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { rateLimit, ipKey } from "../middlewares/rate-limit";
import { requireAdmin } from "../middlewares/auth";
import { apiError } from "../lib/spec-helpers";
import { encryptSecret } from "../lib/secret-crypto";
import { isEmailConfigured, sendEmail } from "../lib/email";

const router: IRouter = Router();

const SUPPORTED_PROVIDERS = ["sendgrid"] as const;
type Provider = (typeof SUPPORTED_PROVIDERS)[number];
function isProvider(p: string): p is Provider {
  return (SUPPORTED_PROVIDERS as readonly string[]).includes(p);
}

const ONE_MINUTE = 60 * 1000;

// Throttle the test-send so the button can't be used to fire mail in a loop.
const emailTestLimiter = rateLimit({
  name: "email-test",
  windowMs: ONE_MINUTE,
  max: 5,
  keys: (req) => [req.sessionUser?.id ?? ipKey(req)],
  message: "You're sending test emails too quickly. Please wait a moment.",
});

// Admin-only: SendGrid credential management. The raw key is never returned —
// only the last 4 digits and the verified sender address. These credentials,
// when set, take precedence over the Replit connector / env vars at send time.
router.get(
  "/admin/email-providers",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const rows = await db.select().from(emailProviderKeys);
    const byProvider = new Map(rows.map((r) => [r.provider, r]));
    const data = SUPPORTED_PROVIDERS.map((provider) => {
      const r = byProvider.get(provider);
      return {
        provider,
        configured: !!r,
        fromEmail: r?.fromEmail ?? null,
        keyLast4: r?.keyLast4 ?? null,
        updatedAt: r?.updatedAt ? r.updatedAt.toISOString() : null,
      };
    });
    // Tell the UI whether the env / Replit connector fallback is available so
    // it can show "email still works via the connector" even with no key here.
    res.json({ data, fallbackConfigured: isEmailConfigured() });
  }),
);

const UpsertBody = z.object({
  apiKey: z.string().trim().min(8).max(400).optional(),
  fromEmail: z.string().trim().email().max(320).optional().nullable(),
});

router.put(
  "/admin/email-providers/:provider",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const provider = String(req.params.provider);
    if (!isProvider(provider)) {
      apiError(res, 404, "Unknown provider.", { code: "NOT_FOUND" });
      return;
    }
    const parsed = UpsertBody.safeParse(req.body);
    if (!parsed.success) {
      apiError(res, 400, parsed.error.errors[0]?.message ?? "Invalid request.", {
        code: "VALIDATION_FAILED",
      });
      return;
    }
    const { apiKey, fromEmail } = parsed.data;
    const normalizedFrom =
      fromEmail === undefined ? undefined : fromEmail && fromEmail.length ? fromEmail : null;

    const [existing] = await db
      .select()
      .from(emailProviderKeys)
      .where(eq(emailProviderKeys.provider, provider))
      .limit(1);

    if (!existing && !apiKey) {
      apiError(res, 400, "An API key is required to enable this provider.", {
        code: "API_KEY_REQUIRED",
      });
      return;
    }
    // A verified sender is required for SendGrid to accept the mail — enforce
    // it whenever we're creating the row or clearing the stored address.
    const effectiveFrom =
      normalizedFrom !== undefined ? normalizedFrom : existing?.fromEmail ?? null;
    if (!effectiveFrom) {
      apiError(res, 400, "A verified 'From' email address is required.", {
        code: "FROM_EMAIL_REQUIRED",
      });
      return;
    }

    if (apiKey) {
      const values = {
        keyCiphertext: encryptSecret(apiKey),
        keyLast4: apiKey.slice(-4),
      };
      if (existing) {
        await db
          .update(emailProviderKeys)
          .set({
            ...values,
            ...(normalizedFrom !== undefined ? { fromEmail: normalizedFrom } : {}),
            updatedAt: new Date(),
          })
          .where(eq(emailProviderKeys.provider, provider));
      } else {
        await db.insert(emailProviderKeys).values({
          provider,
          ...values,
          fromEmail: effectiveFrom,
          createdById: req.realUser?.id ?? null,
        });
      }
    } else {
      await db
        .update(emailProviderKeys)
        .set({
          ...(normalizedFrom !== undefined ? { fromEmail: normalizedFrom } : {}),
          updatedAt: new Date(),
        })
        .where(eq(emailProviderKeys.provider, provider));
    }

    const [row] = await db
      .select()
      .from(emailProviderKeys)
      .where(eq(emailProviderKeys.provider, provider))
      .limit(1);
    res.json({
      provider,
      configured: !!row,
      fromEmail: row?.fromEmail ?? null,
      keyLast4: row?.keyLast4 ?? null,
      updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
    });
  }),
);

router.delete(
  "/admin/email-providers/:provider",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const provider = String(req.params.provider);
    if (!isProvider(provider)) {
      apiError(res, 404, "Unknown provider.", { code: "NOT_FOUND" });
      return;
    }
    await db.delete(emailProviderKeys).where(eq(emailProviderKeys.provider, provider));
    res.json({ ok: true });
  }),
);

const TestBody = z.object({
  to: z.string().trim().email().max(320),
});

// Admin-only: send a test email using the currently-effective credentials
// (admin-entered first, then env / connector). Surfaces send failures so the
// admin can verify the configuration end-to-end.
router.post(
  "/admin/email-providers/:provider/test",
  requireAdmin,
  emailTestLimiter,
  asyncHandler(async (req, res) => {
    const provider = String(req.params.provider);
    if (!isProvider(provider)) {
      apiError(res, 404, "Unknown provider.", { code: "NOT_FOUND" });
      return;
    }
    const parsed = TestBody.safeParse(req.body);
    if (!parsed.success) {
      apiError(res, 400, parsed.error.errors[0]?.message ?? "Invalid request.", {
        code: "VALIDATION_FAILED",
      });
      return;
    }
    try {
      await sendEmail({
        to: parsed.data.to,
        subject: "Kinectem test email",
        text: "This is a test email from Kinectem. Your email settings are working.",
        html: "<p>This is a test email from Kinectem. Your email settings are working.</p>",
        kind: "admin_email_test",
      });
      res.json({ ok: true });
    } catch (err) {
      req.log.error({ err }, "Admin email test send failed");
      apiError(res, 502, "Test email failed to send. Check the API key and verified sender.", {
        code: "EMAIL_TEST_FAILED",
      });
    }
  }),
);

export default router;
