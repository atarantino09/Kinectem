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

describe("buildCompetitionInviteMessage", () => {
  it("builds the updated claim email with personalized event details", () => {
    const msg = buildCompetitionInviteMessage({ ...base, promoCode: "SUMMER25" });

    expect(msg).toContain(
      "Subject: Your team page for Summer Cup is ready to claim",
    );
    expect(msg).toContain("Summer Cup (August 1 – August 3, 2026)");
    expect(msg).toContain(
      "Kinectem is the youth-sports platform where the story of your season comes to life",
    );
    expect(msg).toContain("AI Assist is built right into the game recap composer");
    expect(msg).toContain(
      "1. Open the event page: https://example.com/app/c/summer-cup",
    );
    expect(msg).toContain(
      "your standalone team page can publish game recaps while the competition is active",
    );
    expect(msg).toContain("promo code SUMMER25");
    expect(msg).toContain("25% off your first year");
    expect(msg).toContain("competitions@kinectem.com");
  });

  it("leaves a visible promo-code placeholder when no code is saved", () => {
    for (const promoCode of [null, undefined, "", "   "]) {
      const msg = buildCompetitionInviteMessage({ ...base, promoCode });
      expect(msg).toContain("promo code [PROMO CODE]");
      expect(msg).toContain("25% off your first year");
    }
  });
});
