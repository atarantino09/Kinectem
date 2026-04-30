import {
  test,
  expect,
  type APIRequestContext,
  type Page,
  request as pwRequest,
} from "@playwright/test";

// Task #346 — Regression coverage for the recap composer Post
// button. The recap composer (`/posts/new?type=long`) uses a Radix
// `Select` for "Post On Behalf Of". The highlight composer's
// Tag Players DropdownMenu had a similar default-modal-layer bug
// (task #345) that swallowed the first outside click, forcing
// users to click Post twice. We verified manually that the recap
// composer's Select does NOT exhibit the same swallow today —
// the first click on Post DOES reach the submit handler — but
// the surface area is similar enough that we want a regression
// guard so a future change (e.g. swapping the Select for a
// modal Dialog or changing the shared primitive's defaults)
// can't quietly bring the bug back.
//
// What we assert: after opening the "Post On Behalf Of" Select
// and choosing an organization, clicking Post EXACTLY ONCE
// causes the form to submit (a POST /api/v1/posts request fires
// within a short window). We deliberately accept any response
// status — server-side validation outcomes (the seed coach can
// belong to multi-team orgs which return 400 from /posts when
// no teamId can be resolved) are orthogonal to the regression
// we're guarding against. If the click were swallowed, no POST
// would fire and the test would time out.

const COACH_EMAIL = "coach@kinectem.demo";
const PASSWORD = "demo1234";

type LoginResponse = { id: string };
type OrgRow = { id: string; name: string };
type PaginatedOrgs = { data: OrgRow[] };

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

// Discover an organization the coach can post on behalf of. We hit
// the same /users/:id/organizations endpoint the composer uses so
// the test fails clearly if the seed coach is ever stripped of
// org memberships, instead of bit-rotting on a hard-coded org name.
async function findOrganizationForUser(
  api: APIRequestContext,
  userId: string,
): Promise<OrgRow> {
  const res = await api.get(`/api/v1/users/${userId}/organizations`);
  expect(
    res.ok(),
    `GET /users/${userId}/organizations failed: ${res.status()}`,
  ).toBeTruthy();
  const body = (await res.json()) as PaginatedOrgs;
  const candidate = body.data[0];
  if (!candidate) {
    throw new Error(
      `Coach user ${userId} has no organization memberships — seed data may be missing.`,
    );
  }
  return candidate;
}

// Soft-delete any recap that this spec's click happened to publish
// successfully (some seed setups DO resolve a single team for the
// coach + org pair and the post lands). 204 / 404 / 200 are all
// acceptable; anything else is logged but doesn't fail the test.
async function deletePostBestEffort(
  api: APIRequestContext,
  postId: string,
): Promise<void> {
  try {
    const res = await api.delete(`/api/v1/posts/${postId}`);
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

test.describe("Recap composer — Post on the first click (task #346)", () => {
  let coachApi: APIRequestContext | undefined;
  let org: OrgRow;
  const createdPostIds: string[] = [];

  test.beforeAll(async ({}, testInfo) => {
    const baseURL = resolveBaseURL(testInfo.project.use.baseURL);
    coachApi = await pwRequest.newContext({ baseURL });
    const userId = await loginViaApi(coachApi, COACH_EMAIL, PASSWORD);
    org = await findOrganizationForUser(coachApi, userId);
  });

  test.afterAll(async () => {
    if (coachApi) {
      for (const id of createdPostIds) {
        await deletePostBestEffort(coachApi, id);
      }
      await coachApi.dispose();
    }
  });

  test("bottom Post button submits recap on first click after opening Post On Behalf Of", async ({
    page,
  }) => {
    await loginViaUi(page, COACH_EMAIL);

    // No teamId — that's what surfaces the "Post On Behalf Of"
    // Select (the composer hides it whenever the post is locked
    // to a team via the URL).
    await page.goto(`/posts/new?type=long`);

    const title = `Single-click recap ${Date.now()}`;
    await page.getByTestId("input-title").fill(title);
    await page
      .getByTestId("input-body")
      .fill("Recap body for the single-click regression test.");

    // Open the "Post On Behalf Of" select — this is the
    // interaction that arms the Radix Select's dismissable layer.
    // The point of the regression test is to confirm that the
    // first Post click after this still reaches the submit handler.
    const selectTrigger = page.getByTestId("select-post-on-behalf-of");
    await expect(selectTrigger).toBeVisible();
    await selectTrigger.click();

    // Wait for the option to appear, then pick the discovered org.
    const option = page.getByTestId(`option-post-on-behalf-of-${org.id}`);
    await expect(option).toBeVisible();
    await option.click();

    // Trigger should now show the chosen org name, confirming
    // the selection was committed before we click Post.
    await expect(selectTrigger).toContainText(org.name);

    // Arm the response listener BEFORE the click. We intentionally
    // accept ANY status — the regression we're guarding against is
    // "the click never reached the submit handler". Whether the
    // resulting recap actually publishes (some org+coach seed
    // combos resolve to multiple teams and return 400) is a
    // separate concern outside the scope of this guard.
    const responsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes("/api/v1/posts") &&
        resp.request().method() === "POST",
      { timeout: 15_000 },
    );

    // CRITICAL: click Post EXACTLY ONCE. If a future change
    // re-introduced the swallowed-first-click bug (e.g. by mounting
    // a modal layer above the form), this listener would time out
    // and the test would fail.
    await page.getByTestId("button-publish-bottom").click();

    const resp = await responsePromise;

    // Best-effort cleanup of a successfully-created post. A 2xx
    // response means the recap landed; capture the id so we can
    // soft-delete it in afterAll.
    if (resp.status() < 300) {
      try {
        const body = (await resp.json()) as { id?: string };
        if (typeof body.id === "string") createdPostIds.push(body.id);
      } catch {
        // body wasn't JSON or didn't carry an id — ignore.
      }
    }
  });
});
