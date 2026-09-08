import { describe, expect, it } from "vitest";
import { getClaimOrgRedirect } from "./ClaimOrgPage";

describe("organization claim-link redirect", () => {
  it("sends a signed-out recipient straight to account creation and returns to auto-claim", () => {
    const redirect = getClaimOrgRedirect({
      organizationId: "org-123",
      token: "secret/token",
      alreadyClaimed: false,
      signedIn: false,
    });
    const [path, search = ""] = redirect.split("?");
    const params = new URLSearchParams(search);

    expect(path).toBe("/login");
    expect(params.get("signup")).toBe("1");
    expect(params.get("returnTo")).toBe(
      "/organizations/org-123?claimToken=secret%2Ftoken&autoClaim=1",
    );
  });

  it("keeps signed-in and already-claimed recipients on the organization page", () => {
    expect(
      getClaimOrgRedirect({
        organizationId: "org-123",
        token: "token",
        alreadyClaimed: false,
        signedIn: true,
      }),
    ).toBe("/organizations/org-123?claimToken=token");
    expect(
      getClaimOrgRedirect({
        organizationId: "org-123",
        token: "token",
        alreadyClaimed: true,
        signedIn: false,
      }),
    ).toBe("/organizations/org-123?claimToken=token");
  });
});