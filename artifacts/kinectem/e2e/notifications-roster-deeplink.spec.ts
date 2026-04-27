import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

// Covers the team-invite notification deep-link + roster row highlight
// flow that was previously verified by hand. Pinning it down with a
// standing test catches regressions like:
//   - The bell dropping the `?roster=1&entryId=…` URL params.
//   - TeamPage / TeamRosterTabs not switching the active tab to Roster.
//   - The roster row losing its `data-roster-entry-id` attribute or the
//     `ring-2` highlight treatment when scrolled into view.
//   - Unlinked notifications becoming clickable (or rendering with the
//     wrong testid).

const SAMIRA_EMAIL = "samira@kinectem.demo";
const SAMIRA_PASSWORD = "demo1234";

type Notification = {
  id: string;
  type: string;
  title: string;
  data: { link?: string } | null;
  isRead: boolean;
};

async function loginViaUi(page: Page) {
  await page.goto("/login");
  await page.getByTestId("input-signin-email").fill(SAMIRA_EMAIL);
  await page.getByTestId("input-signin-password").fill(SAMIRA_PASSWORD);
  await page.getByTestId("btn-signin").click();
  // After sign-in the SignInForm does a hard window.location.assign("/"),
  // so we wait for the post-login URL to settle on the home page.
  await page.waitForURL((url) => url.pathname === "/", { timeout: 15_000 });
}

async function listNotifications(api: APIRequestContext): Promise<Notification[]> {
  const res = await api.get("/api/v1/notifications");
  expect(res.ok(), `GET /notifications failed: ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { data: Notification[] };
  return body.data;
}

test.describe("Roster-invite notification deep link", () => {
  test("clicking the seeded invite lands on the Roster tab and briefly highlights the row", async ({ page }) => {
    await loginViaUi(page);
    // Reuse the page's request context so the session cookie set during
    // sign-in is sent on the API call below.
    const api = page.context().request;

    const notifs = await listNotifications(api);
    const linked = notifs.find(
      (n) => n.type === "roster_invite" && !!n.data?.link,
    );
    if (!linked || !linked.data?.link) {
      throw new Error(
        "Seeded roster_invite notification missing for Samira. Did seedIfEmpty / ensureSamiraDemoNotifications run?",
      );
    }
    const staticNotif = notifs.find(
      (n) =>
        !n.data?.link &&
        n.type !== "guardian_expired" &&
        n.type !== "roster_invite_for_child",
    );
    if (!staticNotif) {
      throw new Error(
        "Seeded static (unlinked) notification missing for Samira. Did ensureSamiraDemoNotifications run?",
      );
    }

    // Pull the entryId / teamId out of the seeded link so we can assert
    // them post-navigation. The link looks like
    //   "/teams/{teamId}?roster=1&entryId={entryId}".
    const link = linked.data.link;
    const linkUrl = new URL(link, "http://localhost");
    const entryId = linkUrl.searchParams.get("entryId");
    const teamIdMatch = linkUrl.pathname.match(/^\/teams\/([^/]+)$/);
    expect(entryId, "expected entryId in seeded link").toBeTruthy();
    expect(teamIdMatch, "expected /teams/{id} in seeded link").toBeTruthy();
    const teamId = teamIdMatch![1];

    // ---- Click the linked notification from the bell. ----
    await page.getByTestId("button-notifications").click();
    const linkedRow = page.getByTestId(`notification-${linked.id}`);
    await expect(linkedRow).toBeVisible();
    // The clickable wrapper inside the row is rendered as a real <button>
    // by NotificationsBell. For type=`roster_invite` (not the parent-
    // facing `roster_invite_for_child`) there's only the one wrapper
    // button in the row, so .first() is unambiguous.
    await linkedRow.locator("button").first().click();

    // URL contains both query params from the seeded link.
    await page.waitForURL(
      (url) =>
        url.pathname === `/teams/${teamId}` &&
        url.searchParams.get("roster") === "1" &&
        url.searchParams.get("entryId") === entryId,
      { timeout: 10_000 },
    );

    // The bell dropdown isn't auto-dismissed (the inner notification button
    // doesn't go through Radix's onSelect path), so close it explicitly
    // before asserting on the page underneath. Without this the open
    // dropdown sits over the team page and traps clicks / focus.
    await page.keyboard.press("Escape");
    await expect(
      page.getByTestId("button-notifications"),
    ).toHaveAttribute("aria-expanded", "false");

    // Roster is the active tab. Use a compound role+data-state selector
    // (rather than getByRole name match) so we read the state directly
    // off the Radix TabsTrigger that's currently selected.
    const activeRosterTab = page
      .locator('[role="tab"][data-state="active"]')
      .filter({ hasText: /^Roster$/ });
    await expect(activeRosterTab).toBeVisible();

    // The matching roster row briefly carries the `ring-2` class that
    // TeamRosterTabs adds (and removes 2.4s later) when a deep link
    // identifies the row to highlight. toHaveClass polls for a few
    // seconds, easily catching the highlight window.
    const row = page.locator(`[data-roster-entry-id="${entryId}"]`);
    await expect(row).toBeVisible();
    await expect(row).toHaveClass(/ring-2/);

    // ---- Static (unlinked) notification ----
    // Re-open the bell — the dropdown was dismissed above.
    await page.getByTestId("button-notifications").click();
    const staticEl = page.getByTestId(`notification-static-${staticNotif.id}`);
    await expect(staticEl).toBeVisible();
    const beforeUrl = page.url();
    await staticEl.click();
    // Give any (unwanted) navigation a chance to fire before asserting
    // the URL stayed put.
    await page.waitForTimeout(500);
    expect(page.url()).toBe(beforeUrl);
  });
});
