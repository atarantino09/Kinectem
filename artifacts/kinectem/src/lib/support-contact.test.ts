import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "./support-contact";

const workspace = path.resolve(import.meta.dirname, "../../../..");

// Audit only hand-authored runtime surfaces, not fixtures, generated outputs,
// personal addresses, provider credentials, or internal operational recipients.
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".") || ["node_modules", "dist", "build", "assets"].includes(entry.name)) return [];
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    return /\.(tsx?|html|js)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name) ? [file] : [];
  });
}

describe("platform help contact regression", () => {
  it("keeps frontend and server general help constants aligned", () => {
    expect(SUPPORT_EMAIL).toBe("hello@kinectem.com");
    expect(SUPPORT_MAILTO).toBe("mailto:hello@kinectem.com");
    const server = readFileSync(path.join(workspace, "artifacts/api-server/src/lib/support-contact.ts"), "utf8");
    expect(server).toContain(`"${SUPPORT_EMAIL}"`);
  });

  it("rejects alternate help aliases across registered runtime surfaces, allowing competitions", () => {
    const violations: string[] = [];
    const allowed = new Set(["hello@kinectem.com", "competitions@kinectem.com"]);
    for (const artifact of readdirSync(path.join(workspace, "artifacts"))) {
      // src and hand-authored static HTML cover all registered web/video/API surfaces.
      const artifactDir = path.join(workspace, "artifacts", artifact);
      for (const file of sourceFiles(artifactDir)) {
        const source = readFileSync(file, "utf8");
        const aliases = source.match(/\b(?:privacy|support|help|contact|hello|competitions|family|coppa)[\w.+-]*@kinectem\.com\b/gi) ?? [];
        // Also catch new arbitrary mailbox names in literal help mailto links,
        // including encoded recipients and CC/BCC compose parameters.
        const mailtos = source.match(/mailto:[^"'`\s<>]+/gi) ?? [];
        for (const value of [...aliases, ...mailtos.map((link) => decodeURIComponent(link))]) {
          for (const address of value.match(/[\w.+-]+@kinectem\.com/gi) ?? []) {
            if (!allowed.has(address.toLowerCase())) violations.push(`${path.relative(workspace, file)}: ${address}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
