import { Router, type IRouter } from "express";
import { db, aiProviderKeys } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { rateLimit, ipKey } from "../middlewares/rate-limit";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { apiError } from "../lib/spec-helpers";
import { canAuthorRecapAnywhere } from "../lib/permissions";
import { encryptSecret } from "../lib/secret-crypto";
import {
  generatePostText,
  generateContextSuggestion,
  AiNotConfiguredError,
  DEFAULT_ANTHROPIC_MODEL,
} from "../lib/ai";

const router: IRouter = Router();

const SUPPORTED_PROVIDERS = ["anthropic"] as const;
type Provider = (typeof SUPPORTED_PROVIDERS)[number];
function isProvider(p: string): p is Provider {
  return (SUPPORTED_PROVIDERS as readonly string[]).includes(p);
}

const ONE_MINUTE = 60 * 1000;

// Per-user throttle so the AI Assist button can't be hammered into a large
// provider bill. Falls back to per-IP when (somehow) unauthenticated.
const aiAssistLimiter = rateLimit({
  name: "ai-assist",
  windowMs: ONE_MINUTE,
  max: 20,
  keys: (req) => [req.sessionUser?.id ?? ipKey(req)],
  message:
    "You're using AI Assist too quickly. Please wait a moment and try again.",
});

const AssistBody = z
  .object({
    mode: z.enum(["draft", "polish"]),
    postType: z.enum(["short", "long"]),
    notes: z.string().trim().max(4000).optional(),
    body: z.string().trim().max(20000).optional(),
    title: z.string().trim().max(200).optional(),
    teamName: z.string().trim().max(200).optional(),
    gameDate: z.string().trim().max(40).optional(),
  })
  .refine((v) => (v.mode === "draft" ? !!v.notes : !!v.body), {
    message: "Provide notes to draft from, or existing text to polish.",
  });

// Coach / author-facing: generate or polish post copy.
router.post(
  "/ai/assist",
  requireAuth,
  aiAssistLimiter,
  asyncHandler(async (req, res) => {
    // Restrict AI generation to users who can author recaps anywhere
    // (org admins / team coaches / explicit authors). Mirrors the same
    // capability that gates the "Game Recap" composer so non-eligible
    // users — including minors — can't push content to a third-party
    // AI provider. UI hiding is best-effort; this is the real boundary.
    const me = req.sessionUser;
    if (!me) {
      apiError(res, 401, "Not authenticated", { code: "UNAUTHENTICATED" });
      return;
    }
    if (!(await canAuthorRecapAnywhere(me.id))) {
      apiError(res, 403, "You don't have permission to use AI Assist.", {
        code: "AI_FORBIDDEN",
      });
      return;
    }
    const parsed = AssistBody.safeParse(req.body);
    if (!parsed.success) {
      apiError(res, 400, parsed.error.errors[0]?.message ?? "Invalid request.", {
        code: "VALIDATION_FAILED",
      });
      return;
    }
    try {
      const text = await generatePostText(parsed.data);
      if (!text) {
        apiError(res, 502, "The AI returned an empty response. Please try again.", {
          code: "AI_EMPTY",
        });
        return;
      }
      res.json({ text });
    } catch (err) {
      if (err instanceof AiNotConfiguredError) {
        apiError(res, 503, err.message, { code: "AI_NOT_CONFIGURED" });
        return;
      }
      req.log.error({ err }, "AI assist request failed");
      apiError(
        res,
        502,
        "AI request failed. An admin may need to check the API key in admin settings.",
        { code: "AI_REQUEST_FAILED" },
      );
    }
  }),
);

// Admin-only: provider key management. The raw key is never returned.
router.get(
  "/admin/ai-providers",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const rows = await db.select().from(aiProviderKeys);
    const byProvider = new Map(rows.map((r) => [r.provider, r]));
    const data = SUPPORTED_PROVIDERS.map((provider) => {
      const r = byProvider.get(provider);
      return {
        provider,
        configured: !!r,
        model: r?.model ?? null,
        systemContext: r?.systemContext ?? null,
        keyLast4: r?.keyLast4 ?? null,
        updatedAt: r?.updatedAt ? r.updatedAt.toISOString() : null,
      };
    });
    res.json({ data, defaultModel: DEFAULT_ANTHROPIC_MODEL });
  }),
);

const UpsertBody = z.object({
  apiKey: z.string().trim().min(8).max(400).optional(),
  model: z.string().trim().max(100).optional().nullable(),
  systemContext: z.string().trim().max(4000).optional().nullable(),
});

router.put(
  "/admin/ai-providers/:provider",
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
    const { apiKey, model, systemContext } = parsed.data;
    const normalizedModel =
      model === undefined ? undefined : model && model.length ? model : null;
    const normalizedContext =
      systemContext === undefined
        ? undefined
        : systemContext && systemContext.length
          ? systemContext
          : null;

    const [existing] = await db
      .select()
      .from(aiProviderKeys)
      .where(eq(aiProviderKeys.provider, provider))
      .limit(1);

    if (!existing && !apiKey) {
      apiError(res, 400, "An API key is required to enable this provider.", {
        code: "API_KEY_REQUIRED",
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
          .update(aiProviderKeys)
          .set({
            ...values,
            ...(normalizedModel !== undefined ? { model: normalizedModel } : {}),
            ...(normalizedContext !== undefined
              ? { systemContext: normalizedContext }
              : {}),
            updatedAt: new Date(),
          })
          .where(eq(aiProviderKeys.provider, provider));
      } else {
        await db.insert(aiProviderKeys).values({
          provider,
          ...values,
          model: normalizedModel ?? null,
          systemContext: normalizedContext ?? null,
          createdById: req.realUser?.id ?? null,
        });
      }
    } else {
      await db
        .update(aiProviderKeys)
        .set({
          ...(normalizedModel !== undefined ? { model: normalizedModel } : {}),
          ...(normalizedContext !== undefined
            ? { systemContext: normalizedContext }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(aiProviderKeys.provider, provider));
    }

    const [row] = await db
      .select()
      .from(aiProviderKeys)
      .where(eq(aiProviderKeys.provider, provider))
      .limit(1);
    res.json({
      provider,
      configured: !!row,
      model: row?.model ?? null,
      systemContext: row?.systemContext ?? null,
      keyLast4: row?.keyLast4 ?? null,
      updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
    });
  }),
);

const ContextAssistBody = z.object({
  instruction: z.string().trim().max(2000).optional(),
});

// Admin-only meta-assist: let the AI help write the "context & personality"
// instruction itself. Requires the provider key to already be configured.
router.post(
  "/admin/ai-providers/:provider/assist-context",
  requireAdmin,
  aiAssistLimiter,
  asyncHandler(async (req, res) => {
    const provider = String(req.params.provider);
    if (!isProvider(provider)) {
      apiError(res, 404, "Unknown provider.", { code: "NOT_FOUND" });
      return;
    }
    const parsed = ContextAssistBody.safeParse(req.body);
    if (!parsed.success) {
      apiError(res, 400, parsed.error.errors[0]?.message ?? "Invalid request.", {
        code: "VALIDATION_FAILED",
      });
      return;
    }
    try {
      const text = await generateContextSuggestion(parsed.data.instruction);
      if (!text) {
        apiError(res, 502, "The AI returned an empty response. Please try again.", {
          code: "AI_EMPTY",
        });
        return;
      }
      res.json({ text });
    } catch (err) {
      if (err instanceof AiNotConfiguredError) {
        apiError(res, 503, err.message, { code: "AI_NOT_CONFIGURED" });
        return;
      }
      req.log.error({ err }, "AI context assist request failed");
      apiError(
        res,
        502,
        "AI request failed. Check the API key and model in admin settings.",
        { code: "AI_REQUEST_FAILED" },
      );
    }
  }),
);

router.delete(
  "/admin/ai-providers/:provider",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const provider = String(req.params.provider);
    if (!isProvider(provider)) {
      apiError(res, 404, "Unknown provider.", { code: "NOT_FOUND" });
      return;
    }
    await db.delete(aiProviderKeys).where(eq(aiProviderKeys.provider, provider));
    res.json({ ok: true });
  }),
);

export default router;
