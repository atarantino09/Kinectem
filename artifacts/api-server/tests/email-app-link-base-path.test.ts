import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildPasswordResetUrl,
  buildGuardianConfirmUrl,
  buildOrganizationInviteUrl,
  buildFamilyUrl,
  buildInviteAcceptUrl,
} from "../src/lib/email";
import { buildUnsubscribeUrl } from "../src/lib/notification-email";

// Task #635 fixed several transactional email deep-links that were missing the
// `/app/` base path, so password-reset / guardian-confirm / org-invite / family
// / roster-invite links landed on the marketing root instead of the in-app
// flow. This was a silent regression. These tests lock in the correct prefixes
// so a future refactor of `appBaseUrl()` or the URL builders can't quietly
// reintroduce the bug.
describe("email deep-link base paths", () => {
  const BASE = "https://kinectem.example";
  let originalBase: string | undefined;

  beforeAll(() => {
    // Pin appBaseUrl() to a deterministic value (it reads APP_BASE_URL at call
    // time) so the assertions don't depend on the dev/CI environment.
    originalBase = process.env.APP_BASE_URL;
    process.env.APP_BASE_URL = BASE;
  });

  afterAll(() => {
    if (originalBase === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = originalBase;
  });

  it("password-reset link includes the /app/ segment", () => {
    const url = buildPasswordResetUrl("tok123");
    expect(url).toBe(`${BASE}/app/reset-password/tok123`);
    expect(url).toContain("/app/");
  });

  it("guardian-confirm link includes the /app/ segment", () => {
    const url = buildGuardianConfirmUrl("tok123");
    expect(url).toBe(`${BASE}/app/guardian-confirm/tok123`);
    expect(url).toContain("/app/");
  });

  it("organization-invite link includes the /app/ segment", () => {
    const url = buildOrganizationInviteUrl("tok123");
    expect(url).toBe(`${BASE}/app/org-invites/tok123`);
    expect(url).toContain("/app/");
  });

  it("family link includes the /app/ segment", () => {
    const url = buildFamilyUrl();
    expect(url).toBe(`${BASE}/app/family`);
    expect(url).toContain("/app/");
  });

  it("roster-invite accept link includes the /app/ segment", () => {
    const url = buildInviteAcceptUrl("tok123");
    expect(url).toBe(`${BASE}/app/invites/tok123`);
    expect(url).toContain("/app/");
  });

  it("unsubscribe link targets the API and does NOT get an /app/ prefix", () => {
    const url = buildUnsubscribeUrl("tok123", "digest_weekly");
    expect(url).toContain("/api/v1/notifications/unsubscribe");
    expect(url).not.toContain("/app/");
    expect(url.startsWith(`${BASE}/api/v1/`)).toBe(true);
  });
});
