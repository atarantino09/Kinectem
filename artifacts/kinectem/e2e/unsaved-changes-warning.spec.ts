import {
  test,
  expect,
  type APIRequestContext,
  type Page,
  request as pwRequest,
} from "@playwright/test";

// Task #468 — Regression coverage for the new-post composer's
// unsaved-changes guard (task #466). The guard fires a confirm()
// prompt whenever the form is dirty and the user tries to leave
// via:
//   - the header Cancel button (calls `requestCancel`),
//   - the in-editor "Posted in" team / org links (caught by the
//     global capture-phase click guard on dirty),
//   - any other in-app `<a>` (also caught by the click guard).
// And it must NOT fire after a successful submit / save / delete,
// or when the composer was never touched. This spec opens the
// editor on both a draft and an already-published recap so the
// guard's two main branches (draft auto-save path and published
// PATCH path) both get exercised.

const COACH_EMAIL = "coach@kinectem.demo";
const PASSWORD = "demo1234";

type LoginResponse = { id: string };
type TeamRow = {
  teamId: string;
  teamName: string;
  organization: { id: string; name: string };
};
type PaginatedTeams = { data: TeamRow[] };
type PostResponse = { id: string };

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

async function findAuthorableTeamForUser(
  api: APIRequestContext,
  userId: string,
): Promise<TeamRow> {
  const res = await api.get(
    `/api/v1/users/${userId}/teams?authorable=true`,
  );
  expect(
    res.ok(),
    `GET /users/${userId}/teams?authorable=true failed: ${res.status()}`,
  ).toBeTruthy();
  const body = (await res.json()) as PaginatedTeams;
  const candidate = body.data[0];
  if (!candidate) {
    throw new Error(
      `Coach user ${userId} has no authorable teams — seed data may be missing.`,
    );
  }
  return candidate;
}

async function createDraft(
  api: APIRequestContext,
  teamId: string,
  title: string,
): Promise<string> {
  const res = await api.post("/api/v1/posts", {
    data: {
      postType: "long",
      title,
      body: "Draft body for unsaved-changes regression test.",
      status: "draft",
      context: { type: "team", id: teamId },
    },
  });
  expect(res.ok(), `create draft failed: ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as PostResponse;
  return body.id;
}

async function createPublishedRecap(
  api: APIRequestContext,
  teamId: string,
  title: string,
): Promise<string> {
  const res = await api.post("/api/v1/posts", {
    data: {
      postType: "long",
      title,
      body: "Published recap for unsaved-changes regression test.",
      context: { type: "team", id: teamId },
    },
  });
  expect(res.ok(), `create published recap failed: ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as PostResponse;
  return body.id;
}

async function deletePostBestEffort(
  api: APIRequestContext,
  postId: string,
): Promise<void> {
  try {
    const res = await api.delete(`/api/v1/posts/${postId}`);
    if (res.status() !== 204 && res.status() !== 404 && res.status() !== 200) {
      // eslint-disable-next-line no-console
      console.warn(
        `cleanup: unexpected DELETE /posts/${postId} status ${res.status()}`,
      );
    }
  } catch {
    // best-effort
  }
}

// Capture every confirm() / beforeunload dialog that fires while
// `action` runs, then return their messages. `decision` controls how
// each dialog is resolved — "dismiss" keeps the user on the page
// (the prompt cancelled the navigation), "accept" lets it proceed.
async function collectDialogs(
  page: Page,
  action: () => Promise<void>,
  decision: "dismiss" | "accept" = "dismiss",
): Promise<string[]> {
  const messages: string[] = [];
  const handler = async (d: import("@playwright/test").Dialog) => {
    messages.push(d.message());
    if (decision === "accept") {
      await d.accept();
    } else {
      await d.dismiss();
    }
  };
  page.on("dialog", handler);
  try {
    await action();
    // Give the dialog event loop a moment to flush before we tear
    // the listener down — confirm() is synchronous in the page but
    // the Playwright event hop is async.
    await page.waitForTimeout(400);
  } finally {
    page.off("dialog", handler);
  }
  return messages;
}

test.describe("New-post composer — unsaved-changes guard (task #468)", () => {
  let coachApi: APIRequestContext | undefined;
  let team: TeamRow;
  const createdPostIds: string[] = [];

  test.beforeAll(async ({}, testInfo) => {
    const baseURL = resolveBaseURL(testInfo.project.use.baseURL);
    coachApi = await pwRequest.newContext({ baseURL });
    const userId = await loginViaApi(coachApi, COACH_EMAIL, PASSWORD);
    team = await findAuthorableTeamForUser(coachApi, userId);
  });

  test.afterAll(async () => {
    if (coachApi) {
      for (const id of createdPostIds) {
        await deletePostBestEffort(coachApi, id);
      }
      await coachApi.dispose();
    }
  });

  test("untouched composer never prompts on Cancel", async ({ page }) => {
    await loginViaUi(page, COACH_EMAIL);
    await page.goto("/posts/new?type=long");
    await expect(page.getByTestId("input-title")).toBeVisible();

    const dialogs = await collectDialogs(page, async () => {
      await page.getByTestId("button-cancel-post-editor").click();
      // Cancel on a brand-new composer just navigates home (no draft
      // to compare against), so wait for the URL to settle.
      await page.waitForURL((url) => url.pathname === "/", {
        timeout: 10_000,
      });
    });
    expect(dialogs).toEqual([]);
  });

  test("dirty draft prompts on header Cancel and stays when dismissed", async ({
    page,
  }) => {
    if (!coachApi) throw new Error("coachApi not initialized");
    const draftId = await createDraft(
      coachApi,
      team.teamId,
      `Unsaved-changes draft cancel ${Date.now()}`,
    );
    createdPostIds.push(draftId);

    await loginViaUi(page, COACH_EMAIL);
    await page.goto(`/posts/new?draftId=${draftId}`);
    // Wait for the loaded title so the dirty-tracking baseline is
    // initialized from the server payload, not the empty-form default.
    await expect(page.getByTestId("input-title")).not.toHaveValue("");

    // Type into the title to flip isDirty=true.
    await page.getByTestId("input-title").fill("Edited title — should prompt");

    const dismissed = await collectDialogs(page, async () => {
      await page.getByTestId("button-cancel-post-editor").click();
    });
    expect(dismissed.length).toBe(1);
    expect(dismissed[0]).toContain("unsaved changes");
    // We dismissed → still on the editor.
    await expect(page).toHaveURL(/\/posts\/new\?draftId=/);
    await expect(page.getByTestId("input-title")).toBeVisible();

    // Accepting the prompt the second time should let the navigation
    // through (back to home).
    const accepted = await collectDialogs(
      page,
      async () => {
        await page.getByTestId("button-cancel-post-editor").click();
        await page.waitForURL((url) => url.pathname === "/", {
          timeout: 10_000,
        });
      },
      "accept",
    );
    expect(accepted.length).toBeGreaterThanOrEqual(1);
    expect(accepted[0]).toContain("unsaved changes");
  });

  test("dirty draft prompts when clicking an in-app link", async ({ page }) => {
    if (!coachApi) throw new Error("coachApi not initialized");
    const draftId = await createDraft(
      coachApi,
      team.teamId,
      `Unsaved-changes draft inapp-link ${Date.now()}`,
    );
    createdPostIds.push(draftId);

    await loginViaUi(page, COACH_EMAIL);
    await page.goto(`/posts/new?draftId=${draftId}`);
    await expect(page.getByTestId("input-title")).not.toHaveValue("");

    await page.getByTestId("input-body").fill("dirty body keystroke");

    // Inject a synthetic in-app `<a>` so the global capture-phase
    // click guard has a target to intercept. The composer route
    // (/posts/new) is rendered without the main app Layout so no
    // header nav is on screen — the guard still has to fire on any
    // same-origin anchor inserted into the editor surface.
    await page.evaluate(() => {
      const link = document.createElement("a");
      link.href = "/";
      link.textContent = "in-app link probe";
      link.id = "e2e-inapp-link";
      document.body.appendChild(link);
    });

    const dialogs = await collectDialogs(page, async () => {
      await page.locator("#e2e-inapp-link").click();
    });
    expect(dialogs.length).toBe(1);
    expect(dialogs[0]).toContain("unsaved changes");
    // Dismissed → still on the editor.
    await expect(page).toHaveURL(/\/posts\/new\?draftId=/);
  });

  test("editing a published recap prompts on the Posted-in team link", async ({
    page,
  }) => {
    if (!coachApi) throw new Error("coachApi not initialized");
    const postId = await createPublishedRecap(
      coachApi,
      team.teamId,
      `Unsaved-changes published posted-in ${Date.now()}`,
    );
    createdPostIds.push(postId);

    await loginViaUi(page, COACH_EMAIL);
    await page.goto(`/posts/new?editId=${postId}`);
    await expect(page.getByTestId("input-title")).not.toHaveValue("");
    await expect(
      page.getByTestId("section-edit-post-posted-in"),
    ).toBeVisible();

    await page.getByTestId("input-body").fill("body edit on a published recap");

    const dialogs = await collectDialogs(page, async () => {
      await page.getByTestId("link-edit-post-team").click();
    });
    expect(dialogs.length).toBe(1);
    expect(dialogs[0]).toContain("unsaved changes");
    // Dismissed → still on the editor URL.
    await expect(page).toHaveURL(/\/posts\/new\?editId=/);
  });

  test("editing a published recap prompts on the header Cancel button", async ({
    page,
  }) => {
    if (!coachApi) throw new Error("coachApi not initialized");
    const postId = await createPublishedRecap(
      coachApi,
      team.teamId,
      `Unsaved-changes published cancel ${Date.now()}`,
    );
    createdPostIds.push(postId);

    await loginViaUi(page, COACH_EMAIL);
    await page.goto(`/posts/new?editId=${postId}`);
    await expect(page.getByTestId("input-title")).not.toHaveValue("");

    await page.getByTestId("input-title").fill("Edited published title");

    const dialogs = await collectDialogs(page, async () => {
      await page.getByTestId("button-cancel-post-editor").click();
    });
    expect(dialogs.length).toBe(1);
    expect(dialogs[0]).toContain("unsaved changes");
    await expect(page).toHaveURL(/\/posts\/new\?editId=/);
  });

  test("publishing a draft navigates without prompting", async ({ page }) => {
    if (!coachApi) throw new Error("coachApi not initialized");
    const draftId = await createDraft(
      coachApi,
      team.teamId,
      `Unsaved-changes draft publish ${Date.now()}`,
    );
    createdPostIds.push(draftId);

    await loginViaUi(page, COACH_EMAIL);
    await page.goto(`/posts/new?draftId=${draftId}`);
    await expect(page.getByTestId("input-title")).not.toHaveValue("");

    // Type something so the form is dirty when we hit Publish — this
    // is the case the guard most needs to skip cleanly.
    await page.getByTestId("input-body").fill("Final body before publish");

    const publishResponse = page.waitForResponse(
      (resp) =>
        resp.url().includes(`/api/v1/posts/${draftId}/publish`) &&
        resp.request().method() === "POST",
      { timeout: 15_000 },
    );

    const dialogs = await collectDialogs(page, async () => {
      await page.getByTestId("button-publish").click();
      await publishResponse;
      // Coach is an org admin on the seeded team, so the recap
      // publishes immediately and the composer redirects to the
      // post page (no pending-approval dialog).
      await page.waitForURL(
        (url) =>
          url.pathname.startsWith("/posts/") && !url.pathname.endsWith("/new"),
        { timeout: 15_000 },
      );
    });
    expect(dialogs).toEqual([]);
  });

  test("saving an edit on a published recap navigates without prompting", async ({
    page,
  }) => {
    if (!coachApi) throw new Error("coachApi not initialized");
    const postId = await createPublishedRecap(
      coachApi,
      team.teamId,
      `Unsaved-changes published save ${Date.now()}`,
    );
    createdPostIds.push(postId);

    await loginViaUi(page, COACH_EMAIL);
    await page.goto(`/posts/new?editId=${postId}`);
    await expect(page.getByTestId("input-title")).not.toHaveValue("");

    await page.getByTestId("input-body").fill("Edited body to save");

    const patchResponse = page.waitForResponse(
      (resp) =>
        resp.url().includes(`/api/v1/posts/${postId}`) &&
        resp.request().method() === "PATCH",
      { timeout: 15_000 },
    );

    const dialogs = await collectDialogs(page, async () => {
      await page.getByTestId("button-publish").click();
      await patchResponse;
      // Default landing on save is /posts/:postId.
      await page.waitForURL(
        (url) =>
          url.pathname === `/posts/${postId}` ||
          url.pathname.startsWith("/teams/"),
        { timeout: 15_000 },
      );
    });
    expect(dialogs).toEqual([]);
  });

  test("deleting from the editor navigates without prompting", async ({
    page,
  }) => {
    if (!coachApi) throw new Error("coachApi not initialized");
    const postId = await createPublishedRecap(
      coachApi,
      team.teamId,
      `Unsaved-changes published delete ${Date.now()}`,
    );
    createdPostIds.push(postId);

    await loginViaUi(page, COACH_EMAIL);
    await page.goto(`/posts/new?editId=${postId}`);
    await expect(page.getByTestId("input-title")).not.toHaveValue("");

    // Make the form dirty before deleting so the only thing keeping
    // the redirect prompt-free is the onDelete handler resetting the
    // dirty baseline before navigating.
    await page.getByTestId("input-body").fill("dirty body before delete");

    const deleteButton = page.getByTestId("button-delete-post-editor");
    await expect(deleteButton).toBeVisible();
    await deleteButton.click();

    const confirmButton = page.getByTestId("button-delete-post-editor-confirm");
    await expect(confirmButton).toBeVisible();

    const deleteResponse = page.waitForResponse(
      (resp) =>
        resp.url().includes(`/api/v1/posts/${postId}`) &&
        resp.request().method() === "DELETE",
      { timeout: 15_000 },
    );

    const dialogs = await collectDialogs(page, async () => {
      await confirmButton.click();
      await deleteResponse;
      await page.waitForURL(
        (url) => url.pathname !== "/posts/new",
        { timeout: 15_000 },
      );
    });
    expect(dialogs).toEqual([]);
  });
});
