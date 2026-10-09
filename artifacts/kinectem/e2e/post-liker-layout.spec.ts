import { test, expect, type Page } from "@playwright/test";

async function mountRenderers(page: Page) {
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const body = url.pathname.endsWith("/users/me")
      ? { id: "viewer", firstName: "Test", lastName: "Viewer", avatarUrl: null }
      : { data: [] };
    await route.fulfill({ json: body });
  });
  await page.route(/\/app\/(?:__liker-layout|posts\/article-layout)(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/app/@vite/client"></script><script type="module">import RefreshRuntime from "/app/@react-refresh"; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => (type) => type; window.__vite_plugin_react_preamble_installed__ = true;</script><script type="module" src="/app/e2e/fixtures/post-liker-layout.tsx"></script></body></html>',
    });
  });
}

for (const width of [320, 768, 1440]) {
  test(`summaries stay below all actions at ${width}px, including wrapped rows`, async ({ page }) => {
    await mountRenderers(page);
    await page.setViewportSize({ width, height: 1000 });
    for (const name of ["Alex Supporter", "LongUnbrokenLikerName".repeat(30)]) {
      await page.goto(`/app/__liker-layout?name=${encodeURIComponent(name)}`);
      for (const detail of [false, true]) {
        const actions = page.getByTestId(detail ? "post-detail-actions" : "post-actions-article-layout");
        const summary = page.getByTestId(detail ? "post-detail-liker-summary" : "post-liker-summary-article-layout");
        await expect(summary).toBeVisible();
        const row = await actions.boundingBox();
        const text = await summary.boundingBox();
        expect(text!.y).toBeGreaterThanOrEqual(row!.y + row!.height);
        expect(text!.x).toBeCloseTo(row!.x, 1);
        expect(text!.x + text!.width).toBeLessThanOrEqual(width);
        const buttons = await actions.locator("button").evaluateAll((nodes) =>
          nodes.map((node) => ({ top: node.getBoundingClientRect().top, bottom: node.getBoundingClientRect().bottom })),
        );
        expect(text!.y).toBeGreaterThanOrEqual(Math.max(...buttons.map((b) => b.bottom)));
        if (!detail) {
          expect(buttons).toHaveLength(5);
          if (width === 320) expect(new Set(buttons.map((b) => b.top)).size).toBeGreaterThan(1);
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
    for (const query of ["name=&count=4", "name=Alex&count=0", "name=%20%20&count=4"]) {
      await page.goto(`/app/__liker-layout?${query}`);
      await expect(page.getByTestId("post-detail-actions")).toBeVisible();
      await expect(page.getByTestId("post-liker-summary-article-layout")).toHaveCount(0);
      await expect(page.getByTestId("post-detail-liker-summary")).toHaveCount(0);
    }
    await page.goto("/app/__liker-layout?name=Alex&count=1");
    await expect(page.getByTestId("post-liker-summary-article-layout")).toHaveText("Alex");
    await expect(page.getByTestId("post-detail-liker-summary")).toHaveText("Alex reacted");
  });
}

test("buttons retain reaction, comment, media, share, and image-dialog behavior", async ({ page }) => {
  await mountRenderers(page);
  await page.goto("/app/__liker-layout");
  for (const id of ["button-reaction-article-layout", "button-reaction"]) {
    const request = page.waitForRequest((req) => req.url().includes("/reactions") && req.method() === "PUT");
    await page.getByTestId(id).click();
    expect((await request).postDataJSON()).toEqual({ reactionType: "like" });
  }
  for (const id of ["button-share-article-layout", "button-share"]) {
    await page.getByTestId(id).click();
    await expect(page.getByTestId("button-confirm-share")).toBeVisible();
    const request = page.waitForRequest((req) => req.url().endsWith("/share") && req.method() === "POST");
    await page.getByTestId("button-confirm-share").click();
    await request;
  }
  await page.getByTestId("input-comment-body").fill("Still commenting");
  const comment = page.waitForRequest((req) => req.url().includes("/comments") && req.method() === "POST");
  await page.getByTestId("button-submit-comment").click();
  expect((await comment).postDataJSON()).toEqual({ body: "Still commenting" });
  await page.getByTestId("post-actions-article-layout").locator('a[href="/app/posts/article-layout"]').click();
  await expect(page).toHaveURL(/\/app\/posts\/article-layout$/);
  await page.getByTestId("button-album-article-layout").click();
  await expect(page).toHaveURL(/\/app\/posts\/article-layout\?album=1$/);
  await page.getByTestId("btn-share-image-article-layout").click();
  await expect(page.getByTestId("dialog-share-recap-image")).toBeVisible();
});
