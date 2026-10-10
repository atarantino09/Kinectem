import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FeaturedRecapOrganization, featuredOrgPalette } from "./FeaturedRecapOrganization";
import { orgInviteHeaderStyle } from "@/lib/orgBrand";

const org = {
  id: "club",
  name: "Legacy Club",
  logoUrl: "/club-logo.png",
  brandPrimaryColor: "#123456",
  brandSecondaryColor: "#234567",
};

describe("featured recap organization branding", () => {
  it("features the author's organization logo and both organization colors", () => {
    render(<FeaturedRecapOrganization org={org} teamName="Legacy U12 Boys" />);
    expect(screen.getByRole("img", { name: "Legacy Club logo" })).toHaveAttribute("src", org.logoUrl);
    expect(screen.getByTestId("featured-recap-organization-name")).toHaveTextContent("Legacy Club");
    expect(screen.getByTestId("featured-recap-team-name").textContent?.trim()).toBe("Legacy U12 Boys");
    const style = screen.getByTestId("featured-recap-organization").getAttribute("style");
    expect(style).toContain("#123456");
    expect(style).toContain("#234567");
    expect(screen.getByTestId("featured-recap-organization")).toHaveStyle(
      orgInviteHeaderStyle({ primary: org.brandPrimaryColor, secondary: org.brandSecondaryColor }),
    );
    expect(style).not.toContain("color-mix");
    expect(screen.getByTestId("featured-recap-organization-name").parentElement).toHaveClass("text-inherit");
    expect(screen.getByTestId("featured-recap-team-name").parentElement).toHaveClass("text-inherit");
    expect(featuredOrgPalette(org)).toEqual({ primary: "#123456", secondary: "#234567" });
  });
  it.each([
    ["#102030", "#304050", "#ffffff"],
    ["#ffffff", "#eeeeee", "#000000"],
    ["#000000", "#ffffff", "#ffffff"],
  ])("keeps text readable for the %s / %s palette", (primary, secondary, color) => {
    render(<FeaturedRecapOrganization
      org={{ ...org, brandPrimaryColor: primary, brandSecondaryColor: secondary }}
      teamName="Legacy U12 Boys"
    />);
    expect(screen.getByTestId("featured-recap-organization")).toHaveStyle({
      ...orgInviteHeaderStyle({ primary, secondary }),
      color,
    });
  });
  it("uses the same neutral dark header as other org posts when colors are unset", () => {
    render(<FeaturedRecapOrganization
      org={{ ...org, brandPrimaryColor: null, brandSecondaryColor: null }}
      teamName="Legacy U12 Boys"
    />);
    expect(screen.getByTestId("featured-recap-organization")).toHaveStyle({
      background: "linear-gradient(135deg, #334155, #1e293b)",
      color: "#ffffff",
    });
  });
  it("uses organization initials without inventing an event logo when its logo is missing", () => {
    render(<FeaturedRecapOrganization org={{ ...org, logoUrl: null }} teamName="Legacy U12 Boys" />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("LC")).toBeVisible();
  });
  it("falls back when an organization logo fails to load", () => {
    render(<FeaturedRecapOrganization org={org} teamName="Legacy U12 Boys" />);
    fireEvent.error(screen.getByRole("img", { name: "Legacy Club logo" }));
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
