import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { app, loginAs, request } from "./helpers";

const DOCS_ROUTES = ["/api/docs", "/api/openapi.yaml", "/api/openapi.json"];

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_DOCS_TOKEN = process.env.DOCS_ACCESS_TOKEN;
const TEST_TOKEN = "test-docs-token-shhh";

function restoreEnv() {
  if (ORIGINAL_NODE_ENV === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  }
  if (ORIGINAL_DOCS_TOKEN === undefined) {
    delete process.env.DOCS_ACCESS_TOKEN;
  } else {
    process.env.DOCS_ACCESS_TOKEN = ORIGINAL_DOCS_TOKEN;
  }
}

describe("docs access control", () => {
  afterEach(() => {
    restoreEnv();
  });

  describe("in production", () => {
    beforeEach(() => {
      process.env.NODE_ENV = "production";
      process.env.DOCS_ACCESS_TOKEN = TEST_TOKEN;
    });

    it("rejects unauthenticated requests with 401 on every docs route", async () => {
      for (const route of DOCS_ROUTES) {
        const res = await request(app).get(route);
        expect(res.status, `${route} should be 401`).toBe(401);
      }
    });

    it("rejects signed-in non-admin users with 403 on every docs route", async () => {
      const { agent } = await loginAs((u) => u.role === "coach");
      for (const route of DOCS_ROUTES) {
        const res = await agent.get(route);
        expect(res.status, `${route} should be 403`).toBe(403);
      }
    });

    it("allows signed-in admin users with 200 on every docs route", async () => {
      const { agent } = await loginAs((u) => u.role === "admin");
      for (const route of DOCS_ROUTES) {
        const res = await agent.get(route);
        expect(res.status, `${route} should be 200`).toBe(200);
      }
    });

    it("allows requests presenting the DOCS_ACCESS_TOKEN via header", async () => {
      for (const route of DOCS_ROUTES) {
        const res = await request(app)
          .get(route)
          .set("x-docs-token", TEST_TOKEN);
        expect(res.status, `${route} should be 200 with header token`).toBe(200);
      }
    });

    it("allows requests presenting the DOCS_ACCESS_TOKEN via query string", async () => {
      for (const route of DOCS_ROUTES) {
        const res = await request(app)
          .get(route)
          .query({ docs_token: TEST_TOKEN });
        expect(res.status, `${route} should be 200 with query token`).toBe(200);
      }
    });

    it("allows a valid token via header even when signed in as a non-admin", async () => {
      const { agent } = await loginAs((u) => u.role === "coach");
      for (const route of DOCS_ROUTES) {
        const res = await agent.get(route).set("x-docs-token", TEST_TOKEN);
        expect(
          res.status,
          `${route} should be 200 with header token + non-admin session`,
        ).toBe(200);
      }
    });

    it("allows a valid token via query even when signed in as a non-admin", async () => {
      const { agent } = await loginAs((u) => u.role === "coach");
      for (const route of DOCS_ROUTES) {
        const res = await agent.get(route).query({ docs_token: TEST_TOKEN });
        expect(
          res.status,
          `${route} should be 200 with query token + non-admin session`,
        ).toBe(200);
      }
    });

    it("rejects an incorrect DOCS_ACCESS_TOKEN", async () => {
      for (const route of DOCS_ROUTES) {
        const res = await request(app)
          .get(route)
          .set("x-docs-token", "not-the-token");
        expect(res.status, `${route} should be 401 with bad token`).toBe(401);
      }
    });
  });

  describe("in development", () => {
    beforeEach(() => {
      process.env.NODE_ENV = "development";
      delete process.env.DOCS_ACCESS_TOKEN;
    });

    it("opens every docs route to unauthenticated requests", async () => {
      for (const route of DOCS_ROUTES) {
        const res = await request(app).get(route);
        expect(res.status, `${route} should be 200 in dev`).toBe(200);
      }
    });
  });
});
