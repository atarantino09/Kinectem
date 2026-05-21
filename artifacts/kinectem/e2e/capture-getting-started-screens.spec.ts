/**
 * Capture spec for Task #549 — generates the six product screenshots
 * used by the public marketing Getting Started guide.
 *
 * Run with:
 *   pnpm --filter @workspace/kinectem exec playwright test \
 *     e2e/capture-getting-started-screens.spec.ts --project=chromium
 *
 * Outputs are written to artifacts/marketing/public/ as PNGs which a
 * follow-up step converts to WebP with cwebp.
 *
 * This spec relies on the demo seed (sam@kinectem.demo as owner of the
 * Westfield organization, with seeded teams and roster).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, type Page } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(
  __dirname,
  "../../marketing/public",
);

const OWNER_EMAIL = "sam@kinectem.demo";
const OWNER_PASSWORD = "demo1234";

async function loginAsOwner(page: Page) {
  await page.goto("/login");
  await page.getByTestId("input-signin-email").fill(OWNER_EMAIL);
  await page.getByTestId("input-signin-password").fill(OWNER_PASSWORD);
  await page.getByTestId("btn-signin").click();
  await page.waitForURL(/\/(?:$|\?)/, { timeout: 15_000 });
}

async function shot(page: Page, file: string, clipSelector?: string) {
  const fullPath = path.join(OUT_DIR, file);
  if (clipSelector) {
    const handle = await page.locator(clipSelector).first();
    await handle.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await handle.screenshot({ path: fullPath });
  } else {
    await page.screenshot({ path: fullPath, fullPage: false });
  }
}

test.use({ viewport: { width: 1280, height: 800 } });

test("capture getting-started screenshots", async ({ page }) => {
  test.setTimeout(120_000);
  await loginAsOwner(page);

  // Resolve org + team IDs by navigating the UI (the JSON API base path
  // differs by environment; navigating gives us URLs we can parse).
  await page.goto("/organizations/mine");
  await page.waitForLoadState("networkidle");
  const orgHref = await page
    .locator('a[href*="/organizations/"]')
    .first()
    .getAttribute("href");
  if (!orgHref) throw new Error("Could not find any org on /organizations/mine");
  const orgId = orgHref.split("/organizations/")[1].split(/[/?#]/)[0];
  const westfield = { id: orgId };

  await page.goto(`/organizations/${orgId}`);
  await page.waitForLoadState("networkidle");
  const teamHref = await page
    .locator('a[href*="/teams/"]')
    .first()
    .getAttribute("href");
  if (!teamHref) throw new Error("Could not find any team on org page");
  const teamId = teamHref.split("/teams/")[1].split(/[/?#]/)[0];
  const varsity = { id: teamId };

  async function dismissWelcome() {
    const dismiss = page.getByTestId("btn-welcome-org-dismiss");
    if (await dismiss.isVisible().catch(() => false)) {
      await dismiss.click();
      await page.waitForTimeout(200);
    }
  }

  // 1. Edit org dialog — shows the actual logo upload UI.
  await page.goto(`/organizations/${westfield.id}`);
  await page.waitForLoadState("networkidle");
  await dismissWelcome();
  await page.getByTestId("btn-edit-org").first().click();
  await page.getByTestId("btn-upload-org-logo").waitFor({ timeout: 10_000 });
  await page.waitForTimeout(500);
  await shot(page, "gs-step-1-logo.png", '[role="dialog"]');
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // 2. New team dialog — shows the create-team form.
  const addTeam = page.getByTestId("btn-add-team").first();
  await addTeam.click();
  await page.waitForTimeout(800);
  await shot(page, "gs-step-2-team.png", '[role="dialog"]');
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // 3. Team page → Staff tab — coaches & staff for the team.
  await page.goto(`/teams/${varsity.id}?roster=1`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(600);
  const staffTab = page.getByRole("tab", { name: /staff/i }).first();
  if (await staffTab.isVisible().catch(() => false)) {
    await staffTab.click();
    await page.waitForTimeout(500);
  }
  await shot(page, "gs-step-3-staff.png");

  // 4. Manage admins & members dialog — promote a co-admin.
  await page.goto(`/organizations/${westfield.id}`);
  await page.waitForLoadState("networkidle");
  await dismissWelcome();
  const manageBtn = page
    .getByTestId("btn-manage-admins-hero")
    .or(page.getByTestId("btn-manage-members"))
    .first();
  await manageBtn.click();
  await page.waitForTimeout(700);
  await shot(page, "gs-step-4-admin.png", '[role="dialog"]');
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // 5. Team page → Roster (Players) tab.
  await page.goto(`/teams/${varsity.id}?roster=1`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);
  const rosterTab = page.getByRole("tab", { name: /roster|players/i }).first();
  if (await rosterTab.isVisible().catch(() => false)) {
    await rosterTab.click();
    await page.waitForTimeout(400);
  }
  await shot(page, "gs-step-5-roster.png");

  // 6. Family / guardian dashboard — seeded parent.
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("input-signin-email").fill("lisa@kinectem.demo");
  await page.getByTestId("input-signin-password").fill("demo1234");
  await page.getByTestId("btn-signin").click();
  await page.waitForURL(/\/(?:$|\?)/, { timeout: 15_000 });
  await page.goto("/family");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);
  await shot(page, "gs-step-6-guardian.png");
});
