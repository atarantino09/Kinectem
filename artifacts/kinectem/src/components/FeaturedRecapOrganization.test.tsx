import { describe, it, expect } from "vitest";
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
    render(<FeaturedRecapOrganization org={org} />);
    expect(screen.getByRole("img", { name: "Legacy Club logo" })).toHaveAttribute("src", org.logoUrl);
    expect(screen.getByText("Legacy Club")).toBeVisible();
    const style = screen.getByTestId("featured-recap-organization").getAttribute("style");
    expect(style).toContain("#123456");
    expect(style).toContain("#abcdef");
    expect(featuredOrgPalette(org)).toEqual({ primary: "#123456", secondary: "#abcdef" });
  });
  it("uses organization initials without inventing an event logo when its logo is missing", () => {
    render(<FeaturedRecapOrganization org={{ ...org, logoUrl: null }} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("LC")).toBeVisible();
  });
  it("keeps independent team cards usable without organization metadata", () => {
    const { container } = render(<FeaturedRecapOrganization org={null} />);
    expect(container).toBeEmptyDOMElement();
    expect(featuredOrgPalette(null).primary).toBe("#64748b");
  });
});
