import { defineConfig } from "vitest/config";

const sourceUrl = process.env["DATABASE_URL"];
if (!sourceUrl) {
  throw new Error(
    "DATABASE_URL must be set when running api-server tests (used as the schema source).",
  );
}

const TEST_DB = process.env["API_TEST_DB_NAME"] ?? "kinectem_api_test";
const testUrl = sourceUrl.replace(/\/[^/?]+(\?|$)/, `/${TEST_DB}$1`);

// Make the source URL available to globalSetup (which runs in the main
// process and only sees the parent shell env, not vitest's `test.env`).
process.env["SOURCE_DATABASE_URL"] = sourceUrl;

export default defineConfig({
  test: {
    globalSetup: ["./tests/globalSetup.ts"],
    setupFiles: ["./tests/setupFile.ts"],
    env: {
      DATABASE_URL: testUrl,
      SOURCE_DATABASE_URL: sourceUrl,
      PORT: "0",
      NODE_ENV: "test",
      // Stable secret for HMAC-signed access tokens during tests so the
      // token-auth suite doesn't depend on a real secret being injected.
      SESSION_SECRET:
        process.env.SESSION_SECRET ??
        "test-session-secret-do-not-use-in-prod-task-355",
    },
    include: ["tests/**/*.test.ts"],
    pool: "forks",
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
