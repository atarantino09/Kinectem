import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  db,
  notifications,
  rosterEntries,
  rosterInvites,
  users,
} from "@workspace/db";
import {
  COACH_INVITE_SUBJECT,
  buildCoachInviteHtml,
  buildCoachInviteText,
  buildStaffInviteHtml,
  buildStaffInviteText,
  staffInviteRoleLabel,
  staffInviteSubject,
} from "@workspace/invite-copy";
import { buildInviteAcceptUrl } from "../src/lib/email";
import { app, loginAs, request } from "./helpers";

// Task #636 — lock the coach email-invite branching + verbatim copy.
//
// `POST /teams/:teamId/invites` sends the coach's "join Kinectem" invite
// email (task #634) ONLY when the invited address has no Kinectem account;
// known addresses get the in-app roster notification fan-out instead. Both
// the trigger condition and the exact wording are easy to break silently in
// a future refactor, so we exercise the real route end-to-end.
//
// Rather than mock `sendCoachInviteEmail`, we stub the SendGrid env + global
// `fetch` (mirrors `tag-email-copy.test.ts`) so the genuine helper renders
// and "sends"; the captured request body proves the real subject/body match
// the canonical copy from `@workspace/invite-copy`.
async function getFootballTeamId(): Promise<string> {
  const orgs = await request(app).get("/api/v1/organizations");
  const org = orgs.body.data[0];
  const teams = await request(app).get(`/api/v1/organizations/${org.id}/teams`);
  const t = teams.body.data.find(
    (x: { name: string }) => x.name === "Varsity Football",
  );
  if (!t) throw new Error("Varsity Football missing from seed");
  return t.id;
}

describe("coach invite email (task #636)", () => {
  let originalKey: string | undefined;
  let originalFrom: string | undefined;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalKey = process.env.SENDGRID_API_KEY;
    originalFrom = process.env.EMAIL_FROM;
    // Populated env creds short-circuit `resolveCredentials` before the
    // Replit connector fetch, so the only `fetch` the route makes is the
    // SendGrid send we capture below.
    process.env.SENDGRID_API_KEY = "test-key";
    process.env.EMAIL_FROM = "noreply@kinectem.test";
    fetchMock = vi.fn(async () => new Response("", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.SENDGRID_API_KEY;
    else process.env.SENDGRID_API_KEY = originalKey;
    if (originalFrom === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = originalFrom;
    vi.unstubAllGlobals();
  });

  function lastSentEmail(): {
    to: string;
    subject: string;
    text: string;
    html: string | undefined;
  } {
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    const text = body.content.find(
      (c: { type: string; value: string }) => c.type === "text/plain",
    )?.value as string;
    const html = body.content.find(
      (c: { type: string; value: string }) => c.type === "text/html",
    )?.value as string | undefined;
    return {
      to: body.personalizations[0].to[0].email,
      subject: body.subject,
      text,
      html,
    };
  }

  it("emails an unknown address the verbatim approved invite copy", async () => {
    const { agent } = await loginAs((u) => u.email === "coach@kinectem.demo");
    const teamId = await getFootballTeamId();
    const email = `unknown-${Date.now()}@example.com`;

    fetchMock.mockClear();
    const res = await agent
      .post(`/api/v1/teams/${teamId}/invites`)
      .send({ email, position: "player", name: "Unknown Invitee" });
    expect(res.status).toBe(201);
    const token = res.body.token as string;
    expect(token).toBeTruthy();

    // Task #654 — a successful send reports emailSent=true and still carries
    // the public accept URL so the coach can copy-link regardless.
    expect(res.body.emailSent).toBe(true);
    expect(res.body.acceptUrl).toBe(buildInviteAcceptUrl(token));

    const sent = lastSentEmail();
    expect(sent.to).toBe(email);

    // The coach (not a minor) signs with their real display name; the link
    // lands on the `/app/invites/<token>` accept flow.
    const link = buildInviteAcceptUrl(token);
    expect(link).toContain(`/app/invites/${token}`);
    const vars = { coachName: "Coach Mike Davis", link };
    expect(sent.subject).toBe(COACH_INVITE_SUBJECT);
    expect(sent.text).toBe(buildCoachInviteText(vars));
    expect(sent.html).toContain(buildCoachInviteHtml(vars));
    expect(sent.html).toContain("email-header-banner.png");
    expect(sent.html).toContain("email-card");

    // The unknown address has no Kinectem account, so no roster entry /
    // notification fan-out happened — only the email went out.
    const lowered = email.toLowerCase();
    const [orphan] = await db
      .select()
      .from(users)
      .where(eq(users.email, lowered))
      .limit(1);
    expect(orphan).toBeUndefined();
  });

  // Task #837 — staff invitees (coach / assistant coach / manager) get the
  // staff-oriented invite email with the team name and role label substituted;
  // player/parent invites keep the parent copy (locked verbatim above).
  for (const [positionValue, roleLabel] of [
    ["coach", "Coach"],
    ["assistant_coach", "Assistant Coach"],
    ["manager", "Team Manager"],
  ] as const) {
    it(`emails the staff invite copy for a ${positionValue} invite`, async () => {
      const { agent } = await loginAs((u) => u.email === "coach@kinectem.demo");
      const teamId = await getFootballTeamId();
      const email = `staff-${positionValue}-${Date.now()}@example.com`;

      fetchMock.mockClear();
      const res = await agent
        .post(`/api/v1/teams/${teamId}/invites`)
        .send({ email, position: positionValue, name: "Staff Invitee" });
      expect(res.status).toBe(201);
      expect(res.body.emailSent).toBe(true);

      const sent = lastSentEmail();
      expect(sent.to).toBe(email);
      expect(staffInviteRoleLabel(positionValue)).toBe(roleLabel);
      const vars = {
        inviterName: "Coach Mike Davis",
        teamName: "Varsity Football",
        roleLabel,
        link: buildInviteAcceptUrl(res.body.token as string),
      };
      expect(sent.subject).toBe(staffInviteSubject("Varsity Football"));
      expect(sent.text).toBe(buildStaffInviteText(vars));
      expect(sent.html).toContain(buildStaffInviteHtml(vars));
      // Staff copy must speak to the invitee as staff, not a parent.
      expect(sent.text).toContain("Varsity Football");
      expect(sent.text).toContain(roleLabel);
      expect(sent.text).not.toContain("your player's account");
      // Task #843 — the recap-authoring + AI Assist pitch must appear in both
      // variants, with the role label substituted (and HTML-escaped: the em
      // dash sentence contains an apostrophe-free check, so match on the
      // stable "AI Assist" phrasing plus role framing).
      const article = /^[aeiou]/i.test(roleLabel) ? "an" : "a";
      expect(sent.text).toContain(
        `As ${article} ${roleLabel}, you&#39;ll`.replace("&#39;", "'"),
      );
      expect(sent.text).toContain("hit the AI Assist button");
      expect(sent.text).toContain("Minutes, not hours.");
      expect(sent.text).toContain(
        "Every game recap adds another chapter to the story of the season.",
      );
      expect(sent.text).toContain(
        "permanent, searchable archive of the team's journey",
      );
      expect(sent.html).toContain(`As ${article} ${roleLabel}, you&#39;ll`);
      expect(sent.html).toContain("hit the AI Assist button");
      expect(sent.html).toContain("Minutes, not hours.");
      expect(sent.html).toContain(
        "Every game recap adds another chapter to the story of the season.",
      );
      expect(sent.html).toContain(
        "permanent, searchable archive of the team&#39;s journey",
      );
      // The pitch sits between the "story of the season" paragraph and the
      // accept line in both variants.
      const textIdx = sent.text.indexOf("hit the AI Assist button");
      expect(textIdx).toBeGreaterThan(sent.text.indexOf("story of the season"));
      expect(textIdx).toBeLessThan(
        sent.text.indexOf("Accept the invite below"),
      );
    });
  }

  it("re-sends the staff copy for a pending staff invite", async () => {
    const { agent } = await loginAs((u) => u.email === "coach@kinectem.demo");
    const teamId = await getFootballTeamId();
    const email = `staff-resend-${Date.now()}@example.com`;

    fetchMock.mockClear();
    const created = await agent
      .post(`/api/v1/teams/${teamId}/invites`)
      .send({ email, position: "assistant_coach" });
    expect(created.status).toBe(201);

    fetchMock.mockClear();
    const [invite] = await db
      .select()
      .from(rosterInvites)
      .where(eq(rosterInvites.token, created.body.token as string))
      .limit(1);
    const res = await agent.post(
      `/api/v1/teams/${teamId}/invites/${invite.id}/resend`,
    );
    expect(res.status).toBe(200);
    expect(res.body.emailSent).toBe(true);

    const sent = lastSentEmail();
    const vars = {
      inviterName: "Coach Mike Davis",
      teamName: "Varsity Football",
      roleLabel: "Assistant Coach",
      link: buildInviteAcceptUrl(invite.token),
    };
    expect(sent.subject).toBe(staffInviteSubject("Varsity Football"));
    expect(sent.text).toBe(buildStaffInviteText(vars));
    expect(sent.html).toContain(buildStaffInviteHtml(vars));
  });

  it("uses the in-app notification fan-out (and sends no email) for a known address", async () => {
    const { agent } = await loginAs((u) => u.email === "coach@kinectem.demo");
    const teamId = await getFootballTeamId();

    // Morgan is a seeded athlete who is NOT on Varsity Football. Clear any
    // prior roster entry so we can assert the player-invite path creates none.
    const [morgan] = await db
      .select()
      .from(users)
      .where(eq(users.email, "morgan@kinectem.demo"))
      .limit(1);
    expect(morgan).toBeTruthy();
    await db
      .delete(rosterEntries)
      .where(
        and(
          eq(rosterEntries.teamId, teamId),
          eq(rosterEntries.userId, morgan.id),
        ),
      );

    fetchMock.mockClear();
    const res = await agent
      .post(`/api/v1/teams/${teamId}/invites`)
      .send({ email: "morgan@kinectem.demo", position: "player" });
    expect(res.status).toBe(201);

    // Task #654 — a known invitee is reached via in-app notification, so no
    // email is attempted: emailSent is null (not false). The accept URL is
    // still emitted for copy-link parity.
    expect(res.body.emailSent).toBeNull();
    expect(res.body.acceptUrl).toBe(buildInviteAcceptUrl(res.body.token));

    // Known address → no coach invite email.
    expect(fetchMock).not.toHaveBeenCalled();

    // Task #645 — a player invite to an existing account creates NO roster
    // entry (the matched account may be the parent, not the player). The
    // invitee is reached via an in-app roster_invite notification that links
    // to the `/invites/<token>` chooser instead.
    const [entry] = await db
      .select()
      .from(rosterEntries)
      .where(
        and(
          eq(rosterEntries.teamId, teamId),
          eq(rosterEntries.userId, morgan.id),
        ),
      )
      .limit(1);
    expect(entry).toBeUndefined();

    const notes = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, morgan.id),
          eq(notifications.kind, "roster_invite"),
        ),
      );
    expect(
      notes.some((n) => n.link?.includes(`/invites/${res.body.token}`)),
    ).toBe(true);
  });

  it("still creates the invite when email delivery fails (best-effort)", async () => {
    const { agent } = await loginAs((u) => u.email === "coach@kinectem.demo");
    const teamId = await getFootballTeamId();
    const email = `fails-${Date.now()}@example.com`;

    // SendGrid returns a hard error → `sendEmail` throws → the route's
    // best-effort catch must swallow it and still persist the invite.
    fetchMock.mockClear();
    fetchMock.mockResolvedValue(new Response("boom", { status: 500 }));

    const res = await agent
      .post(`/api/v1/teams/${teamId}/invites`)
      .send({ email, position: "player" });
    expect(res.status).toBe(201);
    const token = res.body.token as string;
    expect(token).toBeTruthy();
    expect(fetchMock).toHaveBeenCalled();

    // Task #654 — the copy-link fallback contract: a failed send must report
    // emailSent=false (NOT true) and still hand back the accept URL so the
    // coach can copy the link and message the invitee directly. This is the
    // exact regression the task guards against.
    expect(res.body.emailSent).toBe(false);
    expect(res.body.acceptUrl).toBe(buildInviteAcceptUrl(token));

    const [invite] = await db
      .select()
      .from(rosterInvites)
      .where(eq(rosterInvites.token, token))
      .limit(1);
    expect(invite).toBeTruthy();
    expect(invite.invitedEmail).toBe(email);
  });
});
