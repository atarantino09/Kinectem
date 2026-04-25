import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, users } from "@workspace/db";
import { app, loginAs, request } from "./helpers";

const sentEmails: Array<{ to: string; subject: string; text: string }> = [];

vi.mock("../src/lib/email", () => ({
  isEmailConfigured: () => true,
  sendEmail: vi.fn(async (m: { to: string; subject: string; text: string }) => {
    sentEmails.push(m);
  }),
  sendPasswordResetEmail: vi.fn(async (to: string, token: string) => {
    sentEmails.push({
      to,
      subject: "Reset your Kinectem password",
      text: `/reset-password/${token}`,
    });
  }),
  sendGuardianConfirmationEmail: vi.fn(
    async (to: string, _name: string, token: string) => {
      sentEmails.push({
        to,
        subject: "Guardian confirmation",
        text: `/guardian-confirm/${token}`,
      });
    },
  ),
  sendGuardianExpiredEmail: vi.fn(async (to: string, name: string) => {
    sentEmails.push({
      to,
      subject: `${name}'s Kinectem confirmation link has expired`,
      text: `/family`,
    });
  }),
}));

beforeEach(() => {
  sentEmails.length = 0;
});

describe("notifications", () => {
  it("returns the seeded notification for samira", async () => {
    const { agent } = await loginAs(
      (u) => u.email === "samira@kinectem.demo",
    );
    const res = await agent.get("/api/v1/notifications");
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0].type).toBe("roster_invite");
  });

  it("counts unread notifications per user", async () => {
    const { agent } = await loginAs(
      (u) => u.email === "samira@kinectem.demo",
    );
    const res = await agent.get("/api/v1/notifications/unread-count");
    expect(res.status).toBe(200);
    expect(res.body.unreadCount).toBeGreaterThan(0);
  });

  it("marks all notifications as read for the current user", async () => {
    const { agent } = await loginAs(
      (u) => u.email === "samira@kinectem.demo",
    );
    const before = await agent.get("/api/v1/notifications/unread-count");
    expect(before.body.unreadCount).toBeGreaterThan(0);
    const mark = await agent.post("/api/v1/notifications/read-all");
    expect(mark.status).toBe(200);
    expect(mark.body.markedCount).toBeGreaterThan(0);
    const after = await agent.get("/api/v1/notifications/unread-count");
    expect(after.body.unreadCount).toBe(0);
  });

  it("marks a single notification as read", async () => {
    const { agent } = await loginAs(
      (u) => u.email === "samira@kinectem.demo",
    );
    const list = await agent.get("/api/v1/notifications");
    const target = list.body.data[0];
    const res = await agent.post(
      `/api/v1/notifications/${target.id}/read`,
    );
    expect(res.status).toBe(204);
  });

  it("returns an empty list for an anonymous request", async () => {
    const res = await request(app).get("/api/v1/notifications");
    expect(res.status).toBe(200);
    // Without a session, there is no targeted user, so the route returns
    // an empty page (per the route implementation).
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  describe("guardian confirmation expired notifications", () => {
    async function setupExpiredChild() {
      const { agent } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const childRes = await agent.get("/api/v1/users/me/children");
      const child = childRes.body.data[0];
      await db
        .update(users)
        .set({
          guardianEmail: "lisa@kinectem.demo",
          guardianConfirmedAt: null,
          guardianConfirmedByUserId: null,
          guardianConfirmToken: "expired-token-test",
          guardianConfirmTokenExpiresAt: new Date(Date.now() - 60_000),
          guardianExpiredEmailSentAt: null,
        })
        .where(eq(users.id, child.id));
      return { agent, childId: child.id as string };
    }

    it("creates a notification for the parent when a child's confirmation link has expired", async () => {
      const { agent, childId } = await setupExpiredChild();
      const me = await agent.get("/api/v1/users/me");
      expect(me.status).toBe(200);
      const list = await agent.get("/api/v1/notifications");
      const expired = list.body.data.find(
        (n: { type: string; data: { link: string } | null }) =>
          n.type === "guardian_expired" &&
          n.data?.link === `/guardian?childId=${childId}`,
      );
      expect(expired).toBeDefined();
      expect(expired.title).toMatch(/expired/i);
    });

    it("does not create a duplicate notification on subsequent requests", async () => {
      const { agent, childId } = await setupExpiredChild();
      await agent.get("/api/v1/users/me");
      await agent.get("/api/v1/users/me/children");
      await agent.get("/api/v1/users/me");
      const list = await agent.get("/api/v1/notifications");
      const matches = list.body.data.filter(
        (n: { type: string; data: { link: string } | null }) =>
          n.type === "guardian_expired" &&
          n.data?.link === `/guardian?childId=${childId}`,
      );
      expect(matches).toHaveLength(1);
    });

    it("does not create a notification when the child's confirmation is still pending (not expired)", async () => {
      const { agent } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const childRes = await agent.get("/api/v1/users/me/children");
      const child = childRes.body.data[0];
      await db
        .update(users)
        .set({
          guardianEmail: "lisa@kinectem.demo",
          guardianConfirmedAt: null,
          guardianConfirmedByUserId: null,
          guardianConfirmToken: "valid-token-test",
          guardianConfirmTokenExpiresAt: new Date(Date.now() + 60 * 60_000),
        })
        .where(eq(users.id, child.id));
      await agent.get("/api/v1/users/me");
      const list = await agent.get("/api/v1/notifications");
      const expired = list.body.data.filter(
        (n: { type: string }) => n.type === "guardian_expired",
      );
      expect(expired).toHaveLength(0);
    });

    it("does not create a notification for confirmed children", async () => {
      const { agent } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const childRes = await agent.get("/api/v1/users/me/children");
      const child = childRes.body.data[0];
      await db
        .update(users)
        .set({
          guardianEmail: "lisa@kinectem.demo",
          guardianConfirmedAt: new Date(),
          guardianConfirmToken: null,
          guardianConfirmTokenExpiresAt: new Date(Date.now() - 60_000),
        })
        .where(eq(users.id, child.id));
      await agent.get("/api/v1/users/me");
      const list = await agent.get("/api/v1/notifications");
      const expired = list.body.data.filter(
        (n: { type: string }) => n.type === "guardian_expired",
      );
      expect(expired).toHaveLength(0);
    });
  });

  describe("guardian confirmation expired emails", () => {
    async function setupExpiredChild() {
      const { agent } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const childRes = await agent.get("/api/v1/users/me/children");
      const child = childRes.body.data[0];
      await db
        .update(users)
        .set({
          guardianEmail: "lisa@kinectem.demo",
          guardianConfirmedAt: null,
          guardianConfirmedByUserId: null,
          guardianConfirmToken: "expired-token-test",
          guardianConfirmTokenExpiresAt: new Date(Date.now() - 60_000),
          guardianExpiredEmailSentAt: null,
        })
        .where(eq(users.id, child.id));
      return { agent, childId: child.id as string };
    }

    it("emails the guardian when a child's confirmation link expires", async () => {
      const { agent, childId } = await setupExpiredChild();
      sentEmails.length = 0;
      const me = await agent.get("/api/v1/users/me");
      expect(me.status).toBe(200);
      const expiredEmails = sentEmails.filter((e) =>
        /expired/i.test(e.subject),
      );
      expect(expiredEmails).toHaveLength(1);
      expect(expiredEmails[0].to).toBe("lisa@kinectem.demo");
      expect(expiredEmails[0].text).toContain("/family");
      const [child] = await db
        .select({ sentAt: users.guardianExpiredEmailSentAt })
        .from(users)
        .where(eq(users.id, childId))
        .limit(1);
      expect(child.sentAt).not.toBeNull();
    });

    it("does not send a duplicate expired email on subsequent requests", async () => {
      const { agent } = await setupExpiredChild();
      sentEmails.length = 0;
      await agent.get("/api/v1/users/me");
      await agent.get("/api/v1/users/me/children");
      await agent.get("/api/v1/users/me");
      const expiredEmails = sentEmails.filter((e) =>
        /expired/i.test(e.subject),
      );
      expect(expiredEmails).toHaveLength(1);
    });

    it("falls back to the parent's account email when guardianEmail is null", async () => {
      const { agent } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const childRes = await agent.get("/api/v1/users/me/children");
      const child = childRes.body.data[0];
      await db
        .update(users)
        .set({
          guardianEmail: null,
          guardianConfirmedAt: null,
          guardianConfirmedByUserId: null,
          guardianConfirmToken: "expired-token-test",
          guardianConfirmTokenExpiresAt: new Date(Date.now() - 60_000),
          guardianExpiredEmailSentAt: null,
        })
        .where(eq(users.id, child.id));
      sentEmails.length = 0;
      await agent.get("/api/v1/users/me");
      const expiredEmails = sentEmails.filter((e) =>
        /expired/i.test(e.subject),
      );
      expect(expiredEmails).toHaveLength(1);
      expect(expiredEmails[0].to).toBe("lisa@kinectem.demo");
    });

    it("does not email when the child's confirmation is still pending", async () => {
      const { agent } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const childRes = await agent.get("/api/v1/users/me/children");
      const child = childRes.body.data[0];
      await db
        .update(users)
        .set({
          guardianEmail: "lisa@kinectem.demo",
          guardianConfirmedAt: null,
          guardianConfirmedByUserId: null,
          guardianConfirmToken: "valid-token-test",
          guardianConfirmTokenExpiresAt: new Date(Date.now() + 60 * 60_000),
          guardianExpiredEmailSentAt: null,
        })
        .where(eq(users.id, child.id));
      sentEmails.length = 0;
      await agent.get("/api/v1/users/me");
      const expiredEmails = sentEmails.filter((e) =>
        /expired/i.test(e.subject),
      );
      expect(expiredEmails).toHaveLength(0);
    });

    it("does not email when the parent has opted out of expired-confirmation emails", async () => {
      const { agent, childId } = await setupExpiredChild();
      // Opt the parent out via the public endpoint, then trigger a refresh.
      const pref = await agent
        .patch("/api/v1/notifications/email-preference")
        .send({ emailOptOut: true });
      expect(pref.status).toBe(200);
      expect(pref.body.emailOptOut).toBe(true);

      sentEmails.length = 0;
      const me = await agent.get("/api/v1/users/me");
      expect(me.status).toBe(200);

      // No email should have been sent.
      expect(
        sentEmails.filter((e) => /expired/i.test(e.subject)),
      ).toHaveLength(0);

      // The in-app notification, however, must still be created.
      const list = await agent.get("/api/v1/notifications");
      const expired = list.body.data.find(
        (n: { type: string; data: { link: string } | null }) =>
          n.type === "guardian_expired" &&
          n.data?.link === `/guardian?childId=${childId}`,
      );
      expect(expired).toBeDefined();

      // And the per-child sent-at tracker must remain null so a future
      // opt-in still gets the next expiry email.
      const [child] = await db
        .select({ sentAt: users.guardianExpiredEmailSentAt })
        .from(users)
        .where(eq(users.id, childId))
        .limit(1);
      expect(child.sentAt).toBeNull();
    });

    it("resumes sending the expired email after the parent opts back in", async () => {
      const { agent, childId } = await setupExpiredChild();
      // Opt out, trigger (no email), then opt back in and trigger again.
      await agent
        .patch("/api/v1/notifications/email-preference")
        .send({ emailOptOut: true });
      sentEmails.length = 0;
      await agent.get("/api/v1/users/me");
      expect(
        sentEmails.filter((e) => /expired/i.test(e.subject)),
      ).toHaveLength(0);

      await agent
        .patch("/api/v1/notifications/email-preference")
        .send({ emailOptOut: false });
      sentEmails.length = 0;
      await agent.get("/api/v1/users/me");
      expect(
        sentEmails.filter((e) => /expired/i.test(e.subject)),
      ).toHaveLength(1);
      // And the per-child sent-at tracker should now be populated.
      const [child] = await db
        .select({ sentAt: users.guardianExpiredEmailSentAt })
        .from(users)
        .where(eq(users.id, childId))
        .limit(1);
      expect(child.sentAt).not.toBeNull();
    });

    it("persists the email preference across requests via GET", async () => {
      const { agent } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      // Reset to a known state.
      await agent
        .patch("/api/v1/notifications/email-preference")
        .send({ emailOptOut: false });

      const before = await agent.get("/api/v1/notifications/email-preference");
      expect(before.status).toBe(200);
      expect(before.body.emailOptOut).toBe(false);

      const set = await agent
        .patch("/api/v1/notifications/email-preference")
        .send({ emailOptOut: true });
      expect(set.body.emailOptOut).toBe(true);

      const after = await agent.get("/api/v1/notifications/email-preference");
      expect(after.body.emailOptOut).toBe(true);

      // The deprecated PUT alias should still work too.
      const putRes = await agent
        .put("/api/v1/notifications/email-preference")
        .send({ emailOptOut: false });
      expect(putRes.status).toBe(200);
      expect(putRes.body.emailOptOut).toBe(false);
    });

    it("rejects unauthenticated email-preference requests", async () => {
      const res = await request(app).get(
        "/api/v1/notifications/email-preference",
      );
      expect(res.status).toBe(401);
    });

    it("sends a fresh email after the link is resent and expires again", async () => {
      const { agent, childId } = await setupExpiredChild();
      sentEmails.length = 0;
      // First expiry cycle: email is sent.
      await agent.get("/api/v1/users/me");
      expect(
        sentEmails.filter((e) => /expired/i.test(e.subject)),
      ).toHaveLength(1);

      // Parent resends the link. The resend route requires the parent's
      // password, but here we simulate the resend's effect on the child row
      // directly: a new token + expiry is set and the expired-email tracker
      // is cleared. Then we expire again to trigger a new email.
      await db
        .update(users)
        .set({
          guardianConfirmToken: "new-token-test",
          guardianConfirmTokenExpiresAt: new Date(Date.now() + 60 * 60_000),
          guardianExpiredEmailSentAt: null,
        })
        .where(eq(users.id, childId));

      // Trigger again while still pending: no new email.
      sentEmails.length = 0;
      await agent.get("/api/v1/users/me");
      expect(
        sentEmails.filter((e) => /expired/i.test(e.subject)),
      ).toHaveLength(0);

      // Now expire the new token and verify a fresh email is sent.
      await db
        .update(users)
        .set({
          guardianConfirmTokenExpiresAt: new Date(Date.now() - 60_000),
        })
        .where(eq(users.id, childId));
      sentEmails.length = 0;
      await agent.get("/api/v1/users/me");
      expect(
        sentEmails.filter((e) => /expired/i.test(e.subject)),
      ).toHaveLength(1);
    });
  });
});
