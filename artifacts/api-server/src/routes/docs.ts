import { Router, type IRouter } from "express";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { logger } from "../lib/logger";

const here = path.dirname(fileURLToPath(import.meta.url));

const candidatePaths = [
  path.resolve(here, "../.openapi-prefixed.yaml"),
  path.resolve(here, "./.openapi-prefixed.yaml"),
  path.resolve(here, "../../.openapi-prefixed.yaml"),
  path.resolve(process.cwd(), "artifacts/api-server/.openapi-prefixed.yaml"),
  path.resolve(process.cwd(), ".openapi-prefixed.yaml"),
];

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

const DOCS_HTML = `<!doctype html>
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
      data-url="/api/openapi.json"
      data-configuration='{"theme":"default","layout":"modern","hideDownloadButton":false,"defaultHttpClient":{"targetKey":"shell","clientKey":"curl"}}'
    ></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>
`;

const router: IRouter = Router();

router.get("/docs", (_req, res) => {
  res.type("html").send(DOCS_HTML);
});

router.get("/openapi.yaml", (_req, res) => {
  if (!spec) {
    res.status(503).json({ error: "OpenAPI spec not available" });
    return;
  }
  res.type("application/yaml").send(spec.yaml);
});

router.get("/openapi.json", (_req, res) => {
  if (!spec) {
    res.status(503).json({ error: "OpenAPI spec not available" });
    return;
  }
  res.json(spec.json);
});

export default router;
