import {
  test,
  expect,
  type APIRequestContext,
  type Page,
  type Locator,
  request as pwRequest,
} from "@playwright/test";

// Task #381 — The "Post to Team" picker label was swapped to render
// `<team> — <org>` strings, which can run much longer than the old
// org-only label. This spec opens the recap composer at narrow
// viewport widths and confirms the Select trigger and the option
// labels render cleanly: the trigger doesn't overflow its containing
// card, and option labels are visible (not clipped to zero width)
// inside the dropdown.

const COACH_EMAIL = "coach@kinectem.demo";
const PASSWORD = "demo1234";

type LoginResponse = { id: string };
type TeamRow = {
  teamId: string;
  teamName: string;
  organization: { id: string; name: string };
};
type PaginatedTeams = { data: TeamRow[] };

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
  await page.waitForURL((url) => url.pathname === "/", { timeout: 15_000 });
}

async function findAuthorableTeamsForUser(
  api: APIRequestContext,
  userId: string,
): Promise<TeamRow[]> {
  const res = await api.get(
    `/api/v1/users/${userId}/teams?authorable=true`,
  );
  expect(
    res.ok(),
    `GET /users/${userId}/teams?authorable=true failed: ${res.status()}`,
  ).toBeTruthy();
  const body = (await res.json()) as PaginatedTeams;
  if (body.data.length === 0) {
    throw new Error(
      `Coach user ${userId} has no authorable teams — seed data may be missing.`,
    );
  }
  return body.data;
}

// Returns true when `child` is horizontally contained within `parent`'s
// content box (small 1px tolerance for sub-pixel rounding). Used to
// confirm the Select trigger doesn't overflow the form card at narrow
// viewports.
async function isHorizontallyContained(
  child: Locator,
  parent: Locator,
): Promise<boolean> {
  const childBox = await child.boundingBox();
  const parentBox = await parent.boundingBox();
  if (!childBox || !parentBox) return false;
  return (
    childBox.x >= parentBox.x - 1 &&
    childBox.x + childBox.width <= parentBox.x + parentBox.width + 1
  );
}

const VIEWPORTS = [
  { name: "mobile (390x844)", width: 390, height: 844 },
  { name: "tablet (768x1024)", width: 768, height: 1024 },
] as const;

test.describe("Post to Team picker — viewport rendering (task #381)", () => {
  let coachApi: APIRequestContext | undefined;
  let teams: TeamRow[];

  test.beforeAll(async ({}, testInfo) => {
    const baseURL = resolveBaseURL(testInfo.project.use.baseURL);
    coachApi = await pwRequest.newContext({ baseURL });
    const userId = await loginViaApi(coachApi, COACH_EMAIL, PASSWORD);
    teams = await findAuthorableTeamsForUser(coachApi, userId);
  });

  test.afterAll(async () => {
    if (coachApi) await coachApi.dispose();
  });

  for (const vp of VIEWPORTS) {
    test(`trigger and option labels render cleanly at ${vp.name}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await loginViaUi(page, COACH_EMAIL);
      await page.goto(`/posts/new?type=long`);

      const trigger = page.getByTestId("select-post-to-team");
      await expect(trigger).toBeVisible();

      const form = page.locator("#new-post-form");
      await expect(form).toBeVisible();

      // Pre-selection sanity: the placeholder trigger should fit
      // inside the form card. Cheap baseline before we exercise the
      // long-label scenario.
      expect(
        await isHorizontallyContained(trigger, form),
        `Select trigger (placeholder) overflows the form card at ${vp.name}`,
      ).toBe(true);

      // Open the dropdown and assert each option label is visible
      // and has non-zero width (i.e. the long `<team> — <org>` text
      // isn't clipped to nothing inside the popover).
      await trigger.click();
      for (const team of teams) {
        const option = page.getByTestId(`option-post-to-team-${team.teamId}`);
        await expect(option).toBeVisible();
        const optionBox = await option.boundingBox();
        expect(
          optionBox,
          `option for ${team.teamName} should have a layout box`,
        ).not.toBeNull();
        expect(optionBox!.width).toBeGreaterThan(0);
        expect(optionBox!.height).toBeGreaterThan(0);
        await expect(option).toContainText(team.teamName);
        await expect(option).toContainText(team.organization.name);
      }

      // Pick the team with the longest combined `<team> — <org>`
      // label so we exercise the worst-case width on the trigger,
      // which is the actual regression risk this task guards against.
      const widestTeam = teams.reduce((a, b) =>
        a.teamName.length + a.organization.name.length >=
        b.teamName.length + b.organization.name.length
          ? a
          : b,
      );
      await page
        .getByTestId(`option-post-to-team-${widestTeam.teamId}`)
        .click();

      // After selection the trigger renders the long combined label.
      // Confirm both halves landed and the trigger STILL stays inside
      // the form card horizontally — this is the core assertion the
      // task is asking for.
      await expect(trigger).toContainText(widestTeam.teamName);
      await expect(trigger).toContainText(widestTeam.organization.name);

      const triggerBox = await trigger.boundingBox();
      expect(triggerBox, "trigger should have a layout box").not.toBeNull();
      expect(triggerBox!.width).toBeGreaterThan(0);
      expect(triggerBox!.height).toBeGreaterThan(0);
      expect(
        await isHorizontallyContained(trigger, form),
        `Select trigger with selected long label overflows the form card at ${vp.name}`,
      ).toBe(true);

      // The trigger's own content also shouldn't horizontally
      // scroll/overflow its own box (catches a label that fits the
      // card but visually clips inside the trigger). Compares
      // scrollWidth against clientWidth on the trigger element.
      const trigEl = await trigger.elementHandle();
      expect(trigEl).not.toBeNull();
      const overflow = await trigEl!.evaluate((el) => ({
        scrollWidth: (el as HTMLElement).scrollWidth,
        clientWidth: (el as HTMLElement).clientWidth,
      }));
      expect(
        overflow.scrollWidth,
        `Selected label overflows inside the trigger at ${vp.name} (scroll=${overflow.scrollWidth}, client=${overflow.clientWidth})`,
      ).toBeLessThanOrEqual(overflow.clientWidth + 1);
    });
  }
});
