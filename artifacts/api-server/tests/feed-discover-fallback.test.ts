import { describe, expect, it } from "vitest";
import express from "express";
import supertest from "supertest";
import { asyncHandler } from "../src/lib/async-handler";
import { loginAs, request, app } from "./helpers";

// ---------------------------------------------------------------------------
// asyncHandler robustness
// ---------------------------------------------------------------------------
//
// A previous regression had `asyncHandler` calling `.catch(next)` on the
// raw return value of the wrapped function. When the wrapped function was a
// non-async arrow (e.g. `(req, res) => { res.json(...) }` returning
// `undefined`), this threw `TypeError: Cannot read properties of undefined
// (reading 'catch')` after every request. The response was sent fine, but
// the log spew masked real errors. These tests pin the contract that
// asyncHandler accepts both async and sync handlers safely.

describe("asyncHandler", () => {
  it("forwards an async handler's resolved response", async () => {
    const testApp = express();
    testApp.get(
      "/ok-async",
      asyncHandler(async (_req, res) => {
        res.json({ ok: true });
      }),
    );
    const res = await supertest(testApp).get("/ok-async");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("does not throw when the handler is sync and returns undefined", async () => {
    const testApp = express();
    testApp.get(
      "/ok-sync",
      asyncHandler((_req, res) => {
        res.json({ ok: true });
      }),
    );
    // Surface any unhandled error from express's default error handler so
    // a regression here would fail this test, not just print to stderr.
    const errors: unknown[] = [];
    testApp.use(
      (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        errors.push(err);
        if (!res.headersSent) res.status(500).json({ error: String(err) });
      },
    );
    const res = await supertest(testApp).get("/ok-sync");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(errors).toEqual([]);
  });

  it("forwards a thrown sync error to next()", async () => {
    const testApp = express();
    testApp.get(
      "/sync-throw",
      asyncHandler((_req, _res) => {
        throw new Error("boom");
      }),
    );
    const seen: Error[] = [];
    testApp.use(
      (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        seen.push(err);
        res.status(500).json({ error: err.message });
      },
    );
    const res = await supertest(testApp).get("/sync-throw");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "boom" });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.message).toBe("boom");
  });

  it("forwards a rejected async error to next()", async () => {
    const testApp = express();
    testApp.get(
      "/async-throw",
      asyncHandler(async (_req, _res) => {
        throw new Error("kaboom");
      }),
    );
    const seen: Error[] = [];
    testApp.use(
      (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        seen.push(err);
        res.status(500).json({ error: err.message });
      },
    );
    const res = await supertest(testApp).get("/async-throw");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "kaboom" });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.message).toBe("kaboom");
  });
});

// ---------------------------------------------------------------------------
// /feed discover fallback
// ---------------------------------------------------------------------------
//
// When a viewer follows nobody and has no own posts/shares of their own to
// surface, the home feed used to return an empty list — making the page
// look like "everything is gone" for fresh accounts and admins. The
// discover fallback fills the page with recent published recap articles
// and (non-hidden) highlights from across all orgs so the feed always has
// something to render. Existing users with follows or own content keep
// their personalized merge unchanged.

describe("GET /feed — discover fallback", () => {
  it("returns recent posts for an admin who follows nothing", async () => {
    // The seeded admin Sam Patel has no follows, no authored articles, and
    // no shares — exactly the empty-state case the fallback exists for.
    const { agent } = await loginAs("sam@kinectem.demo");
    const res = await agent.get("/api/v1/feed");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    // Discover items are not re-shares — frontend should render them as
    // ordinary posts, not "Shared by ..." headers.
    for (const item of res.body.data) {
      expect(item.sharedBy ?? null).toBeNull();
    }
    // Newest-first sort.
    const createdAts = res.body.data.map((p: { createdAt: string }) => p.createdAt);
    const sorted = [...createdAts].sort().reverse();
    expect(createdAts).toEqual(sorted);
  });

  it("does not include draft articles in the discover fallback", async () => {
    const { agent } = await loginAs("sam@kinectem.demo");
    const res = await agent.get("/api/v1/feed");
    expect(res.status).toBe(200);
    const titles = res.body.data.map((p: { title: string }) => p.title);
    // Seed contains "Draft: Recap vs. Cranford" (status=draft) — it must
    // not appear in the discover feed (only published articles).
    expect(titles).not.toContain("Draft: Recap vs. Cranford");
  });

  it("returns 401 for an unauthenticated request", async () => {
    const res = await request(app).get("/api/v1/feed");
    expect(res.status).toBe(401);
  });
});
