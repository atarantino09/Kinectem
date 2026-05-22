import { chromium, Page } from 'playwright';
import { mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WORKSPACE_ROOT = resolve(__dirname, '..', '..');

const BASE = process.env.BASE_URL ?? 'http://localhost:80';
const VIEWPORT = { width: 1280, height: 720 };
const OUT_DIR = resolve(WORKSPACE_ROOT, 'artifacts/signup-walkthrough/recording');

const stamp = Date.now();
const EMAIL = `demo+${stamp}@kinectem.test`;
const PASSWORD = 'Demo1234!';
const FIRST = 'Taylor';
const LAST = 'Rivera';
const ORG_NAME = `Riverside Soccer Club ${stamp.toString().slice(-4)}`;
const ORG_CITY = 'Riverside';
const ORG_STATE = 'NJ';
const ORG_ZIP = '08075';
const TEAM_NAME = 'Riverside Lions U12';
const COACH_EMAIL = `coach+${stamp}@example.com`;
const PLAYER_NAME = 'Jordan Smith';
const GUARDIAN_EMAIL = `parent+${stamp}@example.com`;
const RECAP_TITLE = 'Lions roar back in second half';
const RECAP_BODY =
  'Down 0–2 at half, the Lions stormed back with four unanswered goals. Standout shift from the midfield. Final: Lions 4 — Wolves 2.';

interface Marker {
  key: string;
  ms: number;
}

const markers: Marker[] = [];
let t0 = 0;
function mark(key: string) {
  const ms = Date.now() - t0;
  markers.push({ key, ms });
  console.log(`[mark] ${key} @ ${ms}ms`);
}

const CURSOR_SCRIPT = `
(() => {
  if (document.getElementById('__pw_cursor')) return;
  const c = document.createElement('div');
  c.id = '__pw_cursor';
  c.style.cssText = [
    'position:fixed','top:50%','left:50%','width:22px','height:22px',
    'background:rgba(37,99,235,0.9)','border:3px solid white','border-radius:50%',
    'box-shadow:0 4px 16px rgba(37,99,235,0.55), 0 0 0 1px rgba(0,0,0,0.1)',
    'z-index:2147483647','pointer-events:none',
    'transform:translate(-50%,-50%)','transition:transform 60ms linear, background 120ms ease',
  ].join(';');
  const place = () => { document.documentElement.appendChild(c); };
  if (document.documentElement) place();
  else window.addEventListener('DOMContentLoaded', place, { once: true });
  const onMove = (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; };
  const onDown = () => { c.style.background = 'rgba(124,58,237,0.95)'; c.style.transform = 'translate(-50%,-50%) scale(0.78)'; };
  const onUp = () => { c.style.background = 'rgba(37,99,235,0.9)'; c.style.transform = 'translate(-50%,-50%) scale(1)'; };
  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('mousedown', onDown, true);
  window.addEventListener('mouseup', onUp, true);
})();
`;

async function humanMove(page: Page, x: number, y: number, steps = 18) {
  await page.mouse.move(x, y, { steps });
}

async function moveToSelector(page: Page, selector: string) {
  const el = await page.waitForSelector(selector, { state: 'visible', timeout: 15000 });
  const box = await el.boundingBox();
  if (!box) return;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await humanMove(page, x, y);
  return el;
}

async function clickSel(page: Page, selector: string, opts: { pause?: number } = {}) {
  await moveToSelector(page, selector);
  await page.waitForTimeout(80);
  await page.click(selector);
  await page.waitForTimeout(opts.pause ?? 200);
}

async function typeInto(page: Page, selector: string, text: string, delay = 12) {
  const el = await moveToSelector(page, selector);
  if (!el) throw new Error(`No element: ${selector}`);
  await page.click(selector);
  await page.waitForTimeout(60);
  await el.fill('');
  await page.type(selector, text, { delay });
}

async function waitVisible(page: Page, selector: string, timeout = 15000) {
  await page.waitForSelector(selector, { state: 'visible', timeout });
}

async function chooseSelect(page: Page, triggerSel: string, optionText: string | RegExp) {
  // Works for native <select> AND Radix combobox triggers.
  const tagName = await page
    .locator(triggerSel)
    .evaluate((el) => el.tagName.toLowerCase())
    .catch(() => '');
  if (tagName === 'select') {
    if (typeof optionText === 'string') {
      await page.selectOption(triggerSel, { label: optionText }).catch(async () => {
        await page.selectOption(triggerSel, optionText);
      });
    } else {
      // Regex unsupported on native select — fall through to first matching option text
      const value = await page
        .locator(`${triggerSel} option`)
        .filter({ hasText: optionText })
        .first()
        .getAttribute('value');
      if (value != null) await page.selectOption(triggerSel, value);
    }
    return;
  }
  await clickSel(page, triggerSel, { pause: 200 });
  // Radix renders options in a portal with role="option"
  const option = page.getByRole('option', { name: optionText, exact: false }).first();
  await option.waitFor({ state: 'visible', timeout: 5000 });
  await option.click();
  await page.waitForTimeout(200);
}

async function main() {
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
  });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    recordVideo: { dir: OUT_DIR, size: VIEWPORT },
    colorScheme: 'light',
  });
  await context.addInitScript(CURSOR_SCRIPT);
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error('[page-err]', msg.text());
  });

  t0 = Date.now();

  // SCENE 1: Marketing landing
  mark('marketing');
  await page.goto(`${BASE}/marketing/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
  await humanMove(page, 640, 360);
  await page.waitForTimeout(900);
  await page.mouse.wheel(0, 240);
  await page.waitForTimeout(500);
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(200);

  // SCENE 2: Signup
  mark('signup');
  await page.goto(`${BASE}/login?signup=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);

  // Age gate
  await waitVisible(page, '[data-testid="signup-dob-month"]');
  await chooseSelect(page, '[data-testid="signup-dob-month"]', 'June');
  await chooseSelect(page, '[data-testid="signup-dob-day"]', '15');
  await chooseSelect(page, '[data-testid="signup-dob-year"]', '1992');
  await page.waitForTimeout(250);
  await clickSel(page, '[data-testid="btn-age-continue"]', { pause: 600 });

  // Details
  await waitVisible(page, '[data-testid="input-signup-first"]');
  await typeInto(page, '[data-testid="input-signup-first"]', FIRST, 30);
  await typeInto(page, '[data-testid="input-signup-last"]', LAST, 30);
  await chooseSelect(page, '[data-testid="select-signup-role"]', /admin/i);
  await page.waitForTimeout(150);
  await typeInto(page, '[data-testid="input-signup-email"]', EMAIL, 18);
  await typeInto(page, '[data-testid="input-signup-password"]', PASSWORD, 30);
  await page.waitForTimeout(300);
  await clickSel(page, '[data-testid="btn-create-account"]', { pause: 1000 });

  // SCENE 3: Create org + dashboard
  mark('orgCreate');
  // Open the Create dropdown in the top nav, then choose "Create organization"
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(600);
  const createBtn = page.getByRole('button', { name: /^create$/i }).first();
  await createBtn.scrollIntoViewIfNeeded().catch(() => {});
  await createBtn.click();
  await page.waitForTimeout(300);
  await page.click('[data-testid="menu-create-org"]');
  await page.waitForTimeout(700);
  await waitVisible(page, '[data-testid="input-org-name"]');
  await typeInto(page, '[data-testid="input-org-name"]', ORG_NAME, 20);
  await typeInto(page, '[data-testid="input-org-city"]', ORG_CITY, 30);
  await chooseSelect(page, '[data-testid="input-org-state"]', /new jersey|^nj$/i).catch(
    () => {},
  );
  await typeInto(page, '[data-testid="input-org-zip"]', ORG_ZIP, 25);
  await page.waitForTimeout(300);
  await clickSel(page, '[data-testid="btn-create-org"]', { pause: 1800 });

  // Dashboard / welcome dialog
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1400);

  // SCENE 4: Team create + invites
  mark('teamCreate');
  // The post-create welcome dialog has a "Create your first team" button.
  // If that's not visible (already dismissed), fall back to the rail's
  // Add team affordance via setup checklist action.
  const welcomeBtn = page.locator('[data-testid="btn-welcome-org-create-team"]').first();
  const usedWelcome = await welcomeBtn
    .waitFor({ state: 'visible', timeout: 6000 })
    .then(() => welcomeBtn.click().then(() => true))
    .catch(() => false);
  if (!usedWelcome) {
    const teamAction = page.locator('[data-testid="btn-org-setup-action-hasTeam"]').first();
    await teamAction.scrollIntoViewIfNeeded().catch(() => {});
    await teamAction.click({ timeout: 6000 }).catch(() => {});
  }
  await page.waitForTimeout(800);
  await waitVisible(page, '[data-testid="input-team-name"]');
  await typeInto(page, '[data-testid="input-team-name"]', TEAM_NAME, 25);
  await chooseSelect(page, '[data-testid="select-team-sport"]', /soccer/i).catch(() => {});
  await chooseSelect(page, '[data-testid="select-team-gender"]', /coed|mixed/i).catch(
    () => {},
  );
  await page.waitForTimeout(300);
  await clickSel(page, '[data-testid="btn-create-team"]', { pause: 2000 });

  // Team page + invite dialog (opens via roster=1 query)
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1200);

  // Invite a coach
  const openedInvite = await page
    .click('[data-testid="btn-rail-invite-roster"]', { timeout: 3500 })
    .then(() => true)
    .catch(() => false);
  if (openedInvite) {
    await page.waitForTimeout(700);
    await chooseSelect(page, '[data-testid="select-invite-position"]', /coach/i).catch(
      () => {},
    );
    await typeInto(page, '[data-testid="input-invite-email"]', COACH_EMAIL, 18);
    await page.waitForTimeout(300);
    await clickSel(page, '[data-testid="btn-send-invite"]', { pause: 1200 });
    // Reopen to invite a player+guardian
    await page
      .click('[data-testid="btn-rail-invite-roster"]', { timeout: 3500 })
      .catch(() => {});
    await page.waitForTimeout(700);
    await chooseSelect(page, '[data-testid="select-invite-position"]', /^player$/i).catch(
      () => {},
    );
    await page
      .fill('[data-testid="input-invite-name"]', '')
      .catch(() => {});
    await typeInto(page, '[data-testid="input-invite-name"]', PLAYER_NAME, 22).catch(
      () => {},
    );
    await typeInto(page, '[data-testid="input-invite-email"]', GUARDIAN_EMAIL, 18);
    await page.waitForTimeout(300);
    await clickSel(page, '[data-testid="btn-send-invite"]', { pause: 1500 });
  }

  // SCENE 5: Write & publish recap
  mark('recap');
  // Read teamId from URL
  const url = page.url();
  const teamMatch = url.match(/teams\/([^/?#]+)/);
  const teamId = teamMatch ? teamMatch[1] : '';
  if (teamId) {
    await page.goto(`${BASE}/posts/new?type=long&teamId=${teamId}`, {
      waitUntil: 'domcontentloaded',
    });
  } else {
    await page.goto(`${BASE}/posts/new?type=long`, { waitUntil: 'domcontentloaded' });
  }
  await page.waitForTimeout(900);
  await waitVisible(page, '[data-testid="input-title"]');
  await typeInto(page, '[data-testid="input-title"]', RECAP_TITLE, 22);
  await page.waitForTimeout(200);
  await typeInto(page, '[data-testid="input-body"]', RECAP_BODY, 14);
  await page.waitForTimeout(500);
  // Scroll to publish button if needed
  const pubBtn = await page
    .waitForSelector('[data-testid="button-publish-bottom"]', { timeout: 6000 })
    .catch(() => null);
  if (pubBtn) {
    await pubBtn.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
  }
  await clickSel(page, '[data-testid="button-publish-bottom"]', { pause: 2400 });

  // Post-publish: land on team page and dwell on the pinned recap
  if (teamId) {
    await page.goto(`${BASE}/teams/${teamId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(1200);
  } else {
    await page.waitForTimeout(2200);
  }

  // Closing dwell so the final scene lingers
  mark('end');
  await page.waitForTimeout(800);

  const videoHandle = page.video();
  await context.close();
  await browser.close();

  let videoPath: string | null = null;
  if (videoHandle) {
    videoPath = await videoHandle.path();
  }
  const finalRaw = join(OUT_DIR, 'raw.webm');
  if (videoPath) {
    await rename(videoPath, finalRaw);
  }

  await writeFile(
    join(OUT_DIR, 'markers.json'),
    JSON.stringify({ markers, totalMs: markers[markers.length - 1]?.ms ?? 0 }, null, 2),
  );

  console.log('Raw video:', finalRaw);
  console.log('Markers:', markers);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
