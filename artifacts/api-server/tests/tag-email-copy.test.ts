import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendTagNotificationEmail } from "../src/lib/email";

// Focused unit coverage for the body copy `sendTagNotificationEmail`
// generates. The integration tests in `tag-emails.test.ts` mock the
// helper itself (so they only see subject + recipient), which leaves the
// pending-vs-approved body text uncovered. Hitting the real helper here
// — with a stubbed SendGrid env + fetch — locks the wording in.
describe("sendTagNotificationEmail body copy", () => {
  let originalKey: string | undefined;
  let originalFrom: string | undefined;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalKey = process.env.SENDGRID_API_KEY;
    originalFrom = process.env.EMAIL_FROM;
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

  function lastSentBody(): {
    subject: string;
    text: string;
    html: string | undefined;
  } {
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    const text = body.content.find(
      (c: { type: string; value: string }) => c.type === "text/plain",
    )?.value;
    const html = body.content.find(
      (c: { type: string; value: string }) => c.type === "text/html",
    )?.value;
    return { subject: body.subject, text, html };
  }

  it("includes the post link and a plain 'you were tagged' line for approved tags", async () => {
    await sendTagNotificationEmail("jordan@example.com", {
      postTitle: "Game-winning catch",
      postUrl: "https://kinectem.example/posts/highlight-abc",
      pending: false,
    });
    const { subject, text, html } = lastSentBody();
    expect(subject).toBe('You were tagged in "Game-winning catch"');
    // Body must surface the title and the link so a reader who scans
    // only the body still knows what they were tagged in and where to
    // open it. The "review and approve" prompt MUST NOT appear here —
    // that wording is reserved for the pending branch.
    expect(text).toContain('You were tagged in "Game-winning catch"');
    expect(text).toContain("https://kinectem.example/posts/highlight-abc");
    expect(text.toLowerCase()).not.toContain("review");
    expect(text.toLowerCase()).not.toContain("approve");
    expect(html).toContain("https://kinectem.example/posts/highlight-abc");
  });

  it("uses 'review and approve' wording in the body for pending-consent tags", async () => {
    await sendTagNotificationEmail("samira@example.com", {
      postTitle: "Practice clip",
      postUrl: "https://kinectem.example/posts/highlight-xyz",
      pending: true,
    });
    const { subject, text, html } = lastSentBody();
    expect(subject).toBe('Please review a tag on you in "Practice clip"');
    // The pending body must call out both actions the recipient can
    // take ("approve" and "remove") and include the link to act on.
    expect(text).toContain("Practice clip");
    expect(text).toContain("https://kinectem.example/posts/highlight-xyz");
    expect(text.toLowerCase()).toContain("approve");
    expect(text.toLowerCase()).toContain("remove");
    expect(html?.toLowerCase()).toContain("approve");
  });
});
