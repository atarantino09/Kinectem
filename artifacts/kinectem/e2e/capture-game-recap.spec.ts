/**
 * Capture spec for Task #579 — Game Recap Walkthrough video.
 *
 * Captures REAL screenshots of the Kinectem app (Legacy Black 2014 team,
 * "Legacy test" org, and the made-up multi-sport player "Sam Carter") for
 * use as backdrops in the game-recap-walkthrough video artifact.
 *
 * Run with:
 *   pnpm --filter @workspace/kinectem exec playwright test \
 *     e2e/capture-game-recap.spec.ts --project=chromium
 *
 * Outputs are written to artifacts/game-recap-walkthrough/public/shots/.
 * The app is served under the /app base path via the shared proxy.
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

// Known seeded ids (verified via DB).
const LEGACY_TEAM = "e2da9c36-af84-40a0-a769-d31368f77c46";
const LEGACY_ORG = "c62b952f-9608-4163-b7c7-4fd83db7b145";
const SAM_USER = "09ff98fd-9909-4720-bbdf-26c735e9bdf9";

async function loginAsOwner(page: Page) {
  log("goto login");
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  log("login page loaded: " + page.url());
  await page.getByTestId("input-signin-email").fill(OWNER_EMAIL, { timeout: 15000 });
  await page.getByTestId("input-signin-password").fill(OWNER_PASSWORD, { timeout: 15000 });
  log("filled creds, clicking signin");
  await page.getByTestId("btn-signin").click({ timeout: 15000 });
  await page.waitForTimeout(4000);
  log("logged in, url: " + page.url());
}

async function dismissWelcome(page: Page) {
  const dismiss = page.getByTestId("btn-welcome-org-dismiss");
  if (await dismiss.isVisible().catch(() => false)) {
    await dismiss.click();
    await page.waitForTimeout(300);
  }
}

async function waitLoaded(page: Page) {
  // Skeleton placeholders use Tailwind's animate-pulse; wait for them to clear.
  await page
    .waitForFunction(() => document.querySelectorAll(".animate-pulse").length === 0, null, {
      timeout: 12000,
    })
    .catch(() => {});
}

async function shot(page: Page, file: string) {
  await waitLoaded(page);
  await page.waitForTimeout(700);
  // Don't let pending web fonts / animations stall the screenshot indefinitely.
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.screenshot({
    path: path.join(OUT_DIR, file),
    fullPage: false,
    animations: "disabled",
    caret: "hide",
    timeout: 12000,
  });
  log("captured " + file);
}

test.use({ viewport: { width: 1280, height: 800 } });

test("capture game recap walkthrough screenshots", async ({ page }) => {
  test.setTimeout(150_000);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(PROGRESS, "");
  page.setDefaultNavigationTimeout(20000);
  page.setDefaultTimeout(15000);
  await loginAsOwner(page);

  async function beat(name: string, fn: () => Promise<void>) {
    log("BEAT start: " + name);
    try {
      await fn();
      log("BEAT ok: " + name);
    } catch (err) {
      log("BEAT FAIL: " + name + " -> " + (err as Error).message.split("\n")[0]);
      await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) }).catch(() => {});
    }
  }

  // 1. Legacy Black 2014 team page — Recent Posts feed (the recaps).
  await beat("team-page", async () => {
    await page.goto(`${BASE}/teams/${LEGACY_TEAM}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    const postsTab = page.getByTestId("btn-toggle-posts");
    if (await postsTab.isVisible().catch(() => false)) {
      await postsTab.click();
      await page.waitForTimeout(1500);
    }
    await shot(page, "team-page.png");
  });

  // 2. Recap composer — filled out for a Legacy Black 2014 game recap.
  await beat("composer", async () => {
    await page.goto(`${BASE}/posts/new`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    const teamPicker = page.getByTestId("select-post-to-team");
    if (await teamPicker.isVisible().catch(() => false)) {
      await teamPicker.click();
      await page.waitForTimeout(500);
      const opt = page
        .locator('[data-testid^="option-post-to-team-"]')
        .filter({ hasText: /legacy black 2014/i })
        .first();
      if (await opt.isVisible().catch(() => false)) {
        await opt.click();
        await page.waitForTimeout(400);
      } else {
        await page.keyboard.press("Escape");
      }
    }
    await page
      .getByTestId("input-title")
      .fill("Legacy Black Battle Back to Win the Middletown Cup");
    const dateInput = page.getByTestId("input-game-date");
    if (await dateInput.isVisible().catch(() => false)) {
      await dateInput.fill("2026-05-24");
    }
    await page
      .getByTestId("input-body")
      .fill(
        "It looked grim at the half. Trailing 1-0 and pinned in their own end, Legacy Black 2014 needed a spark — and Sam Carter delivered. Two second-half goals and a cool finish in stoppage time sealed a 3-2 comeback and the Middletown Cup.",
      );
    await page.mouse.click(20, 20);
    await page.waitForTimeout(500);
    await shot(page, "composer.png");
  });

  // 3. Published recap detail — reached by clicking the recap on the team page
  // (articles are exposed under a derived post id, so we click the real link).
  await beat("recap", async () => {
    await page.goto(`${BASE}/teams/${LEGACY_TEAM}`, { waitUntil: "domcontentloaded" });
    await waitLoaded(page);
    const postsTab = page.getByTestId("btn-toggle-posts");
    if (await postsTab.isVisible().catch(() => false)) {
      await postsTab.click();
      await page.waitForTimeout(1200);
    }
    const recapLink = page
      .getByText(/Middletown Cup/i)
      .first();
    await recapLink.scrollIntoViewIfNeeded();
    await recapLink.click();
    await page.waitForURL(/\/posts\//, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await shot(page, "recap.png");
  });

  // 4. Organization page — "Legacy test" Recent Posts showcase.
  await beat("org-page", async () => {
    await page.goto(`${BASE}/organizations/${LEGACY_ORG}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await dismissWelcome(page);
    await shot(page, "org-page.png");
  });

  // 5. Sam Carter's profile — the multi-sport storybook of recaps.
  await beat("profile", async () => {
    await page.goto(`${BASE}/users/${SAM_USER}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await shot(page, "profile.png");
  });

  // 6 + 7. Profile team filter dropdown open, then filtered to Legacy Black 2014.
  await beat("profile-filter", async () => {
    const filter = page.getByTestId("select-team-filter");
    if (await filter.isVisible().catch(() => false)) {
      await filter.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await filter.click();
      await page.waitForTimeout(700);
      await shot(page, "filter-open.png");

      const soccerOpt = page
        .getByRole("option")
        .filter({ hasText: /legacy black 2014/i })
        .first();
      if (await soccerOpt.isVisible().catch(() => false)) {
        await soccerOpt.click();
        await page.waitForTimeout(1200);
        await shot(page, "profile-filtered.png");
      }

      // Re-open the filter and switch to the basketball team so the video can
      // show the multi-sport story (soccer -> basketball -> all sports).
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
          await bballOpt.click();
          await page.waitForTimeout(1200);
          await shot(page, "profile-basketball.png");
        }
      }
    }
  });
});
