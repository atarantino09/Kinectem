import { test, expect, type Page } from "@playwright/test";

test.use({
  reducedMotion: "reduce",
  launchOptions: {
    executablePath: process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  },
});

async function mountBadges(page: Page, theme: string) {
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const user = { id: "viewer", firstName: "Test", lastName: "Viewer", avatarUrl: null, role: "coach" };
    let body: unknown = { data: [] };
    if (path.endsWith("/users/me")) body = user;
    else if (path.endsWith("/auth/whoami")) body = { authenticated: true, realUser: user, canAuthorRecap: false };
    else if (path.endsWith("/children-notifications-summary")) body = { data: [], totalUnreadCount: 0 };
    else if (path.endsWith("/broadcasts/unread-count")) body = { count: 1 };
    else if (path.endsWith("/unread-count")) body = { unreadCount: 12 };
    else if (path.endsWith("/conversations")) body = {
      data: [1, 12, 12345].map((count) => ({
        id: `count-${count}`,
        participant: { id: `person-${count}`, type: "user", displayName: "A conversation participant with a long name", avatarUrl: null },
        unreadCount: count,
        lastMessage: { bodyPreview: "A message preview", createdAt: "2026-10-09T12:00:00Z" },
      })),
    };
    await route.fulfill({ json: body });
  });
  await page.route(/\/app\/__numeric-badges(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/app/@vite/client"></script><script type="module">import RefreshRuntime from "/app/@react-refresh"; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => (type) => type; window.__vite_plugin_react_preamble_installed__ = true;</script><script type="module" src="/app/e2e/fixtures/numeric-badges.tsx"></script></body></html>',
    });
  });
  await page.goto(`/app/__numeric-badges?theme=${theme}`);
  await expect(page.getByTestId("badge-album-count-article-count-1")).toBeVisible();
  await page.evaluate(async () => {
    await Promise.all([700, 900].map((weight) => document.fonts.load(`${weight} 12px Inter`, "123456789+")));
    await document.fonts.ready;
  });
}

for (const width of [375, 1440]) {
  for (const theme of ["light", "dark"]) {
    test(`numeric badges center after fonts load at ${width}px in ${theme}`, async ({ page }, testInfo) => {
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(err.message));
      await page.setViewportSize({ width, height: 1100 });
      await mountBadges(page, theme);

      for (const count of [1, 8, 12, "9+", "99+", 12345]) {
        const badge = page.getByTestId(`sample-${count}`);
        await expect(badge).toHaveText(String(count));
        const metrics = await badge.evaluate((node) => {
          const label = node.querySelector(".numeric-badge-label")!;
          const outer = node.getBoundingClientRect();
          const inner = label.getBoundingClientRect();
          const css = getComputedStyle(node);
          return {
            width: outer.width, height: outer.height,
            xOffset: inner.x + inner.width / 2 - (outer.x + outer.width / 2),
            yOffset: inner.y + inner.height / 2 - (outer.y + outer.height / 2),
            fits: inner.x >= outer.x && inner.right <= outer.right && inner.y >= outer.y && inner.bottom <= outer.bottom,
            shrink: css.flexShrink, nowrap: css.whiteSpace, tracking: css.letterSpacing,
            font: css.fontFamily, fontVariant: css.fontVariantNumeric,
          };
        });
        expect(metrics.fits).toBe(true);
        expect(metrics.shrink).toBe("0");
        expect(metrics.nowrap).toBe("nowrap");
        // Chromium serializes a zero letter-spacing as either normal or 0px.
        expect(["normal", "0px"]).toContain(metrics.tracking);
        expect(metrics.font).toContain("Inter");
        expect(metrics.fontVariant).toContain("tabular-nums");
        expect(metrics.xOffset).toBeCloseTo(9 * 0.035, 1);
        expect(metrics.yOffset).toBeCloseTo(-9 * 0.035, 1);
        if (String(count).length === 1) expect(metrics.width).toBe(metrics.height);
        else expect(metrics.width).toBeGreaterThanOrEqual(metrics.height);
      }

      // Check visible digit ink rather than only the centered line box. Canvas
      // metrics are measured large then scaled down to avoid integer rounding
      // at the badge's tiny font size. All digits use the SAME optical offset.
      for (const count of [1, 8, 12, "9+", "99+"]) {
        const inkOffset = await page.getByTestId(`sample-${count}`).evaluate((node) => {
          const label = node.querySelector(".numeric-badge-label")!;
          const css = getComputedStyle(label);
          const ctx = document.createElement("canvas").getContext("2d")!;
          ctx.font = `${css.fontWeight} 100px ${css.fontFamily}`;
          const m = ctx.measureText(label.textContent!);
          const scale = parseFloat(css.fontSize) / 100;
          const outer = node.getBoundingClientRect();
          const inner = label.getBoundingClientRect();
          return {
            x: inner.x + inner.width / 2 + (m.actualBoundingBoxRight - m.actualBoundingBoxLeft - m.width) / 2 * scale - (outer.x + outer.width / 2),
            y: inner.y + inner.height / 2 + (m.fontBoundingBoxAscent - m.fontBoundingBoxDescent - m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) / 2 * scale - (outer.y + outer.height / 2),
          };
        });
        expect(Math.abs(inkOffset.x)).toBeLessThan(0.8);
        expect(Math.abs(inkOffset.y)).toBeLessThan(0.8);
      }

      for (const count of [1, 8, 12, 100]) {
        await expect(page.getByTestId(`badge-album-count-article-count-${count}`)).toHaveText(count > 99 ? "99+" : String(count));
        await expect(page.getByTestId(`button-album-article-count-${count}`)).toHaveAttribute("aria-label", "Open photo and video album");
      }
      for (const count of [1, 12, 12345]) {
        const badge = page.getByTestId(`badge-conversation-unread-count-${count}`);
        await expect(badge).toHaveText(String(count));
        const boxes = await badge.evaluate((node) => {
          const parent = node.parentElement!.getBoundingClientRect();
          const child = node.getBoundingClientRect();
          return { fits: child.left >= parent.left && child.right <= parent.right, width: child.width, height: child.height };
        });
        expect(boxes.fits).toBe(true);
        if (count === 1) expect(boxes.width).toBe(boxes.height);
      }
      await expect(page.getByTestId("badge-bell-unread")).toHaveText("9+");
      expect(await page.getByTestId("badge-bell-unread").evaluate((node) => getComputedStyle(node).boxShadow)).not.toBe("none");
      await expect(page.getByTestId("status-control").locator(".numeric-badge-label")).toHaveCount(0);
      await expect(page.getByTestId("signup-counts").locator(".numeric-badge")).toHaveCount(2);

      if (width >= 768) {
        await page.getByTestId("btn-user-menu").click();
        await expect(page.getByTestId("badge-menu-messages")).toHaveText("9+");
        await expect(page.getByTestId("badge-menu-announcements")).toHaveText("1");
      } else {
        await page.getByTestId("mobile-top-menu").click();
        await expect(page.getByTestId("mobile-link-messages").locator(".numeric-badge")).toHaveText("9+");
        await expect(page.getByTestId("mobile-link-announcements").locator(".numeric-badge")).toHaveText("1");
        await expect(page.getByTestId("mobile-link-messages")).toBeInViewport();
      }
      // Finish finite portal entry animations before recording the visual
      // result. DOM visibility alone can precede the compositor's final frame.
      await page.evaluate(() => document.getAnimations().forEach((animation) => {
        if (Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.finish();
      }));
      await page.screenshot({ path: testInfo.outputPath(`navigation-${width}-${theme}.png`) });
      await page.keyboard.press("Escape");
      await expect(page.getByRole(width >= 768 ? "menu" : "dialog")).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath(`badges-${width}-${theme}.png`), fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    });
  }
}
