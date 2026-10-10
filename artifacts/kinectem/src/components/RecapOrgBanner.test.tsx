import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RecapOrgBanner } from "./RecapOrgBanner";
import { isGameRecapForOrgBranding, readRecapOrgIdentity, validHex } from "@/lib/recapOrgBrand";

const ctx = (o: object = {}) => ({
  type: "team", id: "t1", name: "U12", orgId: "o1", orgName: "Legacy Club",
  orgAvatarUrl: "/l.png", orgBrandPrimaryColor: "#123456", orgBrandSecondaryColor: "#abcdef", ...o,
});

describe("recap org identity", () => {
  it("brands regular recaps and combined recaps even without a game date", () => {
    expect(isGameRecapForOrgBranding({ id: "article-1", postType: "long", gameDate: "2026-10-10" })).toBe(true);
    expect(isGameRecapForOrgBranding({ id: "article-2", postType: "long", recapKind: "combined", gameDate: null })).toBe(true);
    for (const nonRecap of [
      { id: "article-3", postType: "long", articleKind: "practice_plan", gameDate: "2026-10-10" },
      { id: "article-4", postType: "long", gameDate: null },
      { id: "highlight-1", postType: "short", gameDate: "2026-10-10" },
      { id: "news-1", postType: "long", gameDate: "2026-10-10" },
      { id: "orgpost-1", postType: "long", gameDate: "2026-10-10" },
    ]) expect(isGameRecapForOrgBranding(nonRecap)).toBe(false);
  });
  it("returns null without an org", () => {
    expect(readRecapOrgIdentity(ctx({ orgId: null, orgName: null }))).toBeNull();
    expect(readRecapOrgIdentity({ type: "user", id: "u" })).toBeNull();
  });
  it("validates hex colors", () => {
    expect(validHex("red; x")).toBeNull();
    expect(validHex("#abc")).toBe("#abc");
    const id = readRecapOrgIdentity(ctx({ orgBrandPrimaryColor: "bad", orgBrandSecondaryColor: null }))!;
    expect(id.brand).toBeNull();
  });
  it("picks readable text for light, dark and mixed palettes", () => {
    const t = (a: string, b: string) => readRecapOrgIdentity(ctx({ orgBrandPrimaryColor: a, orgBrandSecondaryColor: b }))!.style.color;
    expect(t("#ffffff", "#f5f5dc")).toBe("#000000");
    expect(t("#101820", "#102030")).toBe("#ffffff");
    expect(t("#000000", "#ffffff")).toBe("#ffffff");
  });
  it("renders name, logo, and falls back to initials when broken or missing", () => {
    const org = readRecapOrgIdentity(ctx())!;
    render(<RecapOrgBanner org={org} postId="p" />);
    expect(screen.getByTestId("text-recap-org-name-p")).toHaveTextContent("LEGACY CLUB");
    expect(screen.getByRole("link")).toHaveAttribute("href", "/organizations/o1");
    fireEvent.error(screen.getByRole("img", { name: "Legacy Club logo" }));
    expect(screen.getByTestId("fallback-recap-org-logo-p")).toHaveTextContent("LC");
  });
  it("uses initials when logo missing", () => {
    render(<RecapOrgBanner org={readRecapOrgIdentity(ctx({ orgAvatarUrl: null }))!} postId="q" />);
    expect(screen.queryByRole("img")).toBeNull();
  });
  it("does not substitute a team's logo when the org has no logo", () => {
    expect(readRecapOrgIdentity(ctx({ orgAvatarUrl: null, avatarUrl: "/team.png" }))!.logoUrl).toBeNull();
  });
  it("keeps extremely long organization names on one readable line", () => {
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(140);
    const natural = vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(900);
    try {
      const name = "A very long organization name ".repeat(12).trim();
      render(<RecapOrgBanner org={readRecapOrgIdentity(ctx({ orgName: name }))!} postId="long" />);
      const line = screen.getByTestId("text-recap-org-name-long");
      expect(line).toHaveStyle({ fontSize: "13px" });
      expect(line).toHaveClass("whitespace-nowrap", "text-ellipsis", "overflow-hidden");
      expect(line).toHaveAttribute("title", name.toUpperCase());
    } finally {
      width.mockRestore();
      natural.mockRestore();
    }
  });
});
