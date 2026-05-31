/**
 * Focused re-capture for the game-recap-walkthrough video.
 *
 * Only re-shoots the three player-profile screenshots (full profile + the two
 * team-filtered views). The full walkthrough capture (capture-game-recap.spec.ts)
 * takes long enough that it can be interrupted by the sandbox before the profile
 * beats finish; this slim spec captures just those shots so they can be refreshed
 * quickly (e.g. after re-seeding demo data).
 *
 * Run with:
 *   pnpm --filter @workspace/kinectem exec playwright test \
 *     e2e/capture-profile-only.spec.ts --project=chromium
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, type Page } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "../../game-recap-walkthrough/public/shots");
const PROGRESS = "/tmp/cap-progress.log";

function log(msg: string) {
  fs.appendFileSync(PROGRESS, `[${new Date().toISOString()}] ${msg}\n`);
}

const BASE = "/app";
const OWNER_EMAIL = "marcus@kinectem.demo";
const OWNER_PASSWORD = "demo1234";
const SAM_USER = "09ff98fd-9909-4720-bbdf-26c735e9bdf9";
const LEGACY_TEAM = "e2da9c36-af84-40a0-a769-d31368f77c46";
const LEGACY_ORG = "c62b952f-9608-4163-b7c7-4fd83db7b145";

async function loginAsOwner(page: Page) {
  log("goto login");
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("input-signin-email").fill(OWNER_EMAIL, { timeout: 15000 });
  await page.getByTestId("input-signin-password").fill(OWNER_PASSWORD, { timeout: 15000 });
  await page.getByTestId("btn-signin").click({ timeout: 15000 });
  await page.waitForTimeout(4000);
  log("logged in, url: " + page.url());
}

async function waitLoaded(page: Page) {
  await page
    .waitForFunction(() => document.querySelectorAll(".animate-pulse").length === 0, null, {
      timeout: 12000,
    })
    .catch(() => {});
}

async function shot(page: Page, file: string, fullPage = true) {
  await waitLoaded(page);
  await page.waitForTimeout(700);
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.screenshot({
    path: path.join(OUT_DIR, file),
    fullPage,
    animations: "disabled",
    caret: "hide",
    timeout: 20000,
  });
  log("captured " + file);
}

test.use({ viewport: { width: 1280, height: 800 } });

test("capture player profile screenshots", async ({ page }) => {
  test.setTimeout(120_000);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  page.setDefaultNavigationTimeout(20000);
  page.setDefaultTimeout(15000);
  await loginAsOwner(page);

  log("BEAT start: team-page");
  await page.goto(`${BASE}/teams/${LEGACY_TEAM}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const postsTab = page.getByTestId("btn-toggle-posts");
  if (await postsTab.isVisible().catch(() => false)) {
    await postsTab.click();
    await page.waitForTimeout(1500);
  }
  await shot(page, "team-page.png");
  log("BEAT ok: team-page");

  log("BEAT start: org-page");
  await page.goto(`${BASE}/organizations/${LEGACY_ORG}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const welcomeDismiss = page.getByTestId("btn-welcome-org-dismiss");
  if (await welcomeDismiss.isVisible().catch(() => false)) {
    await welcomeDismiss.click();
    await page.waitForTimeout(300);
  }
  await shot(page, "org-page.png");
  log("BEAT ok: org-page");

  log("BEAT start: profile");
  await page.goto(`${BASE}/users/${SAM_USER}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await shot(page, "profile.png");
  log("BEAT ok: profile");

  log("BEAT start: profile-filter");
  const filter = page.getByTestId("select-team-filter");
  if (await filter.isVisible().catch(() => false)) {
    await filter.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await filter.click();
    await page.waitForTimeout(700);

    const soccerOpt = page
      .getByRole("option")
      .filter({ hasText: /legacy black 2014/i })
      .first();
    if (await soccerOpt.isVisible().catch(() => false)) {
      await soccerOpt.scrollIntoViewIfNeeded().catch(() => {});
      await soccerOpt.click({ force: true, timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1200);
      await shot(page, "profile-filtered.png");
    }

    if (await filter.isVisible().catch(() => false)) {
      await filter.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await filter.click();
      await page.waitForTimeout(700);
      const bballOpt = page
        .getByRole("option")
        .filter({ hasText: /basketball/i })
        .first();
      if (await bballOpt.isVisible().catch(() => false)) {
        await bballOpt.scrollIntoViewIfNeeded().catch(() => {});
        await bballOpt.click({ force: true, timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(1200);
        await shot(page, "profile-basketball.png");
      }
    }
  }
  log("BEAT ok: profile-filter");
});
