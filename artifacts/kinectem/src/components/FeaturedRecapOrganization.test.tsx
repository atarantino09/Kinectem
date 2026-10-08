import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FeaturedRecapOrganization, featuredOrgPalette } from "./FeaturedRecapOrganization";

const org = {
  id: "club",
  name: "Legacy Club",
  logoUrl: "/club-logo.png",
  brandPrimaryColor: "#123456",
  brandSecondaryColor: "#abcdef",
};

describe("featured recap organization branding", () => {
  it("features the author's organization logo and both organization colors", () => {
    render(<FeaturedRecapOrganization org={org} teamName="Legacy U12 Boys" />);
    expect(screen.getByRole("img", { name: "Legacy Club logo" })).toHaveAttribute("src", org.logoUrl);
    expect(screen.getByTestId("featured-recap-organization-name")).toHaveTextContent("Legacy Club");
    expect(screen.getByTestId("featured-recap-team-name").textContent?.trim()).toBe("Legacy U12 Boys");
    const style = screen.getByTestId("featured-recap-organization").getAttribute("style");
    expect(style).toContain("#123456");
    expect(style).toContain("#abcdef");
    expect(style).toContain("32%");
    expect(style).toContain("24%");
    expect(featuredOrgPalette(org)).toEqual({ primary: "#123456", secondary: "#abcdef" });
  });
  it("uses organization initials without inventing an event logo when its logo is missing", () => {
    render(<FeaturedRecapOrganization org={{ ...org, logoUrl: null }} teamName="Legacy U12 Boys" />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("LC")).toBeVisible();
  });
  it("keeps independent team cards usable without organization metadata", () => {
    render(<FeaturedRecapOrganization org={null} teamName="Independent U12" />);
    expect(screen.getByTestId("featured-recap-team-name")).toHaveTextContent("Independent U12");
    expect(featuredOrgPalette(null).primary).toBe("#64748b");
  });
  it("keeps long names on one line without shrinking below readable minimums", () => {
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(160);
    const natural = vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(800);
    const organizationName = "An exceptionally long organization name ".repeat(8).trim();
    const teamName = "An exceptionally long team name ".repeat(8).trim();
    try {
      render(<FeaturedRecapOrganization org={{ ...org, name: organizationName }} teamName={teamName} />);
      const orgLine = screen.getByTestId("featured-recap-organization-name");
      const teamLine = screen.getByTestId("featured-recap-team-name");
      expect(orgLine).toHaveStyle({ fontSize: "11px" });
      expect(teamLine).toHaveStyle({ fontSize: "12px" });
      for (const line of [orgLine, teamLine]) {
        expect(line).toHaveClass("whitespace-nowrap", "text-ellipsis", "overflow-hidden");
      }
      expect(orgLine).toHaveAttribute("title", organizationName);
      expect(teamLine).toHaveAttribute("title", teamName);
    } finally {
      width.mockRestore();
      natural.mockRestore();
    }
  });
});
