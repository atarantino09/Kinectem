import { describe, expect, it, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, users, notificationPreferences } from "@workspace/db";
import {
  dispatchNotificationEmail,
  type DispatchBuildContext,
} from "../src/lib/notification-email";
import {
  getOrCreatePreferences,
  isEmailCategory,
} from "../src/lib/notification-prefs";
import { loginAs, request, app } from "./helpers";

// Capture every email the dispatch gate actually sends. We mock `sendEmail`
// directly (not a higher-level helper) because the gate imports it straight
// from email.ts; the real one no-ops when SendGrid is unconfigured, so the
// mock both captures and keeps the send path alive in tests.
const sentEmails: Array<{ to: string; subject: string; text: string }> = [];

vi.mock("../src/lib/email", async () => {
  const actual =
    await vi.importActual<typeof import("../src/lib/email")>("../src/lib/email");
  return {
    ...actual,
    isEmailConfigured: () => true,
    sendEmail: vi.fn(async (m: { to: string; subject: string; text: string }) => {
      sentEmails.push({ to: m.to, subject: m.subject, text: m.text });
    }),
  };
});

// Record the build context the gate passes us so we can assert routing
// (recipient, subjectName, isGuardianCopy, unsubscribe link) directly.
const builtCtxs: DispatchBuildContext[] = [];
function testBuild(ctx: DispatchBuildContext) {
  builtCtxs.push(ctx);
  return {
    to: ctx.to,
    subject: `Notify ${ctx.subjectName}`,
    text: `unsubscribe: ${ctx.unsubscribeUrl}`,
  };
}

async function getUser(email: string) {
  const [u] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      isMinor: users.isMinor,
      parentId: users.parentId,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!u) throw new Error(`Seed user ${email} missing`);
  return u;
}

// Reset a user's prefs back to the all-on defaults by dropping the row;
// getOrCreatePreferences recreates it with a fresh token on next read.
async function resetPrefs(userId: string) {
  await db
    .delete(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId));
}

beforeEach(() => {
  sentEmails.length = 0;
  builtCtxs.length = 0;
});

describe("notification email dispatch gate (task #633)", () => {
  it("emails an adult whose category preference is on", async () => {
    const coach = await getUser("coach@kinectem.demo");
    await resetPrefs(coach.id);

    await dispatchNotificationEmail({
      userId: coach.id,
      category: "social_follow",
      build: testBuild,
    });

    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toBe(coach.email);
    expect(builtCtxs[0].isGuardianCopy).toBe(false);
    expect(builtCtxs[0].subjectName).toBe(coach.name);
    expect(builtCtxs[0].unsubscribeUrl).toContain("cat=social_follow");
  });

  it("suppresses the email when the adult turned that category off", async () => {
    const coach = await getUser("coach@kinectem.demo");
    await getOrCreatePreferences(coach.id);
    await db
      .update(notificationPreferences)
      .set({ socialFollow: false })
      .where(eq(notificationPreferences.userId, coach.id));

    await dispatchNotificationEmail({
      userId: coach.id,
      category: "social_follow",
      build: testBuild,
    });

    expect(sentEmails).toHaveLength(0);
    expect(builtCtxs).toHaveLength(0);
  });

  it("suppresses every category when the master pause is on", async () => {
    const coach = await getUser("coach@kinectem.demo");
    await getOrCreatePreferences(coach.id);
    await db
      .update(notificationPreferences)
      .set({ pauseAll: true })
      .where(eq(notificationPreferences.userId, coach.id));

    await dispatchNotificationEmail({
      userId: coach.id,
      category: "team_recap",
      build: testBuild,
    });

    expect(sentEmails).toHaveLength(0);
  });

  it("routes a minor's engagement email to the linked guardian", async () => {
    const lisa = await getUser("lisa@kinectem.demo");
    // Seed sets the parent link but not the minor flag; make the
    // relationship explicit so the COPPA routing branch is exercised.
    await db
      .update(users)
      .set({ isMinor: true, parentId: lisa.id })
      .where(eq(users.email, "samira@kinectem.demo"));
    const samira = await getUser("samira@kinectem.demo");
    expect(samira.isMinor).toBe(true);
    expect(samira.parentId).toBe(lisa.id);
    await resetPrefs(lisa.id);

    await dispatchNotificationEmail({
      userId: samira.id,
      category: "social_reaction",
      build: testBuild,
    });

    expect(sentEmails).toHaveLength(1);
    // Sent to the guardian, never the minor.
    expect(sentEmails[0].to).toBe(lisa.email);
    expect(sentEmails[0].to).not.toBe(samira.email);
    expect(builtCtxs[0].isGuardianCopy).toBe(true);
    // Recipient is the guardian; the subject still references the minor.
    expect(builtCtxs[0].recipientName).toBe(lisa.name);
    expect(builtCtxs[0].subjectName).toBe(samira.name);
  });

  it("suppresses a minor's email when the guardian turned the category off", async () => {
    const lisa = await getUser("lisa@kinectem.demo");
    await db
      .update(users)
      .set({ isMinor: true, parentId: lisa.id })
      .where(eq(users.email, "samira@kinectem.demo"));
    const samira = await getUser("samira@kinectem.demo");
    await getOrCreatePreferences(lisa.id);
    await db
      .update(notificationPreferences)
      .set({ socialReaction: false })
      .where(eq(notificationPreferences.userId, lisa.id));

    await dispatchNotificationEmail({
      userId: samira.id,
      category: "social_reaction",
      build: testBuild,
    });

    expect(sentEmails).toHaveLength(0);
  });

  it("suppresses a minor's engagement email when there is no linked guardian", async () => {
    await db
      .update(users)
      .set({ isMinor: true, parentId: null })
      .where(eq(users.email, "samira@kinectem.demo"));
    const samira = await getUser("samira@kinectem.demo");

    await dispatchNotificationEmail({
      userId: samira.id,
      category: "social_reaction",
      build: testBuild,
    });

    expect(sentEmails).toHaveLength(0);
    expect(builtCtxs).toHaveLength(0);
  });

  it("suppresses a minor-routed email when the guardian paused all email", async () => {
    const lisa = await getUser("lisa@kinectem.demo");
    await db
      .update(users)
      .set({ isMinor: true, parentId: lisa.id })
      .where(eq(users.email, "samira@kinectem.demo"));
    const samira = await getUser("samira@kinectem.demo");
    await getOrCreatePreferences(lisa.id);
    await db
      .update(notificationPreferences)
      .set({ pauseAll: true })
      .where(eq(notificationPreferences.userId, lisa.id));

    await dispatchNotificationEmail({
      userId: samira.id,
      category: "team_recap",
      build: testBuild,
    });

    expect(sentEmails).toHaveLength(0);
  });

  it("essential categories are not part of the gated set (they bypass it)", () => {
    // Transactional emails (password reset, consent, guardian-confirm) are not
    // EmailCategory values, so they never flow through dispatchNotificationEmail.
    expect(isEmailCategory("password_reset")).toBe(false);
    expect(isEmailCategory("guardian_confirm")).toBe(false);
    expect(isEmailCategory("social_follow")).toBe(true);
  });

  it("an unsubscribe flip on the recipient suppresses the next send", async () => {
    const coach = await getUser("coach@kinectem.demo");
    await resetPrefs(coach.id);
    const prefs = await getOrCreatePreferences(coach.id);

    // First send goes through with the category on.
    await dispatchNotificationEmail({
      userId: coach.id,
      category: "motivational",
      build: testBuild,
    });
    expect(sentEmails).toHaveLength(1);

    // Hit the no-login unsubscribe link for this category, then retry.
    const res = await request(app).get(
      `/api/v1/notifications/unsubscribe?token=${prefs.unsubscribeToken}&cat=motivational`,
    );
    expect(res.status).toBe(200);

    sentEmails.length = 0;
    await dispatchNotificationEmail({
      userId: coach.id,
      category: "motivational",
      build: testBuild,
    });
    expect(sentEmails).toHaveLength(0);
  });
});

describe("notification preferences API (task #633)", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/v1/notifications/preferences");
    expect(res.status).toBe(401);
  });

  it("returns all-on defaults plus pauseAll=false", async () => {
    const coach = await getUser("coach@kinectem.demo");
    await resetPrefs(coach.id);
    const { agent } = await loginAs("coach@kinectem.demo");

    const res = await agent.get("/api/v1/notifications/preferences");
    expect(res.status).toBe(200);
    expect(res.body.socialFollow).toBe(true);
    expect(res.body.teamRecap).toBe(true);
    expect(res.body.motivational).toBe(true);
    expect(res.body.pauseAll).toBe(false);
  });

  it("persists a partial preference update", async () => {
    const coach = await getUser("coach@kinectem.demo");
    await resetPrefs(coach.id);
    const { agent } = await loginAs("coach@kinectem.demo");

    const put = await agent
      .put("/api/v1/notifications/preferences")
      .send({ socialFollow: false, pauseAll: true });
    expect(put.status).toBe(200);
    expect(put.body.socialFollow).toBe(false);
    expect(put.body.pauseAll).toBe(true);
    // Untouched categories stay on.
    expect(put.body.teamRecap).toBe(true);

    const get = await agent.get("/api/v1/notifications/preferences");
    expect(get.body.socialFollow).toBe(false);
    expect(get.body.pauseAll).toBe(true);
  });

  it("rejects unknown keys and non-boolean values", async () => {
    const { agent } = await loginAs("coach@kinectem.demo");

    const bogus = await agent
      .put("/api/v1/notifications/preferences")
      .send({ notAToggle: true });
    expect(bogus.status).toBe(400);

    const nonBool = await agent
      .put("/api/v1/notifications/preferences")
      .send({ socialFollow: "nope" });
    expect(nonBool.status).toBe(400);
  });
});

describe("public no-login unsubscribe (task #633)", () => {
  it("flips a single category off and returns a friendly HTML page", async () => {
    const coach = await getUser("coach@kinectem.demo");
    await resetPrefs(coach.id);
    const prefs = await getOrCreatePreferences(coach.id);

    const res = await request(app).get(
      `/api/v1/notifications/unsubscribe?token=${prefs.unsubscribeToken}&cat=team_broadcast`,
    );
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");

    const [row] = await db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, coach.id))
      .limit(1);
    expect(row.teamBroadcast).toBe(false);
    expect(row.pauseAll).toBe(false);
  });

  it("treats cat=all as the master pause", async () => {
    const coach = await getUser("coach@kinectem.demo");
    await resetPrefs(coach.id);
    const prefs = await getOrCreatePreferences(coach.id);

    const res = await request(app).get(
      `/api/v1/notifications/unsubscribe?token=${prefs.unsubscribeToken}&cat=all`,
    );
    expect(res.status).toBe(200);

    const [row] = await db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, coach.id))
      .limit(1);
    expect(row.pauseAll).toBe(true);
  });

  it("returns a 400 page when the token is missing", async () => {
    const res = await request(app).get(
      "/api/v1/notifications/unsubscribe?cat=social_follow",
    );
    expect(res.status).toBe(400);
    expect(res.headers["content-type"]).toContain("text/html");
  });
});
