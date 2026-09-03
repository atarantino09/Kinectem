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
  it("renders the live branded staff invite output without a send action", () => {
    renderWithProviders(<AdminEmailPreview />);

    expect(screen.getByTestId("admin-email-preview")).toBeInTheDocument();
    expect(screen.getByText("Preview only")).toBeInTheDocument();
    expect(screen.getByText("Coach invite email")).toBeInTheDocument();

    const iframe = screen.getByTitle("Coach invitation email preview");
    const html = iframe.getAttribute("srcdoc") ?? "";
    expect(html).toContain(
      "You&#39;re invited to join Varsity Football on Kinectem",
    );
    expect(html).toContain(
      "Coach Mike Davis has invited you to join Varsity Football on Kinectem as a Coach.",
    );
    expect(html).toContain("hit the AI Assist button");
    expect(html).toContain("logo-horizontal.png");
    expect(html).toContain("email-card");
    expect(html).toContain("/invites/preview-coach-invite");
    expect(screen.queryByRole("button", { name: /send/i })).not.toBeInTheDocument();
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
});