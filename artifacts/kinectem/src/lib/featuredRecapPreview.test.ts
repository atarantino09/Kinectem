import { describe, expect, it } from "vitest";
import { featuredRecapPreviewText } from "./featuredRecapPreview";

const id = "976d5e6f-3e99-4a9f-aef6-43b1034c94e5";

describe("competition recap preview mentions", () => {
  it("shows only a person's name instead of the stored mention token", () => {
    expect(featuredRecapPreviewText({
      body: `A strong performance.\n\nStrong clutch stops from @[Adelyn Messina](user:${id}) helped the team.`,
      summary: null,
    })).toBe("Strong clutch stops from Adelyn Messina helped the team.");
  });

  it("removes plain @ prefixes, including mentions next to punctuation", () => {
    expect(featuredRecapPreviewText({
      body: "After halftime, renewed energy.@Marissa created magic with a cross that @Priya finished",
      summary: null,
    })).toBe("After halftime, renewed energy.Marissa created magic with a cross that Priya finished");
  });

  it("cleans mentions before choosing a later sentence", () => {
    expect(featuredRecapPreviewText({
      body: `Great teamwork. @[Avery](user:${id}) scored the winner.`,
      summary: null,
    })).toBe("Avery scored the winner.");
  });

  it("cleans multiple mentions and Unicode names in the summary fallback", () => {
    expect(featuredRecapPreviewText({
      body: " ",
      summary: `@[Zoë](user:${id}) and @Élodie worked together.`,
    })).toBe("Zoë and Élodie worked together.");
  });

  it("preserves email addresses and unrelated text", () => {
    expect(featuredRecapPreviewText({
      body: "Contact coach@example.com or coach+team@example.com for details",
      summary: null,
    })).toBe("Contact coach@example.com or coach+team@example.com for details");
  });

  it("does not change the stored recap or turn preview names into links", () => {
    const recap = { body: `@[Avery](user:${id}) played well`, summary: null };
    expect(featuredRecapPreviewText(recap)).toBe("Avery played well");
    expect(recap.body).toBe(`@[Avery](user:${id}) played well`);
  });
});
