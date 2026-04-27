import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

// All API helpers must receive the page-context's request so that cookies
// set during UI sign-in are reused on the API side.

const SHARER_EMAIL = "daniela@kinectem.demo";
const SHARER_PASSWORD = "demo1234";
const SHARER_DISPLAY_NAME = "Daniela Ortiz";
const RECAP_TITLE = "Westfield Dominates Lincoln High 34-14";

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
});
