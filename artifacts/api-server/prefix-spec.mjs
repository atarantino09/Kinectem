import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const inputPath = resolve(here, "../../lib/api-spec/openapi.yaml");
const outputPath = resolve(here, ".openapi-prefixed.yaml");

const PREFIX = "/api/v1";
const text = readFileSync(inputPath, "utf8");
const lines = text.split("\n");

let inPaths = false;
const out = [];
for (const line of lines) {
  if (/^paths:\s*$/.test(line)) {
    inPaths = true;
    out.push(line);
    continue;
  }
  if (inPaths) {
    if (/^\S/.test(line) && line.trim() !== "") {
      inPaths = false;
    } else {
      const m = line.match(/^( {2})(\/[^\s:]+)(:.*)$/);
      if (m) {
        out.push(`${m[1]}${PREFIX}${m[2]}${m[3]}`);
        continue;
      }
    }
  }
  out.push(line);
}

writeFileSync(outputPath, out.join("\n"));
console.log(`Wrote prefixed spec to ${outputPath}`);
