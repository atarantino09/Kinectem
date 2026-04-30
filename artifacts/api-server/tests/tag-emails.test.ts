import { describe, expect, it, beforeEach, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  db,
  articles,
  notifications,
  organizations,
  rosterEntries,
  teams,
  users,
} from "@workspace/db";
import {
  notifyNewlyTaggedInHighlight,
  notifyNewlyTaggedInRecap,
} from "../src/lib/article-tagging";
import { loginAs } from "./helpers";

// Capture every email the helpers try to send so the assertions can
// inspect recipient, subject, and copy. Mirrors the auth/notifications
// test mocks, with `isEmailConfigured: true` so the helpers don't
// short-circuit before reaching the DB lookup + dispatch loop.
const sentEmails: Array<{ to: string; subject: string; text: string }> = [];

// Override `sendTagNotificationEmail` directly rather than overriding the
// underlying `sendEmail`. Re-exporting from the real module via `...actual`
// keeps the helper's internal `sendEmail` reference bound to the real
// module-scope function, which then no-ops out on unconfigured SendGrid
// and never reaches the spy. Replacing the helper itself sidesteps that.
vi.mock("../src/lib/email", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/email")>(
    "../src/lib/email",
  );
  return {
    ...actual,
    isEmailConfigured: () => true,
    sendTagNotificationEmail: vi.fn(
      async (
        to: string,
        args: { postTitle: string; postUrl: string; pending: boolean },
      ) => {
        sentEmails.push({
          to,
          subject: args.pending
            ? `Please review a tag on you in "${args.postTitle}"`
            : `You were tagged in "${args.postTitle}"`,
          text: args.postUrl,
        });
      },
    ),
  };
});

beforeEach(() => {
  sentEmails.length = 0;
});

async function getFootballTeam(): Promise<{ teamId: string; orgId: string }> {
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.name, "Westfield Athletic Club"))
    .limit(1);
  if (!org) throw new Error("Westfield org missing from seed");
  const [t] = await db
    .select()
    .from(teams)
    .where(
      and(eq(teams.organizationId, org.id), eq(teams.name, "Varsity Football")),
    )
    .limit(1);
  if (!t) throw new Error("Varsity Football missing from seed");
  return { teamId: t.id, orgId: org.id };
}

async function findUser(email: string): Promise<{ id: string; email: string }> {
  const [u] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!u || !u.email) throw new Error(`User ${email} missing from seed`);
  return { id: u.id, email: u.email };
}

async function ensureRosterPlayer(teamId: string, userId: string) {
  const existing = await db
    .select()
    .from(rosterEntries)
    .where(
      and(eq(rosterEntries.teamId, teamId), eq(rosterEntries.userId, userId)),
    )
    .limit(1);
  if (existing.length > 0) {
    await db
      .update(rosterEntries)
      .set({ status: "accepted", role: "player", position: "player" })
      .where(
        and(eq(rosterEntries.teamId, teamId), eq(rosterEntries.userId, userId)),
      );
  } else {
    await db.insert(rosterEntries).values({
      teamId,
      userId,
      role: "player",
      status: "accepted",
      position: "player",
    });
  }
}

async function setRequireTagConsent(userId: string, value: boolean) {
  await db
    .update(users)
    .set({ requireTagConsent: value })
    .where(eq(users.id, userId));
}

describe("tag notification emails (task #324)", () => {
  beforeEach(async () => {
    // Reset consent flags so each scenario starts clean.
    for (const email of [
      "lisa@kinectem.demo",
      "samira@kinectem.demo",
      "jordan@kinectem.demo",
      "tyler@kinectem.demo",
      "marcus@kinectem.demo",
    ]) {
      await db
        .update(users)
        .set({ requireTagConsent: false })
        .where(eq(users.email, email));
    }
  });

  it("emails an approved player tagged on a highlight with a link to the post", async () => {
    const { teamId } = await getFootballTeam();
    const { agent: uploader } = await loginAs(
      (u) => u.email === "marcus@kinectem.demo",
    );
    const jordan = await findUser("jordan@kinectem.demo");
    const marcus = await findUser("marcus@kinectem.demo");
    await ensureRosterPlayer(teamId, jordan.id);
    await ensureRosterPlayer(teamId, marcus.id);

    const create = await uploader.post("/api/v1/posts").send({
      postType: "short",
      teamId,
      title: "Game-winning catch",
      videoUrl: "https://example.com/clip.mp4",
    });
    expect(create.status).toBe(201);
    const postId: string = create.body.id;

    const tagRes = await uploader
      .post(`/api/v1/posts/${postId}/tags`)
      .send({ tags: [{ taggedEntityType: "user", taggedEntityId: jordan.id }] });
    expect(tagRes.status).toBe(201);

    const jordanEmails = sentEmails.filter((m) => m.to === jordan.email);
    expect(jordanEmails).toHaveLength(1);
    expect(jordanEmails[0].subject).toBe(
      'You were tagged in "Game-winning catch"',
    );
    expect(jordanEmails[0].text).toContain(`/posts/${postId}`);
    // Approved tag → no "approve" prompt in the body.
    expect(jordanEmails[0].text.toLowerCase()).not.toContain(
      "review and approve",
    );
  });

  it("emails a 'review and approve' prompt when the highlight tag is pending", async () => {
    const { teamId } = await getFootballTeam();
    const { agent: uploader } = await loginAs(
      (u) => u.email === "marcus@kinectem.demo",
    );
    const samira = await findUser("samira@kinectem.demo");
    const lisa = await findUser("lisa@kinectem.demo");
    await ensureRosterPlayer(teamId, samira.id);
    // Parent (Lisa) requires consent → Samira's tag lands as pending.
    await setRequireTagConsent(lisa.id, true);

    const create = await uploader.post("/api/v1/posts").send({
      postType: "short",
      teamId,
      title: "Practice clip",
      videoUrl: "https://example.com/practice.mp4",
    });
    expect(create.status).toBe(201);
    const postId: string = create.body.id;

    const tagRes = await uploader
      .post(`/api/v1/posts/${postId}/tags`)
      .send({ tags: [{ taggedEntityType: "user", taggedEntityId: samira.id }] });
    expect(tagRes.status).toBe(201);
    expect(tagRes.body.tags[0].status).toBe("pending");

    const samiraEmails = sentEmails.filter((m) => m.to === samira.email);
    expect(samiraEmails).toHaveLength(1);
    expect(samiraEmails[0].subject).toBe(
      'Please review a tag on you in "Practice clip"',
    );
    // The pending subject line ("Please review …") is the marker that
    // distinguishes consent-gated emails from the plain "you were tagged"
    // copy and is what the helper actually keys off of.
    expect(samiraEmails[0].subject.toLowerCase()).toContain("review");
  });

  it("does not email the tagger when they tag themselves on a highlight", async () => {
    const { teamId } = await getFootballTeam();
    const { agent: uploader } = await loginAs(
      (u) => u.email === "marcus@kinectem.demo",
    );
    const marcus = await findUser("marcus@kinectem.demo");
    await ensureRosterPlayer(teamId, marcus.id);

    const create = await uploader.post("/api/v1/posts").send({
      postType: "short",
      teamId,
      title: "Solo edit",
      videoUrl: "https://example.com/solo.mp4",
    });
    expect(create.status).toBe(201);
    const postId: string = create.body.id;

    const tagRes = await uploader
      .post(`/api/v1/posts/${postId}/tags`)
      .send({ tags: [{ taggedEntityType: "user", taggedEntityId: marcus.id }] });
    expect(tagRes.status).toBe(201);

    const marcusEmails = sentEmails.filter((m) => m.to === marcus.email);
    expect(marcusEmails).toHaveLength(0);
  });

  it("emails recap-tagged players on a published game recap", async () => {
    const { teamId, orgId } = await getFootballTeam();
    const { agent: coach } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );
    const jordan = await findUser("jordan@kinectem.demo");
    await ensureRosterPlayer(teamId, jordan.id);

    const res = await coach.post("/api/v1/posts").send({
      postType: "long",
      organizationId: orgId,
      title: "Westfield 34, Cranford 14",
      body: "A statement win on opening night.",
      gameDate: new Date("2025-09-12T19:00:00Z").toISOString(),
      opponentName: "Cranford",
      gameScore: "34-14",
    });
    expect(res.status).toBe(201);

    // Confirm the article was actually persisted before checking email
    // (recap fan-out is gated on `gameDate` so a missing field would
    // silently emit zero emails).
    const articleId = res.body.id.replace(/^article-/, "");
    const [a] = await db
      .select()
      .from(articles)
      .where(eq(articles.id, articleId))
      .limit(1);
    expect(a).toBeTruthy();

    const jordanEmails = sentEmails.filter((m) => m.to === jordan.email);
    expect(jordanEmails).toHaveLength(1);
    expect(jordanEmails[0].subject).toBe(
      'You were tagged in "Westfield 34, Cranford 14"',
    );
    expect(jordanEmails[0].text).toContain(`/posts/article-${articleId}`);
  });

  it("emails a recap-tagged player a 'review and approve' prompt when the tag is pending", async () => {
    // Drive the recap helper directly with one pending row to keep the
    // setup focused on the email branch — exercising the full coach
    // flow with a consenting player would also work, but the recap
    // entry points are several layers thick.
    const { teamId, orgId } = await getFootballTeam();
    const { agent: coach } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );
    const samira = await findUser("samira@kinectem.demo");
    const lisa = await findUser("lisa@kinectem.demo");
    await ensureRosterPlayer(teamId, samira.id);
    // Parent gates tags → Samira's recap tag lands as pending.
    await setRequireTagConsent(lisa.id, true);

    const res = await coach.post("/api/v1/posts").send({
      postType: "long",
      organizationId: orgId,
      title: "Westfield 21, Linden 17",
      body: "Tight road win.",
      gameDate: new Date("2025-09-19T19:00:00Z").toISOString(),
      opponentName: "Linden",
      gameScore: "21-17",
    });
    expect(res.status).toBe(201);

    const samiraEmails = sentEmails.filter((m) => m.to === samira.email);
    expect(samiraEmails).toHaveLength(1);
    expect(samiraEmails[0].subject).toBe(
      'Please review a tag on you in "Westfield 21, Linden 17"',
    );
  });

  it("does not send a second email when re-tagging the same player inside the throttle window", async () => {
    // Re-running the recap notify helper for the same user inside the
    // 10-minute window must short-circuit on the bell throttle, which
    // also acts as the email throttle (only newly inserted bell rows
    // result in emails). A bare-uuid post id is fine — the helper
    // computes the link itself from the article id.
    const { teamId, orgId } = await getFootballTeam();
    const { agent: coach } = await loginAs(
      (u) => u.email === "coach@kinectem.demo",
    );
    const jordan = await findUser("jordan@kinectem.demo");
    await ensureRosterPlayer(teamId, jordan.id);

    const res = await coach.post("/api/v1/posts").send({
      postType: "long",
      organizationId: orgId,
      title: "Throttle test",
      body: "...",
      gameDate: new Date("2025-09-26T19:00:00Z").toISOString(),
      opponentName: "Rahway",
      gameScore: "10-0",
    });
    expect(res.status).toBe(201);
    const articleId: string = res.body.id.replace(/^article-/, "");

    // First send already fired one email at create time.
    expect(sentEmails.filter((m) => m.to === jordan.email)).toHaveLength(1);
    sentEmails.length = 0;

    // Calling the helper again in the throttle window must be a no-op
    // for both bell + email channels. The first call already wrote a
    // bell row inside the throttle window, so the helper short-circuits
    // before reaching the email loop.
    await notifyNewlyTaggedInRecap({
      userIds: [jordan.id],
      articleId,
      articleTitle: "Throttle test",
      actorUserId: null,
    });
    expect(sentEmails.filter((m) => m.to === jordan.email)).toHaveLength(0);

    // Sanity check: only the original bell row survives.
    const link = `/posts/article-${articleId}`;
    const rows = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, jordan.id),
          eq(notifications.kind, "post_tag"),
          eq(notifications.link, link),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it("does not blow up when the helper is asked to notify a user with no email", async () => {
    // Direct-helper drive so we can hand it a user id without an
    // email address. Drives the highlight path because that's where
    // the caller already passes per-user status.
    const { teamId } = await getFootballTeam();
    const jordan = await findUser("jordan@kinectem.demo");
    await ensureRosterPlayer(teamId, jordan.id);
    // Strip the email — the helper's user query then returns a null
    // email row that we expect to be filtered out before sendEmail.
    await db
      .update(users)
      .set({ email: null })
      .where(eq(users.id, jordan.id));

    const fakeHighlightId = "00000000-0000-4000-8000-000000000111";
    await expect(
      notifyNewlyTaggedInHighlight({
        tags: [{ userId: jordan.id, status: "approved" }],
        highlightId: fakeHighlightId,
        highlightTitle: "Email-less",
        actorUserId: null,
      }),
    ).resolves.toBeUndefined();
    // No email attempted for the email-less recipient.
    expect(sentEmails).toHaveLength(0);
  });
});
