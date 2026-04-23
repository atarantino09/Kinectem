import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { logger } from "../lib/logger";

const DOCS_TOKEN_HEADER = "x-docs-token";
const DOCS_TOKEN_QUERY = "docs_token";

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function presentedDocsToken(req: Request): string | undefined {
  const header = req.header(DOCS_TOKEN_HEADER);
  if (typeof header === "string" && header.length > 0) return header;
  const query = req.query[DOCS_TOKEN_QUERY];
  if (typeof query === "string" && query.length > 0) return query;
  return undefined;
}

function requireDocsAccess(req: Request, res: Response, next: NextFunction) {
  if (!isProduction()) {
    next();
    return;
  }
  const expected = process.env.DOCS_ACCESS_TOKEN;
  const presented = presentedDocsToken(req);
  if (expected && presented && expected === presented) {
    next();
    return;
  }
  if (req.sessionUser) {
    if (req.sessionUser.role === "admin") {
      next();
      return;
    }
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  res.status(401).json({ error: "Authentication required" });
}

const here = path.dirname(fileURLToPath(import.meta.url));

const candidatePaths = [
  path.resolve(here, "../.openapi-prefixed.yaml"),
  path.resolve(here, "./.openapi-prefixed.yaml"),
  path.resolve(here, "../../.openapi-prefixed.yaml"),
  path.resolve(process.cwd(), "artifacts/api-server/.openapi-prefixed.yaml"),
  path.resolve(process.cwd(), ".openapi-prefixed.yaml"),
];

const scalarCandidatePaths = [
  // Production: copied next to the built bundle by build.mjs
  path.resolve(here, "./public/scalar/standalone.js"),
  path.resolve(here, "../public/scalar/standalone.js"),
  // Development: load directly from node_modules
  path.resolve(
    here,
    "../node_modules/@scalar/api-reference/dist/browser/standalone.js",
  ),
  path.resolve(
    here,
    "../../node_modules/@scalar/api-reference/dist/browser/standalone.js",
  ),
  path.resolve(
    process.cwd(),
    "artifacts/api-server/node_modules/@scalar/api-reference/dist/browser/standalone.js",
  ),
  path.resolve(
    process.cwd(),
    "node_modules/@scalar/api-reference/dist/browser/standalone.js",
  ),
];

function loadScalarBundle(): Buffer | null {
  for (const p of scalarCandidatePaths) {
    if (existsSync(p)) {
      logger.info({ path: p }, "Loaded Scalar standalone bundle for docs");
      return readFileSync(p);
    }
  }
  logger.warn(
    { tried: scalarCandidatePaths },
    "Could not find @scalar/api-reference standalone bundle — /api/docs will be unavailable.",
  );
  return null;
}

const scalarBundle = loadScalarBundle();
const scalarBundleHash = scalarBundle
  ? createHash("sha256").update(scalarBundle).digest("hex").slice(0, 16)
  : "";
const scalarBundleUrl = scalarBundle
  ? `/api/docs/scalar.${scalarBundleHash}.js`
  : "/api/docs/scalar.js";

function loadSpec(): { yaml: string; json: unknown } | null {
  for (const p of candidatePaths) {
    if (existsSync(p)) {
      const yaml = readFileSync(p, "utf8");
      try {
        const json = YAML.parse(yaml);
        logger.info({ path: p }, "Loaded OpenAPI spec for docs");
        return { yaml, json };
      } catch (err) {
        logger.error({ err, path: p }, "Failed to parse OpenAPI spec");
        return null;
      }
    }
  }
  logger.warn(
    { tried: candidatePaths },
    "Could not find .openapi-prefixed.yaml — run `pnpm --filter @workspace/api-server run prefix-spec` to generate it.",
  );
  return null;
}

const spec = loadSpec();

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderDocsHtml(specUrl: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Kinectem API — Interactive Docs</title>
    <link rel="icon" href="data:," />
    <style>
      body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    </style>
  </head>
  <body>
    <script
      id="api-reference"
      data-url="${escapeHtmlAttr(specUrl)}"
      data-configuration='{"theme":"default","layout":"modern","hideDownloadButton":false,"defaultHttpClient":{"targetKey":"shell","clientKey":"curl"}}'
    ></script>
    <script src="${scalarBundleUrl}"></script>
  </body>
</html>
`;
}

const router: IRouter = Router();

router.get("/docs", requireDocsAccess, (req, res) => {
  const token = presentedDocsToken(req);
  const specUrl =
    token && isProduction() && !req.sessionUser
      ? `/api/openapi.json?${DOCS_TOKEN_QUERY}=${encodeURIComponent(token)}`
      : "/api/openapi.json";
  res.type("html").send(renderDocsHtml(specUrl));
});

// Match both the unhashed fallback path and the content-hashed path
// (e.g. /docs/scalar.<hash>.js). Only the hashed path uses an immutable
// cache header so an upgrade naturally invalidates client caches.
router.get(/^\/docs\/scalar(?:\.[a-f0-9]+)?\.js$/, requireDocsAccess, (req, res) => {
  if (!scalarBundle) {
    res.status(503).type("text/plain").send("Scalar bundle not available");
    return;
  }
  res.type("application/javascript");
  if (req.path === scalarBundleUrl.replace(/^\/api/, "")) {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  } else {
    res.setHeader("Cache-Control", "public, max-age=300");
  }
  res.send(scalarBundle);
});

router.get("/openapi.yaml", requireDocsAccess, (_req, res) => {
  if (!spec) {
    res.status(503).json({ error: "OpenAPI spec not available" });
    return;
  }
  res.type("application/yaml").send(spec.yaml);
});

router.get("/openapi.json", requireDocsAccess, (_req, res) => {
  if (!spec) {
    res.status(503).json({ error: "OpenAPI spec not available" });
    return;
  }
  res.json(spec.json);
});

export default router;
