import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/renderWithProviders";
import AdminEmailPreview from "./AdminEmailPreview";

vi.mock("@/components/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="mock-admin-layout">{children}</div>
  ),
}));

describe("AdminEmailPreview", () => {
  it("renders the default coach invite preview without a send action", () => {
    renderWithProviders(<AdminEmailPreview />);

    expect(screen.getByTestId("admin-email-preview")).toBeInTheDocument();
    expect(screen.getByText("Preview only")).toBeInTheDocument();
    expect(screen.getByText("Email template preview")).toBeInTheDocument();

    const iframe = screen.getByTitle("Coach invitation preview");
    const html = iframe.getAttribute("srcdoc") ?? "";
    expect(html).toContain(
      "You&#39;re invited to join Varsity Football on Kinectem",
    );
    expect(html).toContain(
      "Coach Mike Davis has invited you to join Varsity Football on Kinectem as a Coach.",
    );
    expect(html).toContain("hit the AI Assist button");
    expect(html).toContain("email-header-banner.png");
    expect(html).toContain("email-card");
    expect(html).toContain("/invites/preview-coach-invite");
    expect(html).toContain(
      "Every game recap adds another chapter to the story of the season.",
    );
    expect(html).toContain(
      "permanent, searchable archive of the team&#39;s journey",
    );
    expect(
      screen.queryByRole("button", { name: /send/i }),
    ).not.toBeInTheDocument();
  });

  it("switches between different email templates", () => {
    renderWithProviders(<AdminEmailPreview />);

    // Switch to Partner claim
    fireEvent.click(screen.getByTestId("button-template-partner_claim"));
    const iframe2 = screen.getByTitle("Partner claim preview");
    expect(iframe2.getAttribute("srcdoc")).toContain(
      "Partner club claim request: West Point",
    );
    expect(iframe2.getAttribute("srcdoc")).toContain("Andrew Tarantino");

    // Switch to Owner approval
    fireEvent.click(screen.getByTestId("button-template-owner_approval"));
    const iframe3 = screen.getByTitle("Owner approval preview");
    expect(iframe3.getAttribute("srcdoc")).toContain(
      "Ownership Request: U14 Lightning",
    );

    // Switch to Schedule change
    fireEvent.click(screen.getByTestId("button-template-schedule_change"));
    const iframe4 = screen.getByTitle("Schedule change preview");
    expect(iframe4.getAttribute("srcdoc")).toContain(
      "Schedule Update: Wildcats Game",
    );
  });

  it("switches the framed preview between desktop and mobile widths", () => {
    renderWithProviders(<AdminEmailPreview />);

    const stage = screen.getByTestId("email-preview-stage");
    expect(stage).toHaveAttribute("data-viewport", "desktop");

    fireEvent.click(screen.getByTestId("button-preview-mobile"));
    expect(stage).toHaveAttribute("data-viewport", "mobile");

    fireEvent.click(screen.getByTestId("button-preview-desktop"));
    expect(stage).toHaveAttribute("data-viewport", "desktop");
  });

  it("switches the framed preview between light and dark themes", () => {
    renderWithProviders(<AdminEmailPreview />);

    const stage = screen.getByTestId("email-preview-stage");
    expect(stage).toHaveAttribute("data-theme", "light");

    fireEvent.click(screen.getByTestId("button-preview-dark"));
    expect(stage).toHaveAttribute("data-theme", "dark");

    const iframe = screen.getByTitle("Coach invitation preview");
    const html = iframe.getAttribute("srcdoc") ?? "";
    expect(html).toContain("@media all");
    expect(html).not.toContain("@media (prefers-color-scheme: dark)");

    fireEvent.click(screen.getByTestId("button-preview-light"));
    expect(stage).toHaveAttribute("data-theme", "light");
  });
});
