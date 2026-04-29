import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

const ROSTER_MEMBER_EMAIL = "marcus@kinectem.demo";
const NON_MEMBER_EMAIL = "daniela@kinectem.demo";
const PASSWORD = "demo1234";
const TEAM_NAME = "Varsity Football";

type Org = { id: string; name: string };
type Team = { id: string; name: string };

async function loginViaUi(page: Page, email: string) {
  await page.goto("/login");
  await page.getByTestId("input-signin-email").fill(email);
  await page.getByTestId("input-signin-password").fill(PASSWORD);
  await page.getByTestId("btn-signin").click();
  await page.waitForURL(/\/(?:$|\?)/, { timeout: 15_000 });
}

async function findVarsityFootballTeamId(api: APIRequestContext): Promise<string> {
  const orgsRes = await api.get("/api/v1/organizations", {
    params: { limit: 200 },
  });
  expect(orgsRes.ok()).toBeTruthy();
  const orgsBody = (await orgsRes.json()) as { data: Org[] };
  for (const org of orgsBody.data) {
    const teamsRes = await api.get(`/api/v1/organizations/${org.id}/teams`);
    if (!teamsRes.ok()) continue;
    const teamsBody = (await teamsRes.json()) as { data: Team[] };
    const team = teamsBody.data.find((t) => t.name === TEAM_NAME);
    if (team) return team.id;
  }
  throw new Error(`Team "${TEAM_NAME}" not found in any organization`);
}

test.describe("Team page — Post Highlight CTA", () => {
  test("roster member sees the button and clicking it opens the team-locked composer", async ({
    page,
  }) => {
    await loginViaUi(page, ROSTER_MEMBER_EMAIL);
    const api = page.context().request;
    const teamId = await findVarsityFootballTeamId(api);

    await page.goto(`/teams/${teamId}`);
    const postBtn = page.getByTestId("btn-create-highlight");
    await expect(postBtn).toBeVisible();

    await postBtn.click();
    await page.waitForURL(/\/posts\/new\?.*type=short.*teamId=/, {
      timeout: 10_000,
    });
    expect(page.url()).toContain("type=short");
    expect(page.url()).toContain(`teamId=${teamId}`);
  });

  test("user not on the roster does not see the button", async ({ page }) => {
    await loginViaUi(page, NON_MEMBER_EMAIL);
    const api = page.context().request;
    const teamId = await findVarsityFootballTeamId(api);

    await page.goto(`/teams/${teamId}`);
    // Wait for team page header to render so the section has loaded.
    await expect(page.getByRole("heading", { name: TEAM_NAME })).toBeVisible();
    await expect(page.getByTestId("btn-create-highlight")).toHaveCount(0);
  });
});
