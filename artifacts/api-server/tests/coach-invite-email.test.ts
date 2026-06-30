import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, notifications, rosterEntries, rosterInvites, users } from "@workspace/db";
import {
  COACH_INVITE_SUBJECT,
  buildCoachInviteHtml,
  buildCoachInviteText,
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
  const teams = await request(app).get(
    `/api/v1/organizations/${org.id}/teams`,
  );
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

    const sent = lastSentEmail();
    expect(sent.to).toBe(email);

    // The coach (not a minor) signs with their real display name; the link
    // lands on the `/app/invites/<token>` accept flow.
    const link = buildInviteAcceptUrl(token);
    expect(link).toContain(`/app/invites/${token}`);
    const vars = { coachName: "Coach Mike Davis", link };
    expect(sent.subject).toBe(COACH_INVITE_SUBJECT);
    expect(sent.text).toBe(buildCoachInviteText(vars));
    expect(sent.html).toBe(buildCoachInviteHtml(vars));

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

  it("uses the in-app notification fan-out (and sends no email) for a known address", async () => {
    const { agent } = await loginAs((u) => u.email === "coach@kinectem.demo");
    const teamId = await getFootballTeamId();

    // Morgan is a seeded athlete who is NOT on Varsity Football. Clear any
    // prior roster entry so this invite creates a fresh pending placement +
    // notification (the route skips both if an entry already exists).
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

    // Known address → no coach invite email.
    expect(fetchMock).not.toHaveBeenCalled();

    // A pending roster entry + in-app roster_invite notification were created.
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
    expect(entry).toBeTruthy();
    expect(entry.status).toBe("pending");

    const notes = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, morgan.id),
          eq(notifications.kind, "roster_invite"),
        ),
      );
    expect(notes.some((n) => n.link?.includes(`entryId=${entry.id}`))).toBe(
      true,
    );
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

    const [invite] = await db
      .select()
      .from(rosterInvites)
      .where(eq(rosterInvites.token, token))
      .limit(1);
    expect(invite).toBeTruthy();
    expect(invite.invitedEmail).toBe(email);
  });
});
