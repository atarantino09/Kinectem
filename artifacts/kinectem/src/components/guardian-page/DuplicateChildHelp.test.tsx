import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DuplicateChildHelp } from "./DuplicateChildHelp";

describe("duplicate child cleanup help", () => {
  it("is discoverable and explains safe account-wide cleanup without triggering deletion", () => {
    render(<DuplicateChildHelp />);
    const details = screen.getByTestId("duplicate-child-help");
    expect(details).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("Already created a duplicate child?"));
    expect(details).toHaveTextContent("identify the correct profile to keep");
    expect(details).toHaveTextContent("coordinate with the other parent");
    expect(details).toHaveTextContent("Family → that child → Communication controls → Delete account");
    expect(details).toHaveTextContent("across all teams and all parents");
    expect(details).toHaveTextContent("locked immediately");
    expect(details).toHaveTextContent("30-day cooling-off period");
    expect(details).toHaveTextContent("automatic purge on day 30 is not guaranteed");
    expect(details).toHaveTextContent("Unlink removes your guardian connection");
    expect(details).toHaveTextContent("Removing a child from one team");
    expect(details).toHaveTextContent("No content, memberships, or consent history is merged or transferred automatically");
    expect(details).toHaveTextContent("Don’t unlink the last guardian or create more profiles");
    expect(screen.getByRole("link", { name: "Kinectem privacy support" })).toHaveAttribute("href", "mailto:hello@kinectem.com");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("opens directly from the team setup help destination", () => {
    render(<DuplicateChildHelp initiallyOpen />);
    expect(screen.getByTestId("duplicate-child-help")).toHaveAttribute("open");
  });
});
