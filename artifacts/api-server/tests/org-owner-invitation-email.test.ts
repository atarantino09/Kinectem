import { describe, expect, it } from "vitest";
import { buildOrgOwnerInvitationEmail } from "../src/lib/email";

describe("organization owner invitation email", () => {
  it("explains Kinectem, includes the private claim link, and lists setup steps", () => {
    const email = buildOrgOwnerInvitationEmail({
      to: "owner@example.com",
      organizationName: "Westfield Athletic Club",
      claimToken: "private-token",
    });

    expect(email.subject).toContain(
      "Become the owner of Westfield Athletic Club",
    );
    expect(email.text).toContain(
      "/app/claim/private-token",
    );
    expect(email.text).not.toContain("/app/org-claim-links/");
    expect(email.html).toMatch(
      /href="[^"]+\/app\/claim\/private-token"/,
    );
    expect(email.text).toContain(
      "Kinectem brings every team in your organization into one connected community",
    );
    expect(email.text).toContain(
      "a family on the U9 girls team can follow the season story of the U12 boys",
    );
    expect(email.html).toContain(
      "Game recaps from across the club flow to your organization page",
    );
    expect(email.text).toContain("create your Kinectem profile");
    expect(email.text).toContain("pre-invite message");
    expect(email.text).toContain("Bulk add coaches");
    expect(email.text).toContain("players and parents through Roster outreach");
    expect(email.text).toContain("Please do not forward it");
    expect(email.html).toContain('class="email-section"');
    expect(email.html).toContain('class="email-checklist-box"');
    expect(email.html).toContain("Claim organization");
    expect(email.html).toContain(
      "players and parents through Roster outreach using each team&#39;s secure invitation",
    );
    expect(email.kind).toBe("org_owner_invitation");
  });
});