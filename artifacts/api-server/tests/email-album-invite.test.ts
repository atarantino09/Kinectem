// Task #828 — recap emails invite recipients (esp. parents of active
// roster athletes, who hold album upload rights) to add their own photos
// to the recap's fan photo album. Highlights and org posts stay unchanged.
import { describe, it, expect } from "vitest";
import {
  buildTagEmail,
  buildTeamContentEmail,
  buildFirstRecapMilestoneEmail,
} from "../src/lib/email";
import type { DispatchBuildContext } from "../src/lib/notification-email";

const INVITE = /add them to the recap's photo-and-video album/i;

function ctx(overrides: Partial<DispatchBuildContext> = {}): DispatchBuildContext {
  return {
    to: "parent@example.com",
    recipientName: "Pat Parent",
    subjectName: "Georgia",
    isGuardianCopy: true,
    unsubscribeUrl: "https://example.com/unsub",
    ...overrides,
  };
}

describe("recap photo album invite line (task #828)", () => {
  it("guardian tag email for a recap includes the album line in text and html", () => {
    const msg = buildTagEmail(ctx(), {
      postTitle: "Big win",
      postUrl: "https://example.com/app/posts/article-x",
      isRecap: true,
    });
    expect(msg.text).toMatch(INVITE);
    expect(msg.html).toMatch(INVITE);
    // Footer still present after the invite line
    expect(msg.text).toContain("Unsubscribe");
  });

  it("tag email for a highlight does NOT include the album line", () => {
    const msg = buildTagEmail(ctx({ isGuardianCopy: false, subjectName: "Pat Parent" }), {
      postTitle: "Sick goal",
      postUrl: "https://example.com/app/posts/highlight-x",
      isRecap: false,
    });
    expect(msg.text).not.toMatch(INVITE);
    expect(msg.html).not.toMatch(INVITE);
  });

  it("team 'new recap' email includes the album line; highlight variant does not", () => {
    const recap = buildTeamContentEmail(ctx(), {
      teamName: "2014 Boys",
      actorName: "Coach Andy",
      title: "Win v STA",
      postUrl: "https://example.com/app/posts/article-x",
      contentLabel: "recap",
    });
    expect(recap.text).toMatch(INVITE);
    expect(recap.html).toMatch(INVITE);

    const highlight = buildTeamContentEmail(ctx(), {
      teamName: "2014 Boys",
      actorName: "Coach Andy",
      title: "Sick goal",
      postUrl: "https://example.com/app/posts/highlight-x",
      contentLabel: "highlight",
    });
    expect(highlight.text).not.toMatch(INVITE);
    expect(highlight.html).not.toMatch(INVITE);
  });

  it("first-recap milestone email includes the album line (incl. guardian copy)", () => {
    const msg = buildFirstRecapMilestoneEmail(ctx(), {
      recapTitle: "Big win",
      recapUrl: "https://example.com/app/posts/article-x",
    });
    expect(msg.text).toMatch(INVITE);
    expect(msg.html).toMatch(INVITE);
    expect(msg.text).toContain("Unsubscribe");
  });
});
