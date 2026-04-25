import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const inputPath = resolve(here, "../../../lib/api-spec/openapi.yaml");
const outputPath = resolve(here, "../public/openapi.yaml");

mkdirSync(dirname(outputPath), { recursive: true });
const text = readFileSync(inputPath, "utf8");
writeFileSync(outputPath, text);
console.log(`Copied OpenAPI spec to ${outputPath} (${text.length} bytes)`);
