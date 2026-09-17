import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  KINECTEM_INVITE_CONTEXT,
  buildCoachInviteHtml,
  buildCoachInviteText,
  buildStaffInviteHtml,
  buildStaffInviteText,
} from "@workspace/invite-copy";
import {
  buildInviteAcceptUrl,
  sendCompetitionAdminInviteEmail,
  sendCoachInviteEmail,
  sendGuardianLinkInviteEmail,
  sendOrganizationInviteEmail,
  sendStaffInviteEmail,
  sendEmail,
} from "../src/lib/email";

type SentEmail = {
  customArgs?: Record<string, string>;
  subject: string;
  text: string;
  html: string;
};

describe("invite email Kinectem context", () => {
  let originalKey: string | undefined;
  let originalFrom: string | undefined;
  let originalBase: string | undefined;
  let originalDevDomain: string | undefined;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalKey = process.env.SENDGRID_API_KEY;
    originalFrom = process.env.EMAIL_FROM;
    originalBase = process.env.APP_BASE_URL;
    originalDevDomain = process.env.REPLIT_DEV_DOMAIN;
    process.env.SENDGRID_API_KEY = "test-key";
    process.env.EMAIL_FROM = "noreply@kinectem.test";
    process.env.APP_BASE_URL = "https://kinectem.example";
    delete process.env.REPLIT_DEV_DOMAIN;
    fetchMock = vi.fn(async () => new Response("", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.SENDGRID_API_KEY;
    else process.env.SENDGRID_API_KEY = originalKey;
    if (originalFrom === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = originalFrom;
    if (originalBase === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = originalBase;
    if (originalDevDomain === undefined) delete process.env.REPLIT_DEV_DOMAIN;
    else process.env.REPLIT_DEV_DOMAIN = originalDevDomain;
    vi.unstubAllGlobals();
  });

  function lastSentEmail(): SentEmail {
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    const text = body.content.find(
      (content: { type: string; value: string }) =>
        content.type === "text/plain",
    )?.value as string;
    const html = body.content.find(
      (content: { type: string; value: string }) =>
        content.type === "text/html",
    )?.value as string;
    return {
      customArgs: body.personalizations[0].custom_args,
      subject: body.subject,
      text,
      html,
    };
  }

  function expectSharedContext(email: SentEmail): void {
    expect(email.text.split(KINECTEM_INVITE_CONTEXT)).toHaveLength(2);
    expect(email.html.split(KINECTEM_INVITE_CONTEXT)).toHaveLength(2);
    expect(email.text).toContain("youth-sports");
    expect(email.html).toContain("youth-sports");
  }

  it("includes context in organization invites and keeps values escaped", async () => {
    await sendOrganizationInviteEmail("recipient@example.com", {
      organizationName: "<North & South>",
      inviterDisplayName: "Ava <Admin>",
      role: "admin",
      token: "org-token",
      note: "Please review <this> & reply.",
      inviteId: "org-invite-id",
    });

    const email = lastSentEmail();
    expectSharedContext(email);
    expect(email.text).toContain("Open this link to accept:");
    expect(email.text).toContain("/app/org-invites/org-token");
    expect(email.html).toContain("&lt;North &amp; South&gt;");
    expect(email.html).toContain("Ava &lt;Admin&gt;");
    expect(email.html).toContain("Please review &lt;this&gt; &amp; reply.");
    expect(email.html).not.toContain("<North & South>");
    expect(email.customArgs).toEqual({
      kinectem_invite_id: "org-invite-id",
      kinectem_invite_kind: "org",
    });
  });

  it.each([
    ["hub", "competition hub"],
    ["competition", "competition"],
  ] as const)(
    "includes context in %s admin invites and keeps values escaped",
    async (targetKind, kindLabel) => {
      await sendCompetitionAdminInviteEmail("recipient@example.com", {
        targetName: "<Summer & Cup>",
        targetKind,
        inviterDisplayName: "Ava <Admin>",
        token: `admin-${targetKind}-token`,
      });

      const email = lastSentEmail();
      expectSharedContext(email);
      expect(email.text).toContain(`admin of the ${kindLabel}`);
      expect(email.text).toContain(
        `/app/admin-invites/admin-${targetKind}-token`,
      );
      expect(email.html).toContain("&lt;Summer &amp; Cup&gt;");
      expect(email.html).toContain("Ava &lt;Admin&gt;");
      expect(email.html).not.toContain("<Summer & Cup>");
    },
  );

  it("includes context in guardian-link invites and keeps values escaped", async () => {
    await sendGuardianLinkInviteEmail("recipient@example.com", {
      childName: "<Sam & Lee>",
      inviterName: "Ava <Parent>",
      relationshipType: "legal_guardian",
    });

    const email = lastSentEmail();
    expectSharedContext(email);
    expect(email.text).toContain("Family dashboard");
    expect(email.text).toContain("/app/family");
    expect(email.html).toContain("&lt;Sam &amp; Lee&gt;");
    expect(email.html).toContain("Ava &lt;Parent&gt;");
    expect(email.html).not.toContain("<Sam & Lee>");
  });

  it("keeps the richer parent and staff explanations in both MIME alternatives", () => {
    const coachVars = {
      coachName: "<Coach>",
      link: buildInviteAcceptUrl("coach-token"),
    };
    expect(buildCoachInviteText(coachVars)).toContain("game recap");
    expect(buildCoachInviteHtml(coachVars)).toContain("game recap");
    expect(buildCoachInviteText(coachVars)).toContain("private and safe");
    expect(buildCoachInviteHtml(coachVars)).toContain("private and safe");

    const staffVars = {
      inviterName: "<Inviter>",
      teamName: "<Team>",
      roleLabel: "Assistant Coach",
      link: buildInviteAcceptUrl("staff-token"),
    };
    expect(buildStaffInviteText(staffVars)).toContain(
      "Kinectem is where teams share game recaps",
    );
    expect(buildStaffInviteHtml(staffVars)).toContain(
      "Kinectem is where teams share game recaps",
    );
    expect(buildStaffInviteText(staffVars)).toContain("story of the season");
    expect(buildStaffInviteHtml(staffVars)).toContain("story of the season");
  });

  it("renders roster parent and staff email MIME alternatives through SendGrid", async () => {
    await sendCoachInviteEmail("recipient@example.com", {
      coachName: "Coach <Name>",
      token: "coach-token",
      inviteId: "roster-player-id",
    });
    let email = lastSentEmail();
    expect(email.text).toBe(
      buildCoachInviteText({
        coachName: "Coach <Name>",
        link: buildInviteAcceptUrl("coach-token"),
      }),
    );
    expect(email.html).toContain(
      buildCoachInviteHtml({
        coachName: "Coach <Name>",
        link: buildInviteAcceptUrl("coach-token"),
      }),
    );
    expect(email.html).toContain("Coach &lt;Name&gt;");

    fetchMock.mockClear();
    await sendStaffInviteEmail("recipient@example.com", {
      inviterName: "Coach <Name>",
      teamName: "Varsity <Team>",
      roleLabel: "Assistant Coach",
      token: "staff-token",
      inviteId: "roster-staff-id",
    });
    email = lastSentEmail();
    expect(email.text).toBe(
      buildStaffInviteText({
        inviterName: "Coach <Name>",
        teamName: "Varsity <Team>",
        roleLabel: "Assistant Coach",
        link: buildInviteAcceptUrl("staff-token"),
      }),
    );
    expect(email.html).toContain(
      buildStaffInviteHtml({
        inviterName: "Coach <Name>",
        teamName: "Varsity <Team>",
        roleLabel: "Assistant Coach",
        link: buildInviteAcceptUrl("staff-token"),
      }),
    );
    expect(email.html).toContain("Varsity &lt;Team&gt;");
  });

  it("gives text-only sends branded, escaped HTML without changing text or metadata", async () => {
    const text = [
      "Organization: <North & South>",
      "Requester: Ava <Admin>",
      "Review: https://kinectem.example/app/admin?claim=1&view=review",
    ].join("\n");

    await sendEmail({
      to: "operator@example.com",
      subject: "Partner claim: <North & South>",
      text,
      kind: "partner_org_claim_request",
      contextLabel: "<North & South>",
      customArgs: { kinectem_claim_id: "claim-id" },
    });

    const email = lastSentEmail();
    expect(email.text).toBe(text);
    expect(email.html).toContain("email-header-banner.png");
    expect(email.html).toContain("Partner claim: &lt;North &amp; South&gt;");
    expect(email.html).toContain(">Organization</span>");
    expect(email.html).toContain("&lt;North &amp; South&gt;");
    expect(email.html).toContain(">Requester</span>");
    expect(email.html).toContain("Review request");
    expect(email.html).not.toContain("<North & South>");
    expect(email.html).toContain(
      'href="https://kinectem.example/app/admin?claim=1&amp;view=review"',
    );
    expect(email.customArgs).toEqual({ kinectem_claim_id: "claim-id" });
  });
});
