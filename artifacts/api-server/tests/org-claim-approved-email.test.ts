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
    const html = email.html ?? "";
    expect(html).toContain("Ownership approved");
    expect(html).toContain("What ownership enables");
    expect(html).toContain("Finish your setup");
    expect(html.indexOf("Ownership approved")).toBeLessThan(
      html.indexOf("What ownership enables"),
    );
    expect(html.indexOf("What ownership enables")).toBeLessThan(
      html.indexOf("Finish your setup"),
    );
    expect(html.match(/Westfield Athletic Club/g)?.length).toBe(1);
    expect(html).not.toMatch(/[★✓●]/);
  });
});