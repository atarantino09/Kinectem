import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { buildWeeklyDigestEmail } from "./send-weekly-digest";
import { buildInactivityNudgeEmail } from "./send-inactivity-nudge";
import { buildBillingReminderEmail } from "./send-billing-reminders";
import { buildTrialEndingReminderEmail } from "./send-trial-ending-reminders";
import { brandDailyAdminDigest } from "./send-daily-admin-digest";
import type { ResolvedRecipient } from "./lib/email-campaign";
import { escapeHtml } from "@workspace/email-template";

const originalBaseUrl = process.env.APP_BASE_URL;

before(() => {
  process.env.APP_BASE_URL = "https://kinectem.example";
});

after(() => {
  if (originalBaseUrl === undefined) delete process.env.APP_BASE_URL;
  else process.env.APP_BASE_URL = originalBaseUrl;
});

const recipient: ResolvedRecipient = {
  recipientUserId: "user-id",
  to: "family@example.com",
  recipientName: "Taylor Parent",
  subjectName: "Avery Athlete",
  isGuardianCopy: false,
  unsubscribeUrl:
    "https://kinectem.example/api/v1/notifications/unsubscribe/token?category=teamActivity",
};

function assertBranded(html: string, subject: string): void {
  assert.match(html, /<!doctype html>/);
  assert.match(html, /email-header-banner\.png/);
  assert.ok(html.includes(subject));
  assert.match(html, /class="email-card"/);
}

test("weekly digest preserves plaintext and unsubscribe compliance in the branded shell", () => {
  const email = buildWeeklyDigestEmail({
    recipient,
    activity: [
      {
        teamName: "Tigers <12U>",
        recapTitles: ["A & B Championship"],
        recapCount: 1,
        announcementCount: 1,
      },
    ],
  });

  assertBranded(email.html, email.subject);
  assert.match(email.text, /Tigers <12U>/);
  assert.match(email.text, /Unsubscribe:/);
  assert.match(email.html, /Unsubscribe from these emails/);
  assert.match(email.html, /Tigers &lt;12U&gt;/);
  assert.doesNotMatch(email.html, /Tigers <12U>/);
});

test("weekly guardian digest keeps names readable in text and escaped in HTML", () => {
  const email = buildWeeklyDigestEmail({
    recipient: {
      ...recipient,
      recipientName: "Taylor <Parent>",
      subjectName: "Avery & Athlete",
      isGuardianCopy: true,
    },
    activity: [
      {
        teamName: "Tigers",
        recapTitles: [],
        recapCount: 0,
        announcementCount: 1,
      },
    ],
  });

  assert.match(email.text, /teams Taylor <Parent>'s family follows/);
  assert.match(email.html, /Taylor &lt;Parent&gt;/);
  assert.doesNotMatch(email.html, /Taylor <Parent>/);
});

test("inactivity nudge preserves guardian routing copy and unsubscribe compliance", () => {
  const email = buildInactivityNudgeEmail({
    ...recipient,
    isGuardianCopy: true,
    subjectName: "Avery <Athlete>",
  });

  assertBranded(email.html, escapeHtml(email.subject));
  assert.match(email.text, /since Avery <Athlete>'s family checked in/);
  assert.match(email.text, /Unsubscribe:/);
  assert.match(email.html, /Avery &lt;Athlete&gt;/);
  assert.match(email.html, /Unsubscribe from these emails/);
});

test("billing reminder keeps its transaction text and organization context", () => {
  const email = buildBillingReminderEmail({
    adminName: "Jordan Admin",
    orgName: "North & South <Club>",
    plan: "starter",
    orgId: "org-id",
    billingStartsAt: new Date("2026-10-01T12:00:00.000Z"),
  });

  assertBranded(email.html, email.subject);
  assert.match(email.text, /North & South <Club>/);
  assert.match(email.html, /North &amp; South &lt;Club&gt;/);
  assert.match(email.html, /\/app\/organizations\/org-id\/subscribe/);
  assert.match(email.html, /class="email-facts"/);
  assert.match(email.html, /Your plan at a glance/);
  assert.match(email.html, /cancel any time before billing starts at no cost/);
});

test("trial-ending reminder keeps pricing copy and organization context", () => {
  const email = buildTrialEndingReminderEmail({
    adminName: "Jordan Admin",
    orgName: "North & South <Club>",
    plan: "pro",
    orgId: "org-id",
    billingStartsAt: new Date("2026-10-01T12:00:00.000Z"),
    promo: null,
  });

  assertBranded(email.html, email.subject);
  assert.match(email.text, /North & South <Club>/);
  assert.match(email.html, /North &amp; South &lt;Club&gt;/);
  assert.match(email.html, /Manage your plan/);
  assert.match(email.html, /Your first charge/);
});

test("daily operator digest retains compliance copy inside the Operations shell", () => {
  const html = brandDailyAdminDigest({
    subject: "Kinectem daily digest — September 2, 2026",
    html: [
      "<p>Activity for September 2, 2026</p>",
      "<p>You're receiving this operational digest because your address is on the Kinectem admin recipient list.</p>",
    ].join(""),
  });

  assertBranded(html, "Kinectem daily digest — September 2, 2026");
  assert.match(html, />Operations</);
  assert.match(html, /operational digest/);
});
