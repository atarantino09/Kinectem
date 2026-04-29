import {
  test,
  expect,
  type APIRequestContext,
  type Page,
  request as pwRequest,
} from "@playwright/test";

// Task #304 — Standing coverage for the PostCard 3-dot menu's "Edit"
// affordance on highlights and Updates. Task #303 fixed a bug where a
// kind-based gate hid the Edit item on those two kinds even when the
// server marked the post as `canEdit: true`. This test pins the fix down
// so a future refactor of PostCard.tsx that re-introduces the gate fails
// in CI instead of silently shipping.
//
// Coverage:
//   1. As the author (coach@kinectem.demo, who uploaded the seeded
//      Highlight and authored the freshly-created Update), the 3-dot
//      menu on each card shows `menuitem-edit-{postId}` and clicking it
//      lands on `/posts/new?editId={postId}`.
//   2. As a non-author (lisa@kinectem.demo, who follows both surfaces
//      but didn't author either post), the same menus show only
//      `menuitem-report-{postId}` — no edit item is rendered.

const COACH_EMAIL = "coach@kinectem.demo";
const COACH_PASSWORD = "demo1234";
const NON_AUTHOR_EMAIL = "lisa@kinectem.demo";
const NON_AUTHOR_PASSWORD = "demo1234";
const ORG_NAME = "Westfield Athletic Club";
const TEAM_NAME = "Varsity Football";
const HIGHLIGHT_TITLE = "40-yard TD Catch vs. Lincoln HS";
// Use a fresh, uniquely-titled Update each test run so re-runs don't
// fight over the same row and so we can safely afterAll-delete it.
const UPDATE_TITLE = `Edit-menu coverage Update ${Date.now()}`;
const UPDATE_BODY =
  "Auto-created by post-card-edit-menu.spec.ts to verify the 3-dot menu's Edit item.";

type FeedPost = { id: string; title?: string | null };
type Org = { id: string; name: string };
type Team = { id: string; name: string };

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
): Promise<void> {
  const res = await api.post("/api/v1/auth/login", {
    data: { email, password },
  });
  expect(res.ok(), `login as ${email} failed: ${res.status()}`).toBeTruthy();
}

async function loginViaUi(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("input-signin-email").fill(email);
  await page.getByTestId("input-signin-password").fill(password);
  await page.getByTestId("btn-signin").click();
  // SignInForm does a hard window.location.assign("/"), so wait for the
  // home URL to settle before doing anything else.
  await page.waitForURL((url) => url.pathname === "/", { timeout: 15_000 });
}

async function findOrg(api: APIRequestContext, name: string): Promise<Org> {
  const res = await api.get("/api/v1/organizations");
  expect(res.ok(), `GET /organizations failed: ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { data: Org[] };
  const org = body.data.find((o) => o.name === name);
  if (!org) throw new Error(`Could not find seeded org "${name}".`);
  return org;
}

async function findTeam(
  api: APIRequestContext,
  orgId: string,
  name: string,
): Promise<Team> {
  const res = await api.get(`/api/v1/organizations/${orgId}/teams`);
  expect(res.ok(), `GET org teams failed: ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { data: Team[] };
  const team = body.data.find((t) => t.name === name);
  if (!team) {
    throw new Error(`Could not find seeded team "${name}" under org ${orgId}.`);
  }
  return team;
}

async function findHighlight(
  api: APIRequestContext,
  teamId: string,
  title: string,
): Promise<FeedPost> {
  const res = await api.get(`/api/v1/teams/${teamId}/posts`);
  expect(res.ok(), `GET team posts failed: ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { data: FeedPost[] };
  const hl = body.data.find(
    (p) => p.id.startsWith("highlight-") && p.title === title,
  );
  if (!hl) {
    throw new Error(
      `Could not find seeded highlight "${title}" on team ${teamId}.`,
    );
  }
  return hl;
}

async function createUpdate(
  api: APIRequestContext,
  orgId: string,
): Promise<FeedPost> {
  const res = await api.post(`/api/v1/organizations/${orgId}/posts`, {
    data: { title: UPDATE_TITLE, body: UPDATE_BODY },
  });
  expect(
    res.ok(),
    `POST /organizations/${orgId}/posts failed: ${res.status()}`,
  ).toBeTruthy();
  const post = (await res.json()) as FeedPost;
  if (!post.id.startsWith("orgpost-")) {
    throw new Error(`Unexpected Update id shape: ${post.id}`);
  }
  return post;
}

async function deleteUpdate(
  api: APIRequestContext,
  postId: string,
): Promise<void> {
  // 204 on success, 404 if the row was already removed by a previous run
  // — both are fine for cleanup.
  const res = await api.delete(`/api/v1/posts/${postId}`);
  expect(res.status() === 204 || res.status() === 404).toBeTruthy();
}

// Resolve and (if needed) scroll the card into view before opening its
// 3-dot menu. The team page renders up to 5 cards and the org page can
// have many; both surfaces lazily render the post list under the page
// fold, so a deliberate scroll keeps the menu trigger interactable.
async function openPostMenu(page: Page, postId: string): Promise<void> {
  const trigger = page.getByTestId(`btn-post-menu-${postId}`);
  await expect(trigger).toBeVisible({ timeout: 15_000 });
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
}

test.describe("PostCard 3-dot menu — Edit on highlights and Updates", () => {
  let coachApi: APIRequestContext | undefined;
  let org: Org;
  let team: Team;
  let highlight: FeedPost;
  let update: FeedPost | undefined;

  test.beforeAll(async ({}, testInfo) => {
    const baseURL = resolveBaseURL(testInfo.project.use.baseURL);
    coachApi = await pwRequest.newContext({ baseURL });
    await loginViaApi(coachApi, COACH_EMAIL, COACH_PASSWORD);

    org = await findOrg(coachApi, ORG_NAME);
    team = await findTeam(coachApi, org.id, TEAM_NAME);
    highlight = await findHighlight(coachApi, team.id, HIGHLIGHT_TITLE);
    update = await createUpdate(coachApi, org.id);
  });

  test.afterAll(async () => {
    // Both branches must tolerate a beforeAll that aborted partway —
    // e.g. coachApi initialized but the Update creation threw — so
    // cleanup never masks the original failure with a NPE.
    if (coachApi && update?.id) {
      try {
        await deleteUpdate(coachApi, update.id);
      } catch {
        // Best-effort cleanup; the test failure is already reported.
      }
    }
    if (coachApi) {
      await coachApi.dispose();
    }
  });

  test("author sees Edit on the highlight and the Update menus, and clicking it routes to the composer", async ({
    page,
  }) => {
    await loginViaUi(page, COACH_EMAIL, COACH_PASSWORD);

    // ---- Highlight on the team page ----
    await page.goto(`/teams/${team.id}`);
    await openPostMenu(page, highlight.id);

    const highlightEdit = page.getByTestId(`menuitem-edit-${highlight.id}`);
    await expect(highlightEdit).toBeVisible();
    // The Report item is always rendered; assert it sits alongside Edit
    // so we know the menu opened against the right card.
    await expect(
      page.getByTestId(`menuitem-report-${highlight.id}`),
    ).toBeVisible();

    await highlightEdit.click();
    await page.waitForURL(
      (url) =>
        url.pathname === "/posts/new" &&
        url.searchParams.get("editId") === highlight.id,
      { timeout: 10_000 },
    );

    // ---- Update on the org page ----
    await page.goto(`/organizations/${org.id}`);
    await openPostMenu(page, update.id);

    const updateEdit = page.getByTestId(`menuitem-edit-${update.id}`);
    await expect(updateEdit).toBeVisible();
    await expect(
      page.getByTestId(`menuitem-report-${update.id}`),
    ).toBeVisible();

    await updateEdit.click();
    await page.waitForURL(
      (url) =>
        url.pathname === "/posts/new" &&
        url.searchParams.get("editId") === update.id,
      { timeout: 10_000 },
    );
  });

  test("non-author sees only Report — Edit is not rendered on either menu", async ({
    page,
  }) => {
    await loginViaUi(page, NON_AUTHOR_EMAIL, NON_AUTHOR_PASSWORD);

    // ---- Highlight on the team page ----
    await page.goto(`/teams/${team.id}`);
    await openPostMenu(page, highlight.id);
    await expect(
      page.getByTestId(`menuitem-report-${highlight.id}`),
    ).toBeVisible();
    await expect(
      page.getByTestId(`menuitem-edit-${highlight.id}`),
    ).toHaveCount(0);
    // Close the dropdown before navigating so it doesn't trap the next
    // click.
    await page.keyboard.press("Escape");

    // ---- Update on the org page ----
    await page.goto(`/organizations/${org.id}`);
    await openPostMenu(page, update.id);
    await expect(
      page.getByTestId(`menuitem-report-${update.id}`),
    ).toBeVisible();
    await expect(page.getByTestId(`menuitem-edit-${update.id}`)).toHaveCount(0);
  });
});
