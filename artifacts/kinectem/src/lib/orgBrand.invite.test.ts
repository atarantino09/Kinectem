import { describe, expect, it } from "vitest";
import { orgInviteHeaderStyle, readOrgBrandColors } from "./orgBrand";

describe("invite header branding", () => {
  it("uses full-strength dark brand colors with white text", () => {
    const style = orgInviteHeaderStyle({ primary: "#002266", secondary: "#004488" });
    expect(style.color).toBe("#ffffff");
    expect(style.background).toContain("#002266");
    expect(style.background).toContain("#004488");
    expect(style.background).not.toContain("#0000008c");
  });
  it("uses black text on light brand colors", () => {
    expect(orgInviteHeaderStyle({ primary: "#ffffff", secondary: "#ffffcc" }).color).toBe("#000000");
  });
  it("shades mixed light/dark palettes for readable white text", () => {
    const style = orgInviteHeaderStyle({ primary: "#000", secondary: "#fff" });
    expect(style.color).toBe("#ffffff");
    expect(style.background).toContain("linear-gradient(#0000008c, #0000008c)");
    expect(style.background).toContain("#ffffff");
  });
  it("supports one configured brand color without inventing another color", () => {
    const colors = readOrgBrandColors({ brandPrimaryColor: "#123456" });
    expect(colors).toEqual({ primary: "#123456", secondary: "#123456" });
    expect(orgInviteHeaderStyle(colors!).background).toContain("#123456");
  });
});
