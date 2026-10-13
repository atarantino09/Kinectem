import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { recordActivity } from "./middlewares/activity";
import docsRouter from "./routes/docs";
import foundingAdminPageRouter from "./routes/founding-admin-page";
import { stripeWebhookHandler } from "./routes/stripe-webhook";
import { sendgridWebhookHandler } from "./routes/sendgrid-webhook";
import { logger } from "./lib/logger";
import { loadSession } from "./lib/auth";
import { corsOptions, csrfGuard } from "./middlewares/security";

const app: Express = express();
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);
// Security headers (S3). The frame, CSP, and cross-origin-isolation policies
// are intentionally disabled: the app is embedded in the Replit preview iframe
// and the Scalar API docs + founding-admin pages rely on inline scripts/styles.
// The remaining helmet defaults (noSniff, HSTS in prod, referrerPolicy,
// hidePoweredBy, etc.) are safe and stay on.
app.use(
  helmet({
    contentSecurityPolicy: false,
    frameguard: false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false,
  }),
);
app.use(cors(corsOptions));
// Stripe webhook needs the raw request body for signature verification, so it
// MUST be registered before express.json(). Optional: only does work when
// STRIPE_WEBHOOK_SECRET is set (see routes/stripe-webhook.ts).
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhookHandler,
);
// SendGrid Event Webhook (Task #666) also needs the raw body for ECDSA
// signature verification, so it MUST be registered before express.json().
// Optional: only does work when SENDGRID_WEBHOOK_VERIFICATION_KEY is set
// (see routes/sendgrid-webhook.ts).
app.post(
  "/api/sendgrid/webhook",
  express.raw({ type: "application/json" }),
  sendgridWebhookHandler,
);
// Task #691 — team banner, org logo, and user/avatar PATCH routes accept the
// image inline as a base64 `data:` URL in the JSON body, which routinely
// exceeds the tight 1 MB global limit below. Give just those routes a
// higher-limit JSON parser sized to the client's DATA_URL_MAX_LENGTH contract
// (~20 MB encoded, see kinectem/src/lib/shrinkImage.ts) plus JSON overhead.
// Registered BEFORE the global express.json() so this parser runs first; the
// global parser then no-ops for these requests (body-parser skips once
// req._body is set). Every other route keeps the tight 1 MB limit (S7).
const imageUploadJson = express.json({ limit: "21mb" });
for (const imagePath of [
  "/api/v1/teams/:teamId",
  "/api/v1/organizations/:orgId",
  "/api/v1/users/:userId",
  "/api/v1/admin/users/:userId",
  "/api/v1/competitions/:competitionId",
]) {
  app.patch(imagePath, imageUploadJson);
}
// Competition claim-links admin routes also accept an inline base64 logo
// (create-with-logo + set-logo), so they need the same higher-limit parser.
app.post("/api/v1/admin/competition-claim-links", imageUploadJson);
// Task #829 — one-page org quick setup accepts an inline base64 org logo.
app.post("/api/v1/admin/org-quick-setup", imageUploadJson);
app.post("/api/v1/admin/org-claim-links", imageUploadJson);
app.post("/api/v1/admin/partner-pages/:pageId/organizations", imageUploadJson);
app.patch("/api/v1/admin/partner-pages/:pageId", imageUploadJson);
app.patch("/api/v1/admin/competition-claim-links/:id/logo", imageUploadJson);
// Task #692 — game recaps attach photos inline as base64 `data:` URLs in the
// `POST /posts` and `PATCH /posts/:postId` JSON body (`photoUrls` +
// `coverImageUrl`), and a recap can carry SEVERAL photos, so this parser is
// sized above the single-image one to fit a multi-photo recap. It stays in
// lockstep with `MAX_POST_IMAGES_TOTAL_LENGTH` in spec-helpers.ts (24 MB
// combined) plus JSON overhead; over-cap payloads reach the route and get a
// friendly 413 (see checkPostImagePayload). Registered BEFORE the global
// express.json() so this parser wins for these routes; every other route keeps
// the tight 1 MB limit (S7).
const postImageUploadJson = express.json({ limit: "25mb" });
// A 5 MiB clipping uses at most ~7 MiB base64. Only image-bearing history
// endpoints receive this parser; the global request limit remains unchanged.
const historicalImageJson = express.json({ limit: "8mb" });
app.post("/api/v1/ai/transcribe", historicalImageJson);
app.post("/api/v1/historical-recaps/clipping", historicalImageJson);
app.post("/api/v1/posts", postImageUploadJson);
app.patch("/api/v1/posts/:postId", postImageUploadJson);
app.post("/api/v1/teams/:teamId/practice-plans", postImageUploadJson);
app.patch("/api/v1/teams/:teamId/practice-plans/:planId", postImageUploadJson);
// Task #938 — league competition schedules can contain up to 25,000 games.
// Their CSV JSON body is capped at 10 MB in tournaments.ts; allow modest JSON
// encoding overhead on ONLY the two schedule-import aliases. Keep this before
// the global 1 MB parser so every unrelated API route retains the tight cap.
const competitionScheduleJson = express.json({ limit: "12mb" });
app.post("/api/v1/tournaments/:id/import", competitionScheduleJson);
app.post("/api/v1/competitions/:id/import", competitionScheduleJson);
// S7 — global JSON limit kept tight. Binary asset uploads use a dedicated
// express.raw() parser (10 MB) on PUT /assets/:assetId/data, so this does not
// affect uploads; all JSON request bodies are text-only.
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(cookieParser());
app.use(loadSession);
// CSRF defense for cookie-authenticated mutations (runs after loadSession so
// req.sessionRow is populated). No-op for bearer/API-key and non-browser calls.
app.use(csrfGuard);
app.use(recordActivity);

app.get("/api/healthz", (_req, res) => {
  res.json({ ok: true });
});
app.use("/api", docsRouter);
app.use("/api", foundingAdminPageRouter);
// S11 (DEFERRED) — no global express-openapi-validator is mounted here. The
// project's standard is per-route Zod validation generated from the OpenAPI
// spec, and several routes (founding-signups, ai, founding-admin) deliberately
// have no openapi.yaml entry, so a spec-driven global validator would reject
// them. openapi.yaml is a locked file (cannot add the missing paths), so the
// shared-Zod alternative is the path forward — tracked as future hardening
// rather than mounting a validator that would 404 valid traffic today.
app.use("/api/v1", router);

export default app;
