import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OrgPostLogo } from "./OrgPostLogo";
import { readRecapOrgIdentity, validHex } from "@/lib/recapOrgBrand";

const context = (overrides: object = {}) => ({
  type: "team", orgId: "org-1", orgName: "Legacy Club",
  orgAvatarUrl: "/club.png", orgBrandPrimaryColor: "#123456",
  orgBrandSecondaryColor: "#abcdef", ...overrides,
});

describe("shared organization post branding", () => {
  it("does not invent an org for independent teams or personal posts", () => {
    expect(readRecapOrgIdentity(context({ orgId: null, orgName: null }))).toBeNull();
    expect(readRecapOrgIdentity({ type: "user", id: "user-1" })).toBeNull();
  });
  it("reads direct organization updates and history from their actual org context", () => {
    expect(readRecapOrgIdentity({
      type: "organization", id: "org-1", name: "Legacy Club", avatarUrl: "/club.png",
      orgBrandPrimaryColor: "#123456",
    })).toMatchObject({ orgId: "org-1", orgName: "Legacy Club", logoUrl: "/club.png" });
  });
  it("validates colors and keeps light, dark and mixed palettes readable", () => {
    expect(validHex("red; x")).toBeNull();
    expect(validHex("#abc")).toBe("#abc");
    expect(readRecapOrgIdentity(context({ orgBrandPrimaryColor: "bad", orgBrandSecondaryColor: null }))!.brand).toBeNull();
    const color = (primary: string, secondary: string) =>
      readRecapOrgIdentity(context({ orgBrandPrimaryColor: primary, orgBrandSecondaryColor: secondary }))!.style.color;
    expect(color("#ffffff", "#f5f5dc")).toBe("#000000");
    expect(color("#101820", "#102030")).toBe("#ffffff");
    expect(color("#000000", "#ffffff")).toBe("#ffffff");
  });
  it("shows the org logo and handles a broken logo with org initials", () => {
    render(<OrgPostLogo org={readRecapOrgIdentity(context())!} postId="post-1" />);
    expect(screen.getByRole("img", { name: "Legacy Club logo" })).toHaveAttribute("src", "/club.png");
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByTestId("fallback-recap-org-logo-post-1")).toHaveTextContent("LC");
  });
  it("does not substitute a team logo for a missing org logo", () => {
    const org = readRecapOrgIdentity(context({ orgAvatarUrl: null, avatarUrl: "/team.png" }))!;
    expect(org.logoUrl).toBeNull();
    render(<OrgPostLogo org={org} postId="post-1" />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("LC")).toBeVisible();
  });
});
