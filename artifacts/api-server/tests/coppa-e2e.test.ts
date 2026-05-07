// Task #372 — End-to-end COPPA tests covering the parent + admin
// flows that shipped under Tasks #32 / #360 / #362 / #367 / #368 /
// #369 / #371. Each section drives the full HTTP path (signup →
// guardian email → consent ceremony, parent-files-takedown → admin
// decision → guardian bell, MinorControls revoke/regrant, parent
// right-to-delete → operator hard-delete, parent-driven recovery)
// so a regression in any one of those legally sensitive flows fails
// loudly here instead of silently in production.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  db,
  users,
  parentalConsents,
  notifications,
  consentAuditLog,
  takedownRequests,
  articles,
  articleTags,
  teams,
} from "@workspace/db";
import { hardDeleteUserCli } from "@workspace/scripts/coppa-hard-delete";
import { hashConsentToken } from "../src/lib/coppa";
import { generateToken } from "../src/lib/passwords";
import { app, loginAs, request, DEMO_PASSWORD } from "./helpers";

// ---------------------------------------------------------------------------
// Email mock — captures every outgoing message so the consent ceremony
// tests can read the raw token out of the simulated inbox without
// going through SendGrid.
// ---------------------------------------------------------------------------

type SentEmail = { to: string; subject: string; text: string };
const sentEmails: SentEmail[] = [];

vi.mock("../src/lib/email", () => ({
  isEmailConfigured: () => true,
  sendEmail: vi.fn(async (m: SentEmail) => {
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
  sendParentalConsentNoticeEmail: vi.fn(
    async (to: string, _name: string, token: string) => {
      sentEmails.push({
        to,
        subject: "Parental consent notice",
        text: `/guardian-consent/${token}`,
      });
    },
  ),
  sendParentalConsentFollowupEmail: vi.fn(
    async (to: string, _name: string, token: string) => {
      sentEmails.push({
        to,
        subject: "Parental consent follow-up",
        text: `/guardian-consent/${token}/finalize`,
      });
    },
  ),
  sendParentalConsentFinalizedEmail: vi.fn(
    async (to: string, _name: string, revokeToken: string) => {
      sentEmails.push({
        to,
        subject: "Parental consent finalized",
        text: `/guardian-revoke/${revokeToken}`,
      });
    },
  ),
  sendGuardianExpiredEmail: vi.fn(async () => {}),
  sendTagNotificationEmail: vi.fn(async () => {}),
}));

function lastEmailTo(to: string): SentEmail | undefined {
  for (let i = sentEmails.length - 1; i >= 0; i--) {
    if (sentEmails[i].to === to) return sentEmails[i];
  }
  return undefined;
}

beforeEach(() => {
  sentEmails.length = 0;
});

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function findUserId(email: string): Promise<string> {
  const [u] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!u) throw new Error(`User ${email} missing from seed`);
  return u.id;
}

async function getAnyTeamId(): Promise<string> {
  const [t] = await db.select({ id: teams.id }).from(teams).limit(1);
  if (!t) throw new Error("No teams in seed");
  return t.id;
}

// Mark Samira (seeded as Lisa's child) explicitly as a minor whose
// account is active. The Phase 2 family-dashboard routes authorize on
// `users.parentId === me.id`; this mirrors the production state.
async function makeSamiraAMinor(): Promise<string> {
  const id = await findUserId("samira@kinectem.demo");
  await db
    .update(users)
    .set({
      isMinor: true,
      profileVisibility: "followers",
      accountStatus: "active",
      consentRevokedAt: null,
      deletionRequestedAt: null,
    })
    .where(eq(users.id, id));
  return id;
}

// Drives the full under-13 athlete signup -> consent ceremony chain
// without waiting for the FOLLOWUP_DELAY_MS in-process timer in
// consent.ts. The follow-up token is hashed before being stored, so we
// generate our own raw token and overwrite the row's hash to drive the
// finalize step deterministically.
async function signupUnder13(): Promise<{
  email: string;
  password: string;
  guardianEmail: string;
  childId: string;
  noticeToken: string;
}> {
  const dob = new Date();
  dob.setFullYear(dob.getFullYear() - 9);
  const email = `kid-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@kinectem.test`;
  const guardianEmail = `parent-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@kinectem.test`;
  const password = "supersecret1";

  // Age-gate cookie has to be in place before /auth/signup will accept
  // an athlete DOB. Use the real /auth/age-check route so the signed
  // cookie matches the server's secret.
  const agent = request.agent(app);
  const ageRes = await agent
    .post("/api/v1/auth/age-check")
    .send({ dateOfBirth: dob.toISOString().slice(0, 10) });
  expect(ageRes.status).toBe(200);
  expect(ageRes.body.requiresParentalConsent).toBe(true);

  const signup = await agent.post("/api/v1/auth/signup").send({
    firstName: "Tiny",
    lastName: "Player",
    role: "athlete",
    email,
    password,
    dateOfBirth: dob.toISOString().slice(0, 10),
    guardianEmail,
    guardianConsent: true,
  });
  expect(signup.status).toBe(201);
  expect(signup.body.pendingGuardianConfirmation).toBe(true);

  const noticeMsg = lastEmailTo(guardianEmail);
  expect(noticeMsg, "expected parental-consent notice email").toBeDefined();
  const m = noticeMsg!.text.match(/\/guardian-consent\/([A-Za-z0-9_-]+)/);
  expect(m, "expected /guardian-consent/<token> in notice email").toBeTruthy();
  const noticeToken = m![1];

  const childId = signup.body.id as string;
  return { email, password, guardianEmail, childId, noticeToken };
}

// ---------------------------------------------------------------------------
// (1) Under-13 signup → guardian-confirm email link → guardian
//     consent finalize. Drives the new email-plus parental-consent
//     ceremony end-to-end and asserts the child can sign in once the
//     guardian finalizes.
// ---------------------------------------------------------------------------

describe("COPPA E2E — Task #372", () => {
  describe("under-13 signup → consent ceremony → finalize", () => {
    it("walks pending_notice → pending_followup → finalized and unlocks login", async () => {
      const { email, password, guardianEmail, childId, noticeToken } =
        await signupUnder13();

      // Login is blocked while the consent row is still pending.
      const blocked = await request(app)
        .post("/api/v1/auth/login")
        .send({ email, password });
      expect(blocked.status).toBe(403);

      // GET the notice landing page — guardian sees the canonical text.
      const noticeRes = await request(app).get(
        `/api/v1/auth/guardian-consent/${noticeToken}`,
      );
      expect(noticeRes.status).toBe(200);
      expect(noticeRes.body.guardianEmail).toBe(guardianEmail);
      expect(noticeRes.body.athleteName).toContain("Tiny");
      const noticeVersion = noticeRes.body.noticeVersion as string;

      // POST the first step (notice + checkbox). Server transitions
      // pending_notice → pending_followup and schedules the follow-up
      // email, but we don't wait for the in-process timer below.
      const firstStep = await request(app)
        .post(`/api/v1/auth/guardian-consent/${noticeToken}`)
        .send({ agreed: true, noticeVersion });
      expect(firstStep.status).toBe(200);

      // The first token is now consumed; refetching by it 404s.
      const refetch = await request(app).get(
        `/api/v1/auth/guardian-consent/${noticeToken}`,
      );
      expect(refetch.status).toBe(404);

      const [pending] = await db
        .select()
        .from(parentalConsents)
        .where(eq(parentalConsents.childUserId, childId))
        .limit(1);
      expect(pending.state).toBe("pending_followup");

      // The followup token only ever leaves the server inside the
      // emailed link. Rather than waiting on the FOLLOWUP_DELAY_MS
      // timer (or starting the durable scheduler) we mint a fresh
      // raw token and rewrite the hash directly — equivalent to the
      // server having delivered the email.
      const followupRaw = generateToken();
      await db
        .update(parentalConsents)
        .set({
          followupTokenHash: hashConsentToken(followupRaw),
          followupTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
          followupSentAt: new Date(),
        })
        .where(eq(parentalConsents.id, pending.id));

      // Login still blocked between step one and step two.
      const stillBlocked = await request(app)
        .post("/api/v1/auth/login")
        .send({ email, password });
      expect(stillBlocked.status).toBe(403);

      const finalize = await request(app).post(
        `/api/v1/auth/guardian-consent/${followupRaw}/finalize`,
      );
      expect(finalize.status).toBe(200);

      const [done] = await db
        .select()
        .from(parentalConsents)
        .where(eq(parentalConsents.childUserId, childId))
        .limit(1);
      expect(done.state).toBe("finalized");
      expect(done.finalizedAt).toBeTruthy();

      const [child] = await db
        .select()
        .from(users)
        .where(eq(users.id, childId))
        .limit(1);
      expect(child.accountStatus).toBe("active");
      expect(child.guardianConfirmedAt).toBeTruthy();
      expect(child.consentFinalizedAt).toBeTruthy();

      // Child can finally sign in.
      const ok = await request(app)
        .post("/api/v1/auth/login")
        .send({ email, password });
      expect(ok.status).toBe(200);
      expect(ok.body.id).toBe(childId);

      // Audit trail covers the whole ceremony.
      const audit = await db
        .select({ event: consentAuditLog.event })
        .from(consentAuditLog)
        .where(eq(consentAuditLog.childUserId, childId));
      const events = audit.map((r) => r.event);
      expect(events).toContain("child_signup");
      expect(events).toContain("guardian_first_consent");
      expect(events).toContain("guardian_finalized");
    });

    it("rejects finalize with the wrong notice version (forces a reload)", async () => {
      const { noticeToken } = await signupUnder13();
      const stale = await request(app)
        .post(`/api/v1/auth/guardian-consent/${noticeToken}`)
        .send({ agreed: true, noticeVersion: "0.0.0-stale" });
      expect(stale.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // (2) Parent files takedown → admin approves/declines → guardian
  //     sees bell notification (#369). Drives the full HTTP chain:
  //     guardian POSTs takedown-request, admin POSTs approve/decline,
  //     guardian's /api/v1/notifications surfaces the decision row.
  // -------------------------------------------------------------------------

  describe("parent takedown → admin decision → guardian bell (#369)", () => {
    async function plantTakedownableArticle(): Promise<{
      articleId: string;
      samiraId: string;
    }> {
      const samiraId = await makeSamiraAMinor();
      const coachId = await findUserId("coach@kinectem.demo");
      const teamId = await getAnyTeamId();
      const [article] = await db
        .insert(articles)
        .values({
          teamId,
          authorId: coachId,
          title: "Photo of Samira",
          body: "x",
          status: "published",
        })
        .returning();
      // Tag samira so the guardian passes the child-link auth check.
      await db.insert(articleTags).values({
        articleId: article.id,
        userId: samiraId,
        taggerUserId: coachId,
        status: "pending",
      });
      return { articleId: article.id, samiraId };
    }

    it("approve flow: post deleted, audit row written, guardian bells", async () => {
      const { articleId, samiraId } = await plantTakedownableArticle();
      const lisaId = await findUserId("lisa@kinectem.demo");

      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const filed = await lisa
        .post(`/api/v1/guardians/children/${samiraId}/takedown-request`)
        .send({ postId: `article:${articleId}`, reason: "unauthorized photo" });
      expect(filed.status).toBe(201);
      const takedownId = filed.body.id as string;

      const { agent: admin } = await loginAs(
        (u) => u.email === "sam@kinectem.demo",
      );
      const decision = await admin.post(
        `/api/v1/admin/takedowns/${takedownId}/approve`,
      );
      expect(decision.status).toBe(200);
      expect(decision.body.affected).toBe(1);

      // Article must be hard-deleted.
      const remaining = await db
        .select()
        .from(articles)
        .where(eq(articles.id, articleId));
      expect(remaining.length).toBe(0);

      // Takedown row marked approved.
      const [td] = await db
        .select()
        .from(takedownRequests)
        .where(eq(takedownRequests.id, takedownId));
      expect(td.status).toBe("approved");
      expect(td.decidedAt).toBeTruthy();

      // Audit log row written by decideTakedown.
      const audit = await db
        .select()
        .from(consentAuditLog)
        .where(
          and(
            eq(consentAuditLog.event, "guardian_takedown_approved"),
            eq(consentAuditLog.childUserId, samiraId),
          ),
        );
      expect(audit.length).toBe(1);

      // Guardian bell surfaces the decision via the public API. The
      // notifications endpoint maps the row through `toNotification`,
      // so `kind` becomes `type` and `link` is nested under `data`.
      const inbox = await lisa.get("/api/v1/notifications");
      expect(inbox.status).toBe(200);
      const list = inbox.body.data as Array<{
        type: string;
        data: { link?: string } | null;
      }>;
      const decisionBell = list.find(
        (n) => n.type === "guardian_takedown_approved",
      );
      expect(decisionBell, "expected guardian_takedown_approved bell").toBeDefined();
      // #369 — link points at /family?childId=<id> (no tab=pending,
      // because the item is no longer pending).
      expect(decisionBell!.data?.link).toBe(`/family?childId=${samiraId}`);

      // DB-level sanity: exactly one decision notification for Lisa.
      const dbBell = await db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, lisaId),
            eq(notifications.kind, "guardian_takedown_approved"),
          ),
        );
      expect(dbBell.length).toBe(1);
    });

    it("decline flow: post survives, audit row written, guardian bells declined", async () => {
      const { articleId, samiraId } = await plantTakedownableArticle();
      const lisaId = await findUserId("lisa@kinectem.demo");

      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const filed = await lisa
        .post(`/api/v1/guardians/children/${samiraId}/takedown-request`)
        .send({ postId: `article:${articleId}`, reason: "false positive" });
      expect(filed.status).toBe(201);
      const takedownId = filed.body.id as string;

      const { agent: admin } = await loginAs(
        (u) => u.email === "sam@kinectem.demo",
      );
      const decision = await admin.post(
        `/api/v1/admin/takedowns/${takedownId}/decline`,
      );
      expect(decision.status).toBe(200);

      const remaining = await db
        .select()
        .from(articles)
        .where(eq(articles.id, articleId));
      expect(remaining.length).toBe(1);

      const audit = await db
        .select()
        .from(consentAuditLog)
        .where(
          and(
            eq(consentAuditLog.event, "guardian_takedown_declined"),
            eq(consentAuditLog.childUserId, samiraId),
          ),
        );
      expect(audit.length).toBe(1);

      const dbBell = await db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, lisaId),
            eq(notifications.kind, "guardian_takedown_declined"),
          ),
        );
      expect(dbBell.length).toBe(1);
      expect(dbBell[0].link).toBe(`/family?childId=${samiraId}`);
    });
  });

  // -------------------------------------------------------------------------
  // (3) Parent revoke / regrant from MinorControls (#360). Hits the
  //     /guardians/.../revoke-consent and /regrant-consent endpoints
  //     and asserts the child's lockout flips on / off accordingly.
  // -------------------------------------------------------------------------

  describe("MinorControls revoke / regrant (#360)", () => {
    it("revoke flips the child to pending_revocation and locks subsequent requests", async () => {
      const samiraId = await makeSamiraAMinor();
      const { agent: child } = await loginAs(
        (u) => u.email === "samira@kinectem.demo",
      );
      const meBefore = await child.get("/api/v1/users/me");
      expect(meBefore.status).toBe(200);

      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const revoke = await lisa.post(
        `/api/v1/guardians/children/${samiraId}/revoke-consent`,
      );
      expect(revoke.status).toBe(200);
      expect(revoke.body.accountStatus).toBe("pending_revocation");

      // Child's existing cookie session is still on file but the
      // account-status middleware (artifacts/api-server/src/middlewares/auth.ts)
      // must reject pending_revocation on the very next request.
      const meAfter = await child.get("/api/v1/users/me");
      expect(meAfter.status).toBe(401);

      // Bell entry for the child so they can see the change.
      const childBell = await db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, samiraId),
            eq(notifications.kind, "guardian_revoked"),
          ),
        );
      expect(childBell.length).toBe(1);

      // Audit row.
      const audit = await db
        .select()
        .from(consentAuditLog)
        .where(
          and(
            eq(consentAuditLog.event, "guardian_revoke_requested"),
            eq(consentAuditLog.childUserId, samiraId),
          ),
        );
      expect(audit.length).toBe(1);
    });

    it("regrant restores accountStatus=active and unlocks login", async () => {
      const samiraId = await makeSamiraAMinor();

      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const revoke = await lisa.post(
        `/api/v1/guardians/children/${samiraId}/revoke-consent`,
      );
      expect(revoke.status).toBe(200);

      // Child can still mint a fresh session cookie (login itself is
      // not gated by pending_revocation), but the very next request
      // through the account-status middleware must fail.
      const blockedAgent = request.agent(app);
      const blockedLogin = await blockedAgent
        .post("/api/v1/auth/login")
        .send({ email: "samira@kinectem.demo", password: DEMO_PASSWORD });
      expect(blockedLogin.status).toBe(200);
      const blockedMe = await blockedAgent.get("/api/v1/users/me");
      expect(blockedMe.status).toBe(401);

      const regrant = await lisa.post(
        `/api/v1/guardians/children/${samiraId}/regrant-consent`,
      );
      expect(regrant.status).toBe(200);
      expect(regrant.body.accountStatus).toBe("active");

      const [child] = await db
        .select({
          accountStatus: users.accountStatus,
          consentRevokedAt: users.consentRevokedAt,
          consentFinalizedAt: users.consentFinalizedAt,
        })
        .from(users)
        .where(eq(users.id, samiraId));
      expect(child.accountStatus).toBe("active");
      expect(child.consentRevokedAt).toBeNull();
      expect(child.consentFinalizedAt).toBeTruthy();

      const ok = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: "samira@kinectem.demo", password: DEMO_PASSWORD });
      expect(ok.status).toBe(200);

      const audit = await db
        .select({ event: consentAuditLog.event })
        .from(consentAuditLog)
        .where(eq(consentAuditLog.childUserId, samiraId));
      const events = audit.map((r) => r.event);
      expect(events).toContain("guardian_revoke_requested");
      expect(events).toContain("guardian_consent_regranted");
    });

    it("only the linked guardian can revoke a child's consent", async () => {
      const samiraId = await makeSamiraAMinor();
      const { agent: stranger } = await loginAs(
        (u) => u.email === "marcus@kinectem.demo",
      );
      const res = await stranger.post(
        `/api/v1/guardians/children/${samiraId}/revoke-consent`,
      );
      expect(res.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // (4) Parent right-to-delete request → operator script hard-delete.
  //     The HTTP path is POST /guardians/.../request-deletion (Task
  //     #367); the operator then runs the @workspace/scripts purge.
  //     We invoke `hardDeleteUserCli` directly — it skips the cooling-
  //     off + status guards baked into the CLI entry point so tests
  //     don't have to fake a 24h-old request.
  // -------------------------------------------------------------------------

  describe("right-to-delete: request → hard-delete (#367)", () => {
    it("guardian request flips the child to pending_deletion and locks them out; operator purge removes the row", async () => {
      const samiraId = await makeSamiraAMinor();

      // Verify the child can log in and see /me before the request.
      const { agent: childBefore } = await loginAs(
        (u) => u.email === "samira@kinectem.demo",
      );
      expect((await childBefore.get("/api/v1/users/me")).status).toBe(200);

      const { agent: lisa } = await loginAs(
        (u) => u.email === "lisa@kinectem.demo",
      );
      const first = await lisa.post(
        `/api/v1/guardians/children/${samiraId}/request-deletion`,
      );
      expect(first.status).toBe(200);
      expect(first.body.accountStatus).toBe("pending_deletion");

      // Idempotent: second call must NOT push the timestamp forward.
      const [afterFirst] = await db
        .select({ ts: users.deletionRequestedAt })
        .from(users)
        .where(eq(users.id, samiraId));
      expect(afterFirst.ts).toBeTruthy();
      const second = await lisa.post(
        `/api/v1/guardians/children/${samiraId}/request-deletion`,
      );
      expect(second.status).toBe(200);
      const [afterSecond] = await db
        .select({ ts: users.deletionRequestedAt })
        .from(users)
        .where(eq(users.id, samiraId));
      expect(afterSecond.ts!.getTime()).toBe(afterFirst.ts!.getTime());

      // Existing cookie session is rejected on the next request.
      const meAfter = await childBefore.get("/api/v1/users/me");
      expect(meAfter.status).toBe(401);

      // A fresh session cookie also gets shut down on the next
      // request — login itself is not the gate, the auth middleware
      // is. (Same shape as the revoke test above.)
      const freshAgent = request.agent(app);
      const freshLogin = await freshAgent
        .post("/api/v1/auth/login")
        .send({ email: "samira@kinectem.demo", password: DEMO_PASSWORD });
      expect(freshLogin.status).toBe(200);
      const freshMe = await freshAgent.get("/api/v1/users/me");
      expect(freshMe.status).toBe(401);

      // Audit row written.
      const audit = await db
        .select()
        .from(consentAuditLog)
        .where(
          and(
            eq(consentAuditLog.event, "guardian_deletion_requested"),
            eq(consentAuditLog.childUserId, samiraId),
          ),
        );
      expect(audit.length).toBeGreaterThanOrEqual(1);

      // Operator runs the purge. `hardDeleteUserCli` is the test-only
      // entry that skips the cooling-off window check; the CLI wrapper
      // (`pnpm coppa:delete`) keeps that guard for production use.
      await hardDeleteUserCli(samiraId);

      const remaining = await db
        .select()
        .from(users)
        .where(eq(users.id, samiraId));
      expect(remaining.length).toBe(0);
    });

    it("only the linked guardian can request deletion for a child", async () => {
      const samiraId = await makeSamiraAMinor();
      const { agent: stranger } = await loginAs(
        (u) => u.email === "marcus@kinectem.demo",
      );
      const res = await stranger.post(
        `/api/v1/guardians/children/${samiraId}/request-deletion`,
      );
      expect(res.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // (5) Parent-driven guardian-confirm recovery (#371). The
  //     `/auth/guardian-resend-by-email` happy path is already covered
  //     in auth.test.ts; this exercises the cross-task chain — the
  //     legacy guardian-confirm token rotated by the recovery endpoint
  //     can be redeemed via /auth/guardian-confirm to unlock the
  //     account, regardless of whatever the child's last (now stale)
  //     token was.
  // -------------------------------------------------------------------------

  describe("parent-driven guardian-confirm recovery (#371)", () => {
    it("rotates the token, sends a fresh email, and the new token unlocks the account", async () => {
      // Provision an under-13 athlete via the legacy single-step
      // guardian-confirm path (the recovery endpoint is constrained
      // to `pending_guardian` accounts and that's exactly where the
      // signup leaves them).
      const { email, password, guardianEmail } = await signupUnder13();
      // Recovery is independent of whatever token the child holds —
      // we don't even read the original notice token here.

      const before = sentEmails.length;
      const recover = await request(app)
        .post("/api/v1/auth/guardian-resend-by-email")
        .send({ guardianEmail });
      expect(recover.status).toBe(200);
      // Generic 200 — must not branch on existence.
      expect(recover.body.ok).toBe(true);
      expect(typeof recover.body.message).toBe("string");

      // A fresh `/guardian-confirm/<token>` email landed for the
      // guardian.
      const fresh = sentEmails
        .slice(before)
        .find(
          (m) => m.to === guardianEmail && /\/guardian-confirm\//.test(m.text),
        );
      expect(fresh, "expected a fresh /guardian-confirm/ email").toBeDefined();
      const newToken = fresh!.text.match(
        /\/guardian-confirm\/([A-Za-z0-9_-]+)/,
      )![1];

      // Before redeeming, prove the resent token actually rotated the
      // hash on the user row — i.e. the recovery endpoint persisted
      // exactly what it emailed, not a different token.
      const expectedHash = (await import("node:crypto"))
        .createHash("sha256")
        .update(newToken)
        .digest("hex");
      const [preConfirm] = await db
        .select({
          hash: users.guardianConfirmTokenHash,
          confirmedAt: users.guardianConfirmedAt,
          accountStatus: users.accountStatus,
        })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      expect(preConfirm.hash).toBe(expectedHash);
      expect(preConfirm.confirmedAt).toBeNull();
      expect(preConfirm.accountStatus).toBe("pending_guardian");

      // The legacy guardian-confirm endpoint redeems the resent token
      // — proving the recovery email is actually usable by the parent,
      // not just delivered. After confirm, the guardian-confirm hash
      // is cleared and `guardianConfirmedAt` is stamped. (We don't go
      // all the way to a successful login here because the new
      // email-plus signup leaves a `parental_consents` row in
      // `pending_notice` whose finalize step is exercised in detail
      // by the consent-ceremony test above; account-level "unlocks
      // login" is asserted there end-to-end.)
      const confirm = await request(app)
        .post("/api/v1/auth/guardian-confirm")
        .send({ token: newToken, guardianEmail });
      expect(confirm.status).toBe(200);

      const [postConfirm] = await db
        .select({
          hash: users.guardianConfirmTokenHash,
          confirmedAt: users.guardianConfirmedAt,
        })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      expect(postConfirm.hash).toBeNull();
      expect(postConfirm.confirmedAt).toBeTruthy();
      void password;
    });

    it("returns the same generic 200 for an unknown guardian email and sends nothing", async () => {
      const before = sentEmails.length;
      const res = await request(app)
        .post("/api/v1/auth/guardian-resend-by-email")
        .send({ guardianEmail: `ghost-${Date.now()}@kinectem.test` });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(sentEmails.length).toBe(before);
    });
  });
});
