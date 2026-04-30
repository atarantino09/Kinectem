import {
  test,
  expect,
  type APIRequestContext,
  type Page,
  request as pwRequest,
} from "@playwright/test";

// Task #345 — Regression coverage for the highlight composer Post
// button. The bug: clicking Post once after interacting with the
// Tag Players roster picker did nothing visible — the user had to
// click a second time before the highlight was actually published.
// Root cause: the Tag Players DropdownMenu used Radix's default
// modal mode, which mounts a dismissable layer that swallows the
// first outside click after the menu is opened (or just dismissed),
// so the Post-button click never reached the button. Fix was to
// pass `modal={false}` to that one DropdownMenu instance in
// RosterTagPicker.tsx (shared dropdown-menu primitive defaults
// were intentionally NOT changed).
//
// This spec locks in the fix from both submit entry points:
//   1. Bottom in-form Post button, AFTER opening the Tag Players
//      picker and selecting a player — exercises the exact codepath
//      the original bug followed.
//   2. Header Post button, WITHOUT ever opening the picker — pins
//      down the always-single-click behavior so a future regression
//      that re-introduces a modal layer above the form is caught.

const COACH_EMAIL = "coach@kinectem.demo";
const PASSWORD = "demo1234";

type LoginResponse = { id: string };
type UserTeamRow = {
  teamId: string;
  teamName: string | null;
  status?: string | null;
  position?: string | null;
};

function resolveBaseURL(useBase: unknown): string {
  return (
    (typeof useBase === "string" ? useBase : undefined) ??
    process.env.E2E_BASE_URL ??
    "http://localhost:80"
  );
}

async function loginViaApi(
  api: APIRequestContext,
  email: string,
  password: string,
): Promise<string> {
  const res = await api.post("/api/v1/auth/login", {
    data: { email, password },
  });
  expect(res.ok(), `login as ${email} failed: ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as LoginResponse;
  return body.id;
}

async function loginViaUi(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("input-signin-email").fill(email);
  await page.getByTestId("input-signin-password").fill(PASSWORD);
  await page.getByTestId("btn-signin").click();
  // SignInForm does a hard window.location.assign("/"), so wait for
  // the home URL to settle before doing anything else.
  await page.waitForURL((url) => url.pathname === "/", { timeout: 15_000 });
}

// Discover a team the coach can post highlights for. We hit
// /users/:id/teams (the same endpoint the profile page uses to
// render the coach's team list) instead of hard-coding an org +
// team name pair, because seed data names drift across environments
// and we don't want this regression spec to bit-rot when an unrelated
// seed change renames the demo org or team. Any active coaching
// membership is fine — the highlight composer only needs a teamId.
async function findTeamWithRoster(
  api: APIRequestContext,
  userId: string,
): Promise<string> {
  const res = await api.get(`/api/v1/users/${userId}/teams`);
  expect(
    res.ok(),
    `GET /users/${userId}/teams failed: ${res.status()}`,
  ).toBeTruthy();
  const body = (await res.json()) as { data: UserTeamRow[] };
  const candidate =
    body.data.find((t) => t.status === "active" && !!t.teamId) ??
    body.data.find((t) => !!t.teamId);
  if (!candidate) {
    throw new Error(
      `Coach user ${userId} has no team memberships — seed data may be missing.`,
    );
  }
  // Sanity-check the team exists and has a roster the picker can show.
  // We don't require non-empty here (the composer still loads), but we
  // do warm the endpoint to surface a clear error if access is denied.
  const teamRes = await api.get(`/api/v1/teams/${candidate.teamId}/members`, {
    params: { status: "active", position: "player", limit: 100 },
  });
  expect(
    teamRes.ok(),
    `GET /teams/${candidate.teamId}/members failed: ${teamRes.status()}`,
  ).toBeTruthy();
  return candidate.teamId;
}

// Soft-delete via DELETE /posts/:postId — best effort. 204 on
// success, 404 if the row was already removed; both are fine. Used
// to clean up the highlights this spec creates so re-runs against a
// long-lived dev DB don't accumulate junk.
async function deletePostBestEffort(
  api: APIRequestContext,
  postId: string,
): Promise<void> {
  try {
    const res = await api.delete(`/api/v1/posts/${postId}`);
    // Accept 204 / 404 / 200; anything else is unexpected but the
    // test result is already what we care about.
    if (res.status() !== 204 && res.status() !== 404 && res.status() !== 200) {
      // eslint-disable-next-line no-console
      console.warn(
        `cleanup: unexpected DELETE /posts/${postId} status ${res.status()}`,
      );
    }
  } catch {
    // best-effort cleanup
  }
}

// Click Post and assert the page navigated off /posts/new on the
// FIRST click. Captures the create-highlight network response so
// the test can resolve the new post id for cleanup. If the click
// were swallowed (the bug), the URL would never change within the
// timeout and the test would fail.
async function clickPostOnceAndExpectNavigation(
  page: Page,
  triggerTestId: "button-publish" | "button-publish-bottom",
): Promise<string | null> {
  // Wait on both: (a) the create-highlight request completing and
  // (b) the URL leaving /posts/new. Promise.all the waiters BEFORE
  // the click so the listeners are armed.
  const responsePromise = page.waitForResponse(
    (resp) =>
      resp.url().includes("/api/v1/posts") &&
      resp.request().method() === "POST" &&
      resp.status() < 400,
    { timeout: 15_000 },
  );
  const navigationPromise = page.waitForURL(
    (url) => url.pathname !== "/posts/new",
    { timeout: 15_000 },
  );

  await page.getByTestId(triggerTestId).click();

  const [resp] = await Promise.all([responsePromise, navigationPromise]);
  try {
    const body = (await resp.json()) as { id?: string };
    return typeof body.id === "string" ? body.id : null;
  } catch {
    return null;
  }
}

test.describe("Highlight composer — Post on the first click (task #345)", () => {
  let coachApi: APIRequestContext | undefined;
  let teamId: string;
  // Highlights created by the two test cases — cleaned up in
  // afterAll so reruns don't pile up demo-data noise.
  const createdPostIds: string[] = [];

  test.beforeAll(async ({}, testInfo) => {
    const baseURL = resolveBaseURL(testInfo.project.use.baseURL);
    coachApi = await pwRequest.newContext({ baseURL });
    const userId = await loginViaApi(coachApi, COACH_EMAIL, PASSWORD);
    teamId = await findTeamWithRoster(coachApi, userId);
  });

  test.afterAll(async () => {
    if (coachApi) {
      for (const id of createdPostIds) {
        await deletePostBestEffort(coachApi, id);
      }
      await coachApi.dispose();
    }
  });

  test("bottom Post button publishes on first click after opening Tag Players", async ({
    page,
  }) => {
    await loginViaUi(page, COACH_EMAIL);

    await page.goto(`/posts/new?type=short&teamId=${teamId}`);

    const title = `Single-click highlight A ${Date.now()}`;
    await page.getByTestId("input-title").fill(title);

    // Open the Tag Players dropdown — this is the interaction that
    // used to arm the Radix dismissable layer that swallowed the
    // first outside click.
    const trigger = page.getByTestId("trigger-tag-players");
    await expect(trigger).toBeVisible();
    await trigger.click();

    // Wait for the menu to open, then tick one player. We pick the
    // first non-"select-all" row so the test isn't coupled to a
    // specific roster member name.
    await expect(
      page.getByTestId("row-tag-players-select-all"),
    ).toBeVisible();
    const playerRows = page.locator('[data-testid^="row-tag-players-"]:not([data-testid="row-tag-players-select-all"])');
    await expect(playerRows.first()).toBeVisible();
    await playerRows.first().click();

    // CRITICAL: click Post EXACTLY ONCE. If the bug were back, the
    // first click would be eaten by the Radix dismissable layer and
    // the URL would not change before the timeout, failing the
    // test.
    const newId = await clickPostOnceAndExpectNavigation(
      page,
      "button-publish-bottom",
    );
    if (newId) createdPostIds.push(newId);

    // The composer navigates to either the team page or a post
    // detail page — both are acceptable evidence the post landed.
    expect(page.url()).not.toContain("/posts/new");
  });

  test("header Post button publishes on first click without ever opening Tag Players", async ({
    page,
  }) => {
    await loginViaUi(page, COACH_EMAIL);

    await page.goto(`/posts/new?type=short&teamId=${teamId}`);

    const title = `Single-click highlight B ${Date.now()}`;
    await page.getByTestId("input-title").fill(title);

    // Deliberately do NOT touch the Tag Players picker — pin down
    // the always-single-click behavior so a future regression that
    // mounts a modal layer above the form on first render is also
    // caught here.
    const newId = await clickPostOnceAndExpectNavigation(
      page,
      "button-publish",
    );
    if (newId) createdPostIds.push(newId);

    expect(page.url()).not.toContain("/posts/new");
  });
});
