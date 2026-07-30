import { describe, expect, it } from "vitest";
import { pickBrandColorsFromPixels } from "./extractBrandColors";

// Build RGBA pixel data from [r,g,b,a,count] specs.
function pixels(
  specs: Array<[number, number, number, number, number]>,
): number[] {
  const out: number[] = [];
  for (const [r, g, b, a, n] of specs) {
    for (let i = 0; i < n; i++) out.push(r, g, b, a);
  }
  return out;
}

describe("pickBrandColorsFromPixels", () => {
  it("picks the two dominant distinct colors, ignoring white background and transparency", () => {
    const data = pixels([
      [255, 255, 255, 255, 500], // white background — ignored
      [0, 0, 0, 0, 200], // transparent — ignored
      [230, 120, 30, 255, 120], // orange (dominant mark)
      [20, 20, 20, 255, 80], // black outline (secondary)
    ]);
    const colors = pickBrandColorsFromPixels(data);
    expect(colors).not.toBeNull();
    // Primary is the orange, formatted lowercase #rrggbb.
    expect(colors!.primary).toMatch(/^#[0-9a-f]{6}$/);
    expect(colors!.primary).toBe("#e6781e");
    expect(colors!.secondary).toBe("#141414");
  });

  it("returns null secondary when the logo is effectively one color", () => {
    const data = pixels([
      [255, 255, 255, 255, 300],
      [10, 60, 200, 255, 150], // single blue
      [12, 62, 198, 255, 50], // near-identical shade — too close to count
    ]);
    const colors = pickBrandColorsFromPixels(data);
    expect(colors!.secondary).toBeNull();
  });

  it("returns null when there are no usable pixels", () => {
    expect(pickBrandColorsFromPixels(pixels([[255, 255, 255, 255, 50]]))).toBeNull();
    expect(pickBrandColorsFromPixels([])).toBeNull();
  });

  it("prefers a saturated mark over a larger gray area", () => {
    const data = pixels([
      [150, 150, 150, 255, 200], // gray area, bigger but unsaturated
      [200, 30, 40, 255, 100], // red mark, saturated → weighted up
    ]);
    const colors = pickBrandColorsFromPixels(data);
    expect(colors!.primary).toBe("#c81e28");
    expect(colors!.secondary).toBe("#969696");
  });
});
