// Task #818 — promo code auto-fill in the organizer outreach messages.
import { describe, expect, it } from "vitest";
import {
  buildCompetitionInviteMessage,
  resolveEffectivePromoCode,
} from "./competition-invite-message";

const base = {
  name: "Summer Cup",
  type: "tournament" as const,
  startDate: "2026-08-01",
  endDate: "2026-08-03",
  location: "Austin, TX",
  autoApproveClaims: true,
  url: "https://example.com/app/c/summer-cup",
};

describe("resolveEffectivePromoCode", () => {
  it("prefers the competition's own code", () => {
    expect(resolveEffectivePromoCode("COMP25", "HUB25")).toBe("COMP25");
  });
  it("falls back to the hub code when the competition's is blank", () => {
    expect(resolveEffectivePromoCode(null, "HUB25")).toBe("HUB25");
    expect(resolveEffectivePromoCode("   ", "HUB25")).toBe("HUB25");
    expect(resolveEffectivePromoCode(undefined, "HUB25")).toBe("HUB25");
  });
  it("returns null when neither is set", () => {
    expect(resolveEffectivePromoCode(null, null)).toBeNull();
    expect(resolveEffectivePromoCode("", "  ")).toBeNull();
  });
});

describe("buildCompetitionInviteMessage promo mention", () => {
  it("mentions the code and the 25% first-year discount when saved", () => {
    const msg = buildCompetitionInviteMessage({ ...base, promoCode: "SUMMER25" });
    expect(msg).toContain("promo code SUMMER25");
    expect(msg).toContain("25% off your first year");
  });

  it("reads normally without any promo mention when no code is saved", () => {
    for (const promoCode of [null, undefined, "", "   "]) {
      const msg = buildCompetitionInviteMessage({ ...base, promoCode });
      expect(msg).not.toContain("promo code");
      expect(msg).not.toContain("25% off");
    }
  });
});
