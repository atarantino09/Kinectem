import { test, expect, type APIRequestContext, type Page, request as pwRequest } from "@playwright/test";

// All API helpers must receive the page-context's request so that cookies
// set during UI sign-in are reused on the API side.

const SHARER_EMAIL = "daniela@kinectem.demo";
const SHARER_PASSWORD = "demo1234";
const SHARER_DISPLAY_NAME = "Daniela Ortiz";
const RECAP_TITLE = "Westfield Dominates Lincoln High 34-14";
const HIGHLIGHT_TITLE = "40-yard TD Catch vs. Lincoln HS";
const TEAM_NAME = "Varsity Football";
// Morgan follows Daniela in the seed (see lib/seed.ts userFollowers),
// so anything Daniela shares should land in Morgan's home feed.
const FOLLOWER_EMAIL = "morgan@kinectem.demo";
const FOLLOWER_PASSWORD = "demo1234";

type FeedPost = {
  id: string;
  title?: string | null;
  shareCount?: number;
  hasShared?: boolean;
};

type MeResponse = { id: string; firstName: string; lastName: string };

async function loginViaUi(page: Page) {
  await page.goto("/login");
  await page.getByTestId("input-signin-email").fill(SHARER_EMAIL);
  await page.getByTestId("input-signin-password").fill(SHARER_PASSWORD);
  await page.getByTestId("btn-signin").click();
  await page.waitForURL(/\/(?:$|\?)/, { timeout: 15_000 });
}

async function getMe(api: APIRequestContext): Promise<MeResponse> {
  const res = await api.get("/api/v1/users/me");
  expect(res.ok(), `GET /users/me failed: ${res.status()}`).toBeTruthy();
  return (await res.json()) as MeResponse;
}

async function findRecap(api: APIRequestContext): Promise<FeedPost> {
  // Look up the recap author (Coach Mike Davis) and read his published posts.
  // Daniela's own /feed is empty until she follows the team, so we go via the
  // author's profile, which is publicly listable.
  const usersRes = await api.get("/api/v1/users", {
    params: { q: "coach@kinectem.demo" },
  });
  expect(usersRes.ok()).toBeTruthy();
  const usersBody = (await usersRes.json()) as {
    data: Array<{ id: string; email: string | null }>;
  };
  const coach = usersBody.data.find((u) => u.email === "coach@kinectem.demo");
  if (!coach) throw new Error("Coach Mike Davis not found in /users search.");

  const postsRes = await api.get(`/api/v1/users/${coach.id}/posts`);
  expect(postsRes.ok()).toBeTruthy();
  const postsBody = (await postsRes.json()) as { data: FeedPost[] };
  const recap = postsBody.data.find(
    (p) => p.id.startsWith("article-") && p.title === RECAP_TITLE,
  );
  if (!recap) {
    throw new Error(
      `Could not find seeded recap "${RECAP_TITLE}" on coach's profile. Did the database seed?`,
    );
  }
  return recap;
}

async function getPost(api: APIRequestContext, postId: string): Promise<FeedPost> {
  const res = await api.get(`/api/v1/posts/${postId}`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as FeedPost;
}

test.describe("Share button — end-to-end", () => {
  test("share, verify on profile, unshare, verify removed", async ({ page }) => {
    await loginViaUi(page);
    // Reuse the browser context's request so the session cookie is sent.
    const api = page.context().request;

    const me = await getMe(api);
    expect(`${me.firstName} ${me.lastName}`).toBe(SHARER_DISPLAY_NAME);

    let recap = await findRecap(api);
    if (recap.hasShared) {
      // Reset state from a prior failed run.
      const reset = await api.delete(`/api/v1/posts/${recap.id}/share`);
      expect(reset.ok() || reset.status() === 404).toBeTruthy();
      recap = await getPost(api, recap.id);
    }
    const initialShareCount = recap.shareCount ?? 0;
    expect(recap.hasShared).toBeFalsy();

    // 1) Open the recap detail page and click Share.
    await page.goto(`/posts/${recap.id}`);
    await expect(page.getByRole("heading", { name: RECAP_TITLE })).toBeVisible();

    const shareButton = page.getByTestId("button-share");
    await expect(shareButton).toBeVisible();
    await expect(shareButton).toHaveAttribute("aria-pressed", "false");
    await expect(shareButton).toContainText(String(initialShareCount));

    await shareButton.click();

    // 2) Confirm dialog → confirm.
    const confirmBtn = page.getByTestId("button-confirm-share");
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    // 3) Wait for the mutation to land server-side, then reload so the post
    //    detail UI re-fetches and reflects the new state. (The post page uses
    //    its own custom query key, so a reload is the cleanest cross-version
    //    way to assert the UI without coupling the test to internal cache
    //    keys.)
    await expect
      .poll(async () => (await getPost(api, recap.id)).shareCount, {
        timeout: 10_000,
      })
      .toBe(initialShareCount + 1);
    const afterShare = await getPost(api, recap.id);
    expect(afterShare.hasShared).toBe(true);

    await page.reload();
    await expect(shareButton).toHaveAttribute("aria-pressed", "true");
    await expect(shareButton).toHaveAttribute("aria-label", "Unshare recap");
    await expect(shareButton).toContainText(String(initialShareCount + 1));

    // 4) Visit the sharer's profile and assert the "Shared by …" header
    //    appears for this recap.
    await page.goto(`/users/${me.id}`);
    const sharedLabel = page.getByTestId(`label-shared-by-${recap.id}`);
    await expect(sharedLabel).toBeVisible();
    await expect(sharedLabel).toContainText(`Shared by ${SHARER_DISPLAY_NAME}`);
    await expect(
      page.getByRole("heading", { name: RECAP_TITLE }).first(),
    ).toBeVisible();

    // 5) Unshare from the post detail page (the same button we used to share —
    //    when hasShared is true, clicking it calls unshare directly with no
    //    confirm dialog).
    await page.goto(`/posts/${recap.id}`);
    await expect(shareButton).toHaveAttribute("aria-pressed", "true");
    await shareButton.click();

    // 6) Wait for the unshare to land server-side.
    await expect
      .poll(async () => (await getPost(api, recap.id)).shareCount, {
        timeout: 10_000,
      })
      .toBe(initialShareCount);
    const afterUnshare = await getPost(api, recap.id);
    expect(afterUnshare.hasShared).toBe(false);

    // 7) After unshare, the recap (and the "Shared by …" header) is gone from
    //    Daniela's profile — she neither authored nor was tagged in this
    //    recap, so the only reason it appeared was her share.
    await page.goto(`/users/${me.id}`);
    await expect(
      page.getByTestId(`label-shared-by-${recap.id}`),
    ).toHaveCount(0);
  });

  // Task #190 — Fan re-shares both a recap *and* a highlight from the
  // team page (not the post-detail page), and a separate follower
  // account confirms both posts land in their home feed with the
  // "Shared by Daniela Ortiz" attribution. This exercises the new
  // polymorphic share flow end-to-end across team page + follower
  // feed propagation.
  test("fan re-shares recap + highlight from team page → follower sees both in feed", async ({ page }, testInfo) => {
    await loginViaUi(page);
    const api = page.context().request;
    const me = await getMe(api);
    // Resolve baseURL via the project use config so the fresh
    // follower context below routes through the same proxy as the
    // page fixture.
    const baseURL =
      (testInfo.project.use.baseURL as string | undefined) ??
      process.env.E2E_BASE_URL ??
      "http://localhost:80";

    // Find the team and the two posts we'll share.
    const teamsRes = await api.get("/api/v1/teams", {
      params: { q: TEAM_NAME },
    });
    expect(teamsRes.ok()).toBeTruthy();
    const teamsBody = (await teamsRes.json()) as {
      data: Array<{ id: string; name: string }>;
    };
    const team = teamsBody.data.find((t) => t.name === TEAM_NAME);
    if (!team) throw new Error(`Could not find seeded team "${TEAM_NAME}".`);

    const teamPostsRes = await api.get(`/api/v1/teams/${team.id}/posts`);
    expect(teamPostsRes.ok()).toBeTruthy();
    const teamPostsBody = (await teamPostsRes.json()) as { data: FeedPost[] };
    const recap = teamPostsBody.data.find(
      (p) => p.id.startsWith("article-") && p.title === RECAP_TITLE,
    );
    const highlight = teamPostsBody.data.find(
      (p) => p.id.startsWith("highlight-") && p.title === HIGHLIGHT_TITLE,
    );
    if (!recap) throw new Error(`Recap "${RECAP_TITLE}" not on team page.`);
    if (!highlight) {
      throw new Error(`Highlight "${HIGHLIGHT_TITLE}" not on team page.`);
    }

    // Reset state so re-runs are deterministic.
    for (const p of [recap, highlight]) {
      if (p.hasShared) {
        const reset = await api.delete(`/api/v1/posts/${p.id}/share`);
        expect(reset.ok() || reset.status() === 404).toBeTruthy();
      }
    }

    // Navigate to the team page and share both cards via their UI
    // share buttons.
    await page.goto(`/teams/${team.id}`);

    for (const [post, kindLabel] of [
      [recap, "recap"] as const,
      [highlight, "highlight"] as const,
    ]) {
      const shareButton = page.getByTestId(`button-share-${post.id}`);
      await expect(shareButton).toBeVisible();
      await expect(shareButton).toHaveAttribute("aria-pressed", "false");
      await expect(shareButton).toHaveAttribute(
        "aria-label",
        `Share ${kindLabel}`,
      );
      await shareButton.click();
      const confirmBtn = page.getByTestId("button-confirm-share");
      await expect(confirmBtn).toBeVisible();
      await confirmBtn.click();
      await expect
        .poll(async () => (await getPost(api, post.id)).hasShared, {
          timeout: 10_000,
        })
        .toBe(true);
    }

    // 2) Open a fresh request context as Morgan (a seeded follower of
    //    Daniela) and confirm both posts surface in her home feed
    //    with sharedBy = Daniela. A standalone request context does
    //    not inherit `use.baseURL` from the page fixture, so pass it
    //    through explicitly here.
    const followerCtx = await pwRequest.newContext({ baseURL });
    try {
      const loginRes = await followerCtx.post("/api/v1/auth/login", {
        data: { email: FOLLOWER_EMAIL, password: FOLLOWER_PASSWORD },
      });
      expect(
        loginRes.ok(),
        `follower login failed: ${loginRes.status()}`,
      ).toBeTruthy();

      const feedRes = await followerCtx.get("/api/v1/feed");
      expect(feedRes.ok()).toBeTruthy();
      const feed = (await feedRes.json()) as {
        data: Array<FeedPost & { sharedBy?: { id: string } | null }>;
      };

      const recapInFeed = feed.data.find(
        (p) => p.id === recap.id && p.sharedBy?.id === me.id,
      );
      const hlInFeed = feed.data.find(
        (p) => p.id === highlight.id && p.sharedBy?.id === me.id,
      );
      expect(recapInFeed, "recap missing from follower feed").toBeDefined();
      expect(hlInFeed, "highlight missing from follower feed").toBeDefined();
    } finally {
      await followerCtx.dispose();
    }

    // 3) Clean up so the test is re-runnable.
    await api.delete(`/api/v1/posts/${recap.id}/share`);
    await api.delete(`/api/v1/posts/${highlight.id}/share`);
  });
});
