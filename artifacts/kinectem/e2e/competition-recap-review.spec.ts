import { test, expect, type BrowserContext } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// This suite uses isolated development accounts, disables their outgoing mail,
// and cleans up its own rows. It never mutates the shared demo users.
const root = fileURLToPath(new URL("../../../", import.meta.url));
type Fixture = {
  competitionId: string; slug: string; articleIds: string[]; password: string;
  people: Record<string, { id: string; email: string }>;
};
let fixture: Fixture;
test.beforeAll(() => {
  const output = execFileSync("pnpm", ["--filter", "@workspace/scripts", "exec", "tsx", "src/competition-recap-browser-fixture.ts", "seed"], { cwd: root, encoding: "utf8" });
  fixture = JSON.parse(output.trim().split("\n").at(-1)!);
});
test.afterAll(() => {
  execFileSync("pnpm", ["--filter", "@workspace/scripts", "exec", "tsx", "src/competition-recap-browser-fixture.ts", "clean"], { cwd: root });
});
async function login(context: BrowserContext, role: string) {
  const response = await context.request.post("/api/v1/auth/login", {
    data: { email: fixture.people[role].email, password: fixture.password },
  });
  expect(response.status()).toBe(200);
}

test("competition recap review is independent of featuring, bell reads and personal email preferences", async ({ page, context, browser, baseURL }) => {
  await login(context, "owner");
  await page.goto(`/app/competitions/c/${fixture.slug}`);
  await expect(page.getByTestId("competition-review-notice")).toContainText("2 recaps need review");
  await page.getByRole("link", { name: "Review recaps", exact: true }).click();
  await expect(page.getByTestId("recaps-view-pending")).toHaveText("Pending (2)");
  // A first-visit team spotlight can cover the recap links and intercept clicks.
  const tourBackdrop = page.getByTestId("tour-backdrop");
  if (await tourBackdrop.isVisible().catch(() => false)) await tourBackdrop.click({ position: { x: 5, y: 5 } });
  const first = fixture.articleIds[0];
  const popup = page.waitForEvent("popup");
  await page.locator(`a[href="/app/posts/article-${first}"]`).click();
  const recapPage = await popup;
  await expect(recapPage).toHaveURL(new RegExp(`/app/posts/article-${first}`));
  await expect(recapPage.getByText(/Full recap 1:/)).toBeVisible();
  await recapPage.close();
  await page.getByTestId(`btn-review-${first}`).click();
  await expect(page.getByTestId("recaps-view-pending")).toHaveText("Pending (1)");
  await page.getByTestId("recaps-view-reviewed").click();
  await expect(page.getByText("Reviewed · not featured", { exact: true })).toBeVisible();
  await page.getByTestId(`btn-feature-${first}`).click();
  await page.getByTestId("recaps-view-featured").click();
  await expect(page.getByText("Featured · reviewed", { exact: true })).toBeVisible();
  await page.getByTestId(`btn-unfeature-${first}`).click();
  await page.getByTestId("recaps-view-reviewed").click();
  await expect(page.getByText("Reviewed · not featured", { exact: true })).toBeVisible();
  await page.getByTestId("button-notifications").click();
  const alerts = await context.request.get("/api/v1/notifications");
  expect(alerts.ok()).toBe(true);
  const queue = await context.request.get(`/api/v1/competitions/${fixture.competitionId}/recaps`);
  expect((await queue.json()).pendingCount).toBe(1);
  await page.goto("/app/settings#email-notifications");
  await page.getByLabel("Competition recap review emails").selectOption("immediate");
  await expect.poll(async () => (await (await context.request.get("/api/v1/notifications/preferences")).json()).competitionRecapMode).toBe("immediate");
  await page.reload();
  await expect(page.getByLabel("Competition recap review emails")).toHaveValue("immediate");

  for (const role of ["direct", "hub"]) {
    const other = await browser.newContext({ baseURL });
    await login(other, role);
    const adminPage = await other.newPage();
    await adminPage.goto(`/app/competitions/c/${fixture.slug}`);
    await expect(adminPage.getByTestId("competition-review-notice")).toContainText("1 recap needs review");
    await adminPage.goto(`/app/posts/article-${first}`);
    await expect(adminPage.getByText(/Full recap 1:/)).toBeVisible();
    expect((await (await other.request.get("/api/v1/notifications/preferences")).json()).competitionRecapMode).toBe("off");
    await other.close();
  }
  const visitor = await browser.newContext({ baseURL });
  const visitorPage = await visitor.newPage();
  await visitorPage.goto(`/app/c/${fixture.slug}`);
  await expect(visitorPage.getByText("Recap Review Browser Cup").first()).toBeVisible();
  await expect(visitorPage.getByTestId("competition-review-notice")).toHaveCount(0);
  await login(visitor, "visitor");
  const unauthorized = await visitor.request.post(`/api/v1/competitions/${fixture.competitionId}/recaps/${first}/feature`, { data: { featured: true } });
  expect(unauthorized.status()).toBe(403);
  await visitor.close();
});
