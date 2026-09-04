import { describe, expect, it } from "vitest";
import { moderationTabFromSearch } from "./AdminModeration";

describe("moderationTabFromSearch", () => {
  it("opens Org claims for existing claim-review email links", () => {
    expect(moderationTabFromSearch("?claimId=claim-123")).toBe("org-claims");
  });

  it("opens the explicitly requested moderation tab", () => {
    expect(moderationTabFromSearch("?tab=org-claims&claimId=claim-123")).toBe(
      "org-claims",
    );
    expect(moderationTabFromSearch("?tab=competitions")).toBe("competitions");
  });

  it("defaults safely to Reports for unknown tabs", () => {
    expect(moderationTabFromSearch("?tab=unknown")).toBe("reports");
  });
});