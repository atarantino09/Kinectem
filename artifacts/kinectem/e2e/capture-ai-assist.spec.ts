/**
 * Capture spec for Task #613 — AI Assist Walkthrough video.
 *
 * Captures REAL screenshots of the Kinectem app demonstrating the AI Assist
 * recap tool: the new-post composer, the AI Assist dialog (notes -> AI-drafted
 * suggestion), the filled composer, and the published recap on the Parsippany
 * Soccer Club "2014 boys Pre NPL" team.
 *
 * Prereq (run first): pnpm --filter @workspace/scripts run seed-ai-assist-demo
 *   (makes Marcus an accepted coach on the team + normalizes the recap copy).
 *
 * Run with:
 *   pnpm --filter @workspace/kinectem exec playwright test \
 *     e2e/capture-ai-assist.spec.ts --project=chromium --reporter=line
 *
 * Outputs are written to artifacts/ai-assist-walkthrough/public/shots/.
 * The app is served under the /app base path via the shared proxy.
 *
 * The POST /api/v1/ai/assist call is intercepted so the AI suggestion is
 * deterministic on camera (and so the capture never spends Anthropic credits).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, type Page } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "../../ai-assist-walkthrough/public/shots");
const PROGRESS = "/tmp/cap-ai-assist-progress.log";

function log(msg: string) {
  fs.appendFileSync(PROGRESS, `[${new Date().toISOString()}] ${msg}\n`);
}

const BASE = "/app";
const OWNER_EMAIL = "marcus@kinectem.demo";
const OWNER_PASSWORD = "demo1234";

// Seeded ids (verified via DB).
const PARSIPPANY_TEAM = "bbc1dba6-c337-4862-8b11-16fd10df0242"; // 2014 boys Pre NPL

// Rough notes a coach types in (deliberately unpolished).
const ROUGH_NOTES =
  "tournament win.  beat hi tempo 3-1 in the final of the gold bracket Legacy Summer Blast Off Tournament.  Great team effort to end the season.";

// The deterministic AI suggestion (kept in lockstep with seed-ai-assist-demo's
// POLISHED_BODY so the published recap matches the AI output shown earlier).
const POLISHED_BODY =
  "What a way to close out the season. The 2014 boys Pre NPL squad battled to a 3-1 victory over Hi Tempo in the Gold Bracket final of the Legacy Summer Blast Off Tournament. From the opening whistle it was a complete team effort — relentless pressure up top, composure at the back, and the kind of grit that turns a good season into a memorable one. Tournament champions, and a finish this group will remember for a long time.";

const TITLE = "Tournament Win — Beat Hi Tempo 3-1";

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

async function selectParsippanyTeam(page: Page) {
  const teamPicker = page.getByTestId("select-post-to-team");
  if (await teamPicker.isVisible().catch(() => false)) {
    await teamPicker.click();
    await page.waitForTimeout(500);
    const opt = page
      .locator('[data-testid^="option-post-to-team-"]')
      .filter({ hasText: /2014 boys pre npl/i })
      .first();
    if (await opt.isVisible().catch(() => false)) {
      await opt.click();
      await page.waitForTimeout(400);
    } else {
      await page.keyboard.press("Escape");
    }
  }
}

test.use({ viewport: { width: 1280, height: 800 } });

test("capture ai assist walkthrough screenshots", async ({ page }) => {
  test.setTimeout(150_000);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(PROGRESS, "");
  page.setDefaultNavigationTimeout(20000);
  page.setDefaultTimeout(15000);

  // Deterministic AI suggestion — never hits Anthropic.
  await page.route("**/api/v1/ai/assist", async (route) => {
    log("intercepted POST /ai/assist");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ text: POLISHED_BODY }),
    });
  });

  // Accept the unsaved-changes guard if it ever fires on navigation.
  page.on("dialog", (d) => d.accept().catch(() => {}));

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

  // 1. Published recap detail (the finished product) — captured first so we
  //    never navigate away from a dirty composer.
  await beat("recap-published", async () => {
    await page.goto(`${BASE}/teams/${PARSIPPANY_TEAM}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    await dismissWelcome(page);
    const postsTab = page.getByTestId("btn-toggle-posts");
    if (await postsTab.isVisible().catch(() => false)) {
      await postsTab.click();
      await page.waitForTimeout(1200);
    }
    const recapLink = page.getByText(/Beat Hi Tempo/i).first();
    await recapLink.scrollIntoViewIfNeeded();
    await recapLink.click();
    await page.waitForURL(/\/posts\//, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await shot(page, "recap-published.png");
  });

  // 2. Composer — empty body, AI Assist button visible.
  await beat("composer-empty", async () => {
    await page.goto(`${BASE}/posts/new`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    await selectParsippanyTeam(page);
    await page.getByTestId("input-title").fill(TITLE);
    const dateInput = page.getByTestId("input-game-date");
    if (await dateInput.isVisible().catch(() => false)) {
      await dateInput.fill("2026-06-21");
    }
    await page.mouse.click(20, 20);
    await page.waitForTimeout(500);
    await shot(page, "composer-empty.png");
  });

  // 3. AI Assist dialog — rough notes typed in.
  await beat("ai-dialog-notes", async () => {
    await page.getByTestId("button-ai-assist").click();
    await page.waitForTimeout(600);
    await page.getByTestId("textarea-ai-notes").fill(ROUGH_NOTES);
    await page.waitForTimeout(400);
    await shot(page, "ai-dialog-notes.png", false);
  });

  // 4. AI Assist dialog — AI-drafted suggestion shown (route-intercepted).
  await beat("ai-dialog-result", async () => {
    await page.getByTestId("button-ai-draft").click();
    await page.getByTestId("textarea-ai-result").waitFor({ state: "visible", timeout: 10000 });
    await page.waitForTimeout(600);
    await shot(page, "ai-dialog-result.png", false);
  });

  // 5. Composer — AI suggestion inserted into the body.
  await beat("composer-filled", async () => {
    await page.getByTestId("button-ai-insert").click();
    await page.waitForTimeout(800);
    await page.mouse.click(20, 20);
    await page.waitForTimeout(500);
    await shot(page, "composer-filled.png");
  });
});
