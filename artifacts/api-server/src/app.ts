import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import docsRouter from "./routes/docs";
import foundingAdminPageRouter from "./routes/founding-admin-page";
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
