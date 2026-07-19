import { describe, expect, it } from "vitest";
import { db, articles, teams, rosterEntries } from "@workspace/db";
import { app, loginAs, request } from "./helpers";

// ---------------------------------------------------------------------------
// Task #782 — cursor pagination regression tests.
//
// The home feed (`GET /feed`) and team page (`GET /teams/:teamId/posts`)
// used to hard-cap at the newest N posts and ignore the spec's existing
// `cursor`/`limit` params, making older recaps look "deleted". The feed's
// articles query also innerJoined organizations, silently dropping every
// recap authored on an org-less (solo/independent) team. These tests pin:
//   1. limit is honored and hasMore/nextCursor page through ALL posts
//      with no duplicates and no gaps (> 1 page).
//   2. org-less team recaps appear on both endpoints.
// ---------------------------------------------------------------------------

async function getOrgAndTeam(name = "Varsity Football") {
  const orgs = await request(app).get("/api/v1/organizations");
  const org = orgs.body.data[0];
  const teamsRes = await request(app).get(
    `/api/v1/organizations/${org.id}/teams`,
  );
  const team = teamsRes.body.data.find(
    (t: { name: string }) => t.name === name,
  );
  if (!team) throw new Error(`team ${name} not in seed`);
  return { org, team };
}

/** Insert `count` published recaps with strictly descending createdAt. */
async function seedArticles(
  teamId: string,
  authorId: string,
  count: number,
  prefix: string,
) {
  const base = Date.now() - 60 * 60 * 1000;
  const rows = Array.from({ length: count }, (_, i) => ({
    teamId,
    authorId,
    title: `${prefix} ${i + 1}`,
    body: "Body",
    status: "published" as const,
    publishedAt: new Date(base + i * 60_000),
    createdAt: new Date(base + i * 60_000),
    updatedAt: new Date(base + i * 60_000),
  }));
  await db.insert(articles).values(rows);
}

type Page = {
  data: { id: string; title: string }[];
  pagination: { hasMore: boolean; nextCursor: string | null };
};

/** Walk an endpoint page by page; assert invariants; return all items. */
async function walkPages(
  get: (qs: string) => Promise<{ status: number; body: Page }>,
  limit: number,
) {
  const seen = new Map<string, string>();
  let cursor: string | null = null;
  let pages = 0;
  for (;;) {
    const qs = `limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const res = await get(qs);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(limit);
    for (const p of res.body.data) {
      expect(seen.has(p.id)).toBe(false); // no duplicates across pages
      seen.set(p.id, p.title);
    }
    pages += 1;
    if (res.body.pagination.hasMore) {
      expect(res.body.pagination.nextCursor).toBeTruthy();
      cursor = res.body.pagination.nextCursor;
    } else {
      break;
    }
    if (pages > 20) throw new Error("pagination did not terminate");
  }
  return { seen, pages };
}

describe("post pagination (Task #782)", () => {
  it("team page pages through more than one page of recaps via cursor", async () => {
    const { agent, user } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );
    void agent;
    const { team } = await getOrgAndTeam();
    await seedArticles(team.id, user.id, 25, "Team cursor recap");

    const { seen, pages } = await walkPages(
      (qs) => request(app).get(`/api/v1/teams/${team.id}/posts?${qs}`),
      10,
    );
    expect(pages).toBeGreaterThan(1);
    const titles = [...seen.values()];
    for (let i = 1; i <= 25; i++) {
      expect(titles).toContain(`Team cursor recap ${i}`);
    }
  });

  it("team page honors the limit param", async () => {
    const { user } = await loginAs((u) => u.email === "coach@kinectem.demo");
    const { team } = await getOrgAndTeam();
    await seedArticles(team.id, user.id, 8, "Limit recap");
    const res = await request(app).get(
      `/api/v1/teams/${team.id}/posts?limit=3`,
    );
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(3);
    expect(res.body.pagination.hasMore).toBe(true);
    expect(res.body.pagination.nextCursor).toBeTruthy();
  });

  it("serves org-less (solo) team recaps on team page and paginated feed", async () => {
    const { agent, user } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );
    // Org-less solo team, coach-owned.
    const [solo] = await db
      .insert(teams)
      .values({
        organizationId: null,
        createdById: user.id,
        name: `Solo Cursor FC ${Date.now()}`,
      })
      .returning();
    await db.insert(rosterEntries).values({
      teamId: solo!.id,
      userId: user.id,
      role: "coach",
      position: "coach",
      status: "accepted",
    });
    await seedArticles(solo!.id, user.id, 3, "Solo recap");

    // Team page shows the org-less recaps (leftJoin, not innerJoin).
    const teamRes = await request(app).get(`/api/v1/teams/${solo!.id}/posts`);
    expect(teamRes.status).toBe(200);
    const teamTitles = teamRes.body.data.map(
      (p: { title: string }) => p.title,
    );
    expect(teamTitles).toContain("Solo recap 1");
    expect(teamTitles).toContain("Solo recap 3");

    // A follower's feed pages through and includes the org-less recaps.
    const email = `cursorfan+${Date.now()}@kinectem.test`;
    const signup = await request(app).post("/api/v1/auth/signup").send({
      email,
      password: "test-password-123",
      firstName: "Cursor",
      lastName: "Fan",
      role: "coach",
    });
    expect(signup.status).toBe(201);
    const fan = request.agent(app);
    const login = await fan
      .post("/api/v1/auth/login")
      .send({ email, password: "test-password-123" });
    expect(login.status).toBe(200);

    const { team: orgTeam } = await getOrgAndTeam();
    await seedArticles(orgTeam.id, user.id, 22, "Feed cursor recap");
    for (const t of [solo!.id, orgTeam.id]) {
      const f = await fan.post(`/api/v1/teams/${t}/follow`);
      expect([200, 201]).toContain(f.status);
    }

    const { seen, pages } = await walkPages(
      (qs) => fan.get(`/api/v1/feed?${qs}`),
      10,
    );
    expect(pages).toBeGreaterThan(1);
    const titles = [...seen.values()];
    expect(titles).toContain("Solo recap 2"); // org-less recap in feed
    for (let i = 1; i <= 22; i++) {
      expect(titles).toContain(`Feed cursor recap ${i}`);
    }
  });

  // Task #785 — the org page and profile page endpoints used to hard-cap
  // at 20 (limit(20) per source / slice(0,20)); these pin cursor paging.
  it("org page pages through more than one page of posts via cursor", async () => {
    const { user } = await loginAs((u) => u.email === "coach@kinectem.demo");
    const { org, team } = await getOrgAndTeam();
    await seedArticles(team.id, user.id, 25, "Org cursor recap");

    const { seen, pages } = await walkPages(
      (qs) => request(app).get(`/api/v1/organizations/${org.id}/posts?${qs}`),
      10,
    );
    expect(pages).toBeGreaterThan(1);
    const titles = [...seen.values()];
    for (let i = 1; i <= 25; i++) {
      expect(titles).toContain(`Org cursor recap ${i}`);
    }
  });

  it("org page honors the limit param", async () => {
    const { user } = await loginAs((u) => u.email === "coach@kinectem.demo");
    const { org, team } = await getOrgAndTeam();
    await seedArticles(team.id, user.id, 8, "Org limit recap");
    const res = await request(app).get(
      `/api/v1/organizations/${org.id}/posts?limit=3`,
    );
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(3);
    expect(res.body.pagination.hasMore).toBe(true);
    expect(res.body.pagination.nextCursor).toBeTruthy();
  });

  it("profile page pages through more than one page of posts via cursor", async () => {
    const { user } = await loginAs((u) => u.email === "coach@kinectem.demo");
    const { team } = await getOrgAndTeam();
    await seedArticles(team.id, user.id, 25, "Profile cursor recap");

    const { seen, pages } = await walkPages(
      (qs) => request(app).get(`/api/v1/users/${user.id}/posts?${qs}`),
      10,
    );
    expect(pages).toBeGreaterThan(1);
    const titles = [...seen.values()];
    for (let i = 1; i <= 25; i++) {
      expect(titles).toContain(`Profile cursor recap ${i}`);
    }
  });

  it("profile page honors the limit param", async () => {
    const { user } = await loginAs((u) => u.email === "coach@kinectem.demo");
    const { team } = await getOrgAndTeam();
    await seedArticles(team.id, user.id, 8, "Profile limit recap");
    const res = await request(app).get(
      `/api/v1/users/${user.id}/posts?limit=3`,
    );
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(3);
    expect(res.body.pagination.hasMore).toBe(true);
    expect(res.body.pagination.nextCursor).toBeTruthy();
  });
});
