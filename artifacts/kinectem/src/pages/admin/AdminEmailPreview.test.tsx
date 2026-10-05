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
  it("previews a published game recap with its reading link and default-on preference", () => {
    renderWithProviders(<AdminEmailPreview />);
    fireEvent.click(screen.getByTestId("button-template-game_recap"));
    const html = screen.getByTitle("Game recap preview").getAttribute("srcdoc") ?? "";
    expect(html).toContain("Coach Mike Davis");
    expect(html).toContain("posted a new recap");
    expect(html).toContain("Wolves rally for a 28–21 win");
    expect(html).toContain("/posts/article-preview-game-recap");
    expect(html).toContain("See it");
    expect(html).toContain("photo-and-video album");
    expect(html).toContain("Unsubscribe");
    expect(screen.getByText("New recaps & posts — enabled by default")).toBeInTheDocument();
    expect(screen.getByText("After publication or approval")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /send/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("button-preview-mobile"));
    expect(screen.getByTestId("email-preview-stage")).toHaveAttribute("data-viewport", "mobile");
    fireEvent.click(screen.getByTestId("button-preview-dark"));
    expect(screen.getByTestId("email-preview-stage")).toHaveAttribute("data-theme", "dark");
  });

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

    // Switch to the organization claim approval baseline.
    fireEvent.click(screen.getByTestId("button-template-org_claim_approved"));
    const iframe3 = screen.getByTitle("Organization claim approved preview");
    const claimHtml = iframe3.getAttribute("srcdoc") ?? "";
    expect(claimHtml).toContain("Ownership approved");
    expect(claimHtml).toContain("What ownership enables");
    expect(claimHtml).toContain("Finish your setup");
    expect(claimHtml.indexOf("Ownership approved")).toBeLessThan(
      claimHtml.indexOf("What ownership enables"),
    );
    expect(claimHtml.indexOf("What ownership enables")).toBeLessThan(
      claimHtml.indexOf("Finish your setup"),
    );

    // Switch to Schedule change
    fireEvent.click(screen.getByTestId("button-template-schedule_change"));
    const iframe4 = screen.getByTitle("Schedule change preview");
    expect(iframe4.getAttribute("srcdoc")).toContain(
      "Schedule Update: Wildcats Game",
    );

    fireEvent.click(screen.getByTestId("button-template-guardian_consent"));
    expect(screen.getByTitle("Guardian consent preview").getAttribute("srcdoc")).toContain(
      "Confirm Maya&#39;s participation",
    );

    fireEvent.click(screen.getByTestId("button-template-billing_trial"));
    expect(screen.getByTitle("Trial ending preview").getAttribute("srcdoc")).toContain(
      "Your Club Pro trial ends soon",
    );

    fireEvent.click(screen.getByTestId("button-template-weekly_digest"));
    expect(screen.getByTitle("Weekly digest preview").getAttribute("srcdoc")).toContain(
      "Your U14 Lightning week",
    );

    fireEvent.click(screen.getByTestId("button-template-activity_notification"));
    expect(screen.getByTitle("Activity notification preview").getAttribute("srcdoc")).toContain(
      "New team update",
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
