/**
 * Capture spec for Task #567 — replaces marketing Getting Started
 * screenshots for steps 1, 2, 3 and 5 with shots taken from the
 * "Legacy test" organization and its "Legacy Black 2014" team.
 *
 * Run with:
 *   pnpm --filter @workspace/kinectem exec playwright test \
 *     e2e/capture-getting-started-legacy.spec.ts --project=chromium
 *
 * Outputs are written to artifacts/marketing/public/ as PNGs which a
 * follow-up step converts to WebP with cwebp.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, type Page } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "../../marketing/public");

const OWNER_EMAIL = "marcus@kinectem.demo";
const OWNER_PASSWORD = "demo1234";
const ORG_NAME_PATTERN = /legacy/i;
const TEAM_NAME_PATTERN = /legacy black 2014/i;

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
    const handle = page.locator(clipSelector).first();
    await handle.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await handle.screenshot({ path: fullPath });
  } else {
    await page.screenshot({ path: fullPath, fullPage: false });
  }
}

test.use({ viewport: { width: 1280, height: 800 } });

test("capture Legacy getting-started screenshots", async ({ page }) => {
  test.setTimeout(120_000);
  await loginAsOwner(page);

  // Find the Legacy org id by navigating /organizations/mine and
  // matching by name (Marcus owns it).
  await page.goto("/organizations/mine");
  await page.waitForLoadState("networkidle");
  const orgLink = page
    .locator('a[href*="/organizations/"]')
    .filter({ hasText: ORG_NAME_PATTERN })
    .first();
  const orgHref = await orgLink.getAttribute("href");
  if (!orgHref) throw new Error("Could not find Legacy org on /organizations/mine");
  const orgId = orgHref.split("/organizations/")[1].split(/[/?#]/)[0];

  await page.goto(`/organizations/${orgId}`);
  await page.waitForLoadState("networkidle");
  const teamLink = page
    .locator('a[href*="/teams/"]')
    .filter({ hasText: TEAM_NAME_PATTERN })
    .first();
  const teamHref = await teamLink.getAttribute("href");
  if (!teamHref) throw new Error("Could not find Legacy Black 2014 team on org page");
  const teamId = teamHref.split("/teams/")[1].split(/[/?#]/)[0];

  async function dismissWelcome() {
    const dismiss = page.getByTestId("btn-welcome-org-dismiss");
    if (await dismiss.isVisible().catch(() => false)) {
      await dismiss.click();
      await page.waitForTimeout(200);
    }
  }

  // 1. Edit org dialog — Legacy org logo + fields.
  await page.goto(`/organizations/${orgId}`);
  await page.waitForLoadState("networkidle");
  await dismissWelcome();
  await page.getByTestId("btn-edit-org").first().click();
  await page.getByTestId("btn-upload-org-logo").waitFor({ timeout: 10_000 });
  await page.waitForTimeout(500);
  await shot(page, "gs-step-1-logo.png", '[role="dialog"]');
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // 2. New team dialog — create-team form prefilled with Legacy values
  // so the visible content matches the Legacy-org branding rather than
  // the default "Westfield U14 Boys" placeholders baked into the input.
  const addTeam = page.getByTestId("btn-add-team").first();
  await addTeam.click();
  await page.waitForTimeout(800);
  await page.getByTestId("input-team-name").fill("Legacy Black 2015");
  await page.locator("#team-slug").fill("legacy-black-2015");
  await page.getByLabel(/league/i).fill("EDP");
  await page.getByLabel(/season/i).fill("Fall 2026");
  // Move focus off the last input so no field shows the focus ring.
  await page.locator('[role="dialog"]').first().click({ position: { x: 10, y: 10 } });
  await page.waitForTimeout(300);
  await shot(page, "gs-step-2-team.png", '[role="dialog"]');
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // 3. Legacy Black 2014 → Staff tab.
  await page.goto(`/teams/${teamId}?roster=1`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(600);
  const staffTab = page.getByRole("tab", { name: /staff/i }).first();
  if (await staffTab.isVisible().catch(() => false)) {
    await staffTab.click();
    await page.waitForTimeout(500);
  }
  await shot(page, "gs-step-3-staff.png");

  // 5. Legacy Black 2014 → Roster (Players) tab.
  await page.goto(`/teams/${teamId}?roster=1`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);
  const rosterTab = page.getByRole("tab", { name: /roster|players/i }).first();
  if (await rosterTab.isVisible().catch(() => false)) {
    await rosterTab.click();
    await page.waitForTimeout(400);
  }
  await shot(page, "gs-step-5-roster.png");
});
