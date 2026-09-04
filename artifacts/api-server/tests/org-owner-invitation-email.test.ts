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
      "/app/org-claim-links/private-token",
    );
    expect(email.text).toContain(
      "Kinectem is the youth-sports platform where the story of your season comes to life",
    );
    expect(email.text).toContain("create your Kinectem profile");
    expect(email.text).toContain("pre-invite message");
    expect(email.text).toContain("Bulk add coaches");
    expect(email.text).toContain("players and parents through Roster outreach");
    expect(email.text).toContain("Please do not forward it");
    expect(email.kind).toBe("org_owner_invitation");
  });
});