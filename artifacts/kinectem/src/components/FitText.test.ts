import { describe, expect, it } from "vitest";
import { fitFontSize } from "./FitText";

describe("fitFontSize", () => {
  it("keeps a normal organization name at the intended hero size", () => {
    expect(
      fitFontSize({ available: 560, natural: 480, max: 36, min: 14 }),
    ).toBe(36);
  });

  it("shrinks a long organization name only as much as needed", () => {
    expect(
      fitFontSize({ available: 480, natural: 720, max: 36, min: 14 }),
    ).toBe(24);
  });

  it("uses the minimum size only when even the scaled long name cannot fit", () => {
    expect(
      fitFontSize({ available: 180, natural: 720, max: 36, min: 14 }),
    ).toBe(14);
  });

  it("keeps the maximum size until a measurable container and font are available", () => {
    expect(
      fitFontSize({ available: 0, natural: 720, max: 36, min: 14 }),
    ).toBe(36);
    expect(
      fitFontSize({ available: 480, natural: 0, max: 36, min: 14 }),
    ).toBe(36);
  });
});