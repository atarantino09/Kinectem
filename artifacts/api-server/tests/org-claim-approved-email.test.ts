import { describe, expect, it } from "vitest";
import { buildOrgClaimApprovedEmail } from "../src/lib/email";

describe("organization claim approval email", () => {
  it("confirms ownership and links into the ordered owner setup flow", () => {
    const email = buildOrgClaimApprovedEmail({
      to: "owner@example.com",
      organizationId: "org-123",
      organizationName: "Westfield Athletic Club",
    });

    expect(email.subject).toContain(
      "You're now the owner of Westfield Athletic Club",
    );
    expect(email.text).toContain(
      "/app/organizations/org-123?ownerSetup=1",
    );
    expect(email.text).toContain("pre-invite message");
    expect(email.text).toContain("Bulk add coaches");
    expect(email.text).toContain("players and parents through Roster outreach");
    expect(email.kind).toBe("org_claim_approved");
  });
});