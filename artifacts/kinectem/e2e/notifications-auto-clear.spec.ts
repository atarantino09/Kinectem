import {
  test,
  expect,
  type APIRequestContext,
  type Page,
  request as pwRequest,
} from "@playwright/test";

// Task #406 — End-to-end coverage for the auto-clear behavior introduced in
// Task #405. Three scenarios:
//
//   1. Opening the notifications bell drops the user's own unread badge to
//      zero immediately, with no per-row click. The dropdown stays open with
//      the rows visible — that's how we know the badge disappeared because of
//      the auto-clear (POST /notifications/read-all on open), not because the
//      dropdown closed.
//
//   2. Opening an unread DM conversation drops both the per-conversation
//      unread badge AND the global Inbox nav badge to zero immediately, with
//      no message sent. This is the on-mount useEffect in
//      MessagesPage.ConversationView that fires POST
//      /conversations/:id/read.
//
//   3. The COPPA parent (lisa) bell badge — which is the sum of her own
//      unread + her children-summary aggregate — clears on bell open along
//      with the "X new in your family" hint. The bell additionally fires per
//      child POST /users/me/children/:childId/notifications/read-all.
//
// Setup uses API steps so the suite is deterministic on long-lived dev DBs:
//   * lisa unfollows then re-follows samira         -> approved follow
//                                                      notification for samira
//                                                      (drives Test 1).
//   * marcus unfollows then re-follows samira       -> pending follow
//                                                      notification for lisa as
//                                                      the guardian (drives
//                                                      Test 3).
//   * marcus DMs sam with a fresh body              -> fresh unread DM
//                                                      (drives Test 2).
//
// Re-running the unfollow+follow guarantees a brand-new notifications row
// every run; following an already-followed user is a no-op (onConflictDoNothing
// returns nothing) and produces no notification.

const PASSWORD = "demo1234";
const SAMIRA_EMAIL = "samira@kinectem.demo";
const LISA_EMAIL = "lisa@kinectem.demo";
const MARCUS_EMAIL = "marcus@kinectem.demo";
const SAM_EMAIL = "sam@kinectem.demo";

type DemoUser = { id: string; email: string | null };

async function getDemoUserId(api: APIRequestContext, email: string): Promise<string> {
  const res = await api.get("/api/v1/auth/users");
  expect(res.ok(), `GET /auth/users failed: ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as DemoUser[] | { data: DemoUser[] };
  const list = Array.isArray(body) ? body : body.data;
  const match = list.find((u) => u.email === email);
  if (!match) throw new Error(`Demo user not found: ${email}`);
  return match.id;
}

async function loginUiAs(page: Page, email: string) {
  await page.goto("/login");
  await page.getByTestId("input-signin-email").fill(email);
  await page.getByTestId("input-signin-password").fill(PASSWORD);
  await page.getByTestId("btn-signin").click();
  await page.waitForURL(/\/(?:$|\?)/, { timeout: 15_000 });
}

async function freshFollow(
  api: APIRequestContext,
  targetUserId: string,
): Promise<void> {
  // Unfollow first (accept 200/204/404), then re-follow to guarantee a brand
  // new notification row.
  const del = await api.delete(`/api/v1/users/${targetUserId}/follow`);
  expect(
    del.ok() || del.status() === 404,
    `unfollow failed: ${del.status()}`,
  ).toBeTruthy();
  const post = await api.post(`/api/v1/users/${targetUserId}/follow`, {
    data: {},
  });
  expect(post.ok(), `follow failed: ${post.status()}`).toBeTruthy();
}

async function newApiContextLoggedIn(
  baseURL: string,
  email: string,
): Promise<APIRequestContext> {
  const ctx = await pwRequest.newContext({ baseURL });
  const res = await ctx.post("/api/v1/auth/login", {
    data: { email, password: PASSWORD },
  });
  expect(res.ok(), `login failed for ${email}: ${res.status()}`).toBeTruthy();
  return ctx;
}

test.describe("Notifications & inbox auto-clear (Task #405 / #406)", () => {
  test("bell auto-clears samira's unread badge on open without per-row clicks", async ({
    page,
  }, testInfo) => {
    const baseURL =
      (testInfo.project.use.baseURL as string | undefined) ??
      process.env.E2E_BASE_URL ??
      "http://localhost:80";

    // --- Setup -----------------------------------------------------------
    const lookupCtx = await pwRequest.newContext({ baseURL });
    let samiraId: string;
    try {
      samiraId = await getDemoUserId(lookupCtx, SAMIRA_EMAIL);
    } finally {
      await lookupCtx.dispose();
    }

    // lisa is samira's linked guardian, so gateFollowOfMinor returns
    // "approved" for this follow edge and the notification rings samira
    // directly.
    const lisaApi = await newApiContextLoggedIn(baseURL, LISA_EMAIL);
    try {
      await freshFollow(lisaApi, samiraId);
    } finally {
      await lisaApi.dispose();
    }

    // --- UI assertions ---------------------------------------------------
    await loginUiAs(page, SAMIRA_EMAIL);

    const bellButton = page.getByTestId("button-notifications");
    const bellBadge = page.getByTestId("badge-bell-unread");

    await expect(bellButton).toBeVisible();
    await expect(bellBadge).toBeVisible();

    await bellButton.click();

    // The dropdown is open — assert at least one notification row is
    // rendered so we know the badge disappearance below isn't because
    // the dropdown closed.
    await expect(
      page.locator('[data-testid^="notification-"]').first(),
    ).toBeVisible();

    // Auto-clear runs in handleOpenChange; the optimistic cache update
    // makes the badge disappear in the same render tick. Allow a small
    // window to be safe.
    await expect(bellBadge).toHaveCount(0, { timeout: 3_000 });
  });

  test("opening a DM auto-clears the per-conversation and global inbox badges", async ({
    page,
  }, testInfo) => {
    const baseURL =
      (testInfo.project.use.baseURL as string | undefined) ??
      process.env.E2E_BASE_URL ??
      "http://localhost:80";

    // --- Setup -----------------------------------------------------------
    const lookupCtx = await pwRequest.newContext({ baseURL });
    let samId: string;
    try {
      samId = await getDemoUserId(lookupCtx, SAM_EMAIL);
    } finally {
      await lookupCtx.dispose();
    }

    const marcusApi = await newApiContextLoggedIn(baseURL, MARCUS_EMAIL);
    let convId: string;
    try {
      const res = await marcusApi.post("/api/v1/conversations", {
        data: {
          recipientId: samId,
          recipientType: "user",
          message: {
            body: `auto-clear test ${Date.now()}`,
          },
        },
      });
      expect(
        res.ok(),
        `create conversation failed: ${res.status()}`,
      ).toBeTruthy();
      const body = (await res.json()) as { id: string };
      convId = body.id;
    } finally {
      await marcusApi.dispose();
    }

    // --- UI assertions ---------------------------------------------------
    await loginUiAs(page, SAM_EMAIL);

    const inboxBadge = page.getByTestId("badge-link-messages");
    await expect(inboxBadge).toBeVisible();

    await page.getByTestId("link-messages").click();
    await page.waitForURL(/\/messages(?:\?|$)/);

    const convBadge = page.getByTestId(`badge-conversation-unread-${convId}`);
    await expect(page.getByTestId(`conversation-${convId}`)).toBeVisible();
    await expect(convBadge).toBeVisible();

    // Open the conversation. The on-mount useEffect in ConversationView
    // optimistically zeros this row's unreadCount AND decrements the
    // global unread-message count.
    await page.getByTestId(`link-conversation-${convId}`).click();
    await page.waitForURL(new RegExp(`/messages/${convId}(?:\\?|$)`));

    // Both badges should be gone within a short window — and we did NOT
    // type or send anything. The conversation list (left aside) is still
    // visible at this point, confirming the badge disappearance is the
    // auto-mark-read effect, not navigation away.
    await expect(convBadge).toHaveCount(0, { timeout: 3_000 });
    await expect(inboxBadge).toHaveCount(0, { timeout: 3_000 });
  });

  test("parent bell auto-clears children-summary badge and family hint on open", async ({
    page,
  }, testInfo) => {
    const baseURL =
      (testInfo.project.use.baseURL as string | undefined) ??
      process.env.E2E_BASE_URL ??
      "http://localhost:80";

    // --- Setup -----------------------------------------------------------
    const lookupCtx = await pwRequest.newContext({ baseURL });
    let samiraId: string;
    try {
      samiraId = await getDemoUserId(lookupCtx, SAMIRA_EMAIL);
    } finally {
      await lookupCtx.dispose();
    }

    // marcus is a stranger to samira (a minor) so this follow lands as
    // "pending" and notifyGuardianOfPendingItem rings LISA, populating her
    // own bell. We additionally re-follow as lisa so the child has unread
    // items, which makes the children-summary aggregate non-zero (driving
    // the "X new in your family" hint).
    const marcusApi = await newApiContextLoggedIn(baseURL, MARCUS_EMAIL);
    try {
      await freshFollow(marcusApi, samiraId);
    } finally {
      await marcusApi.dispose();
    }
    const lisaApi = await newApiContextLoggedIn(baseURL, LISA_EMAIL);
    try {
      await freshFollow(lisaApi, samiraId);
    } finally {
      await lisaApi.dispose();
    }

    // --- UI assertions ---------------------------------------------------
    await loginUiAs(page, LISA_EMAIL);

    const bellButton = page.getByTestId("button-notifications");
    const bellBadge = page.getByTestId("badge-bell-unread");
    const familyHint = page.getByTestId("button-family-unread-hint");

    await expect(bellButton).toBeVisible();
    await expect(bellBadge).toBeVisible();

    await bellButton.click();

    // Confirm at least one notification row rendered before asserting the
    // badge cleared, so we know it cleared due to auto-clear and not
    // because the dropdown closed.
    await expect(
      page.locator('[data-testid^="notification-"]').first(),
    ).toBeVisible();

    await expect(bellBadge).toHaveCount(0, { timeout: 3_000 });
    // The family-unread hint only renders while childrenUnread > 0; the
    // optimistic-zero in handleOpenChange should make it disappear.
    await expect(familyHint).toHaveCount(0, { timeout: 3_000 });
  });
});
