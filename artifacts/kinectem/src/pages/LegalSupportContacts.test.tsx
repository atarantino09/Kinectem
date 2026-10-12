import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { customFetch } from "@workspace/api-client-react";
import PrivacyPolicyPage from "./PrivacyPolicyPage";
import CoppaNoticePage from "./CoppaNoticePage";
import GuardianRevokePage from "./GuardianRevokePage";

vi.mock("@workspace/api-client-react", () => ({ customFetch: vi.fn() }));

describe("legal and guardian help contacts", () => {
  it.each([
    ["privacy policy", PrivacyPolicyPage],
    ["COPPA notice", CoppaNoticePage],
  ])("%s uses the general help mailbox for links and rights copy", (_, Page) => {
    render(<Page />);
    const links = screen.getAllByRole("link", { name: "hello@kinectem.com" });
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "mailto:hello@kinectem.com");
    }
    expect(document.body.textContent).toContain("hello@kinectem.com");
    expect(document.body.textContent).toContain("10 business days");
    expect(document.body.textContent).toContain("30-day cooling-off");
    expect(document.body.textContent).not.toContain("privacy@");
  });

  it("directs guardians to hello for deletion help after revocation", async () => {
    vi.mocked(customFetch).mockResolvedValueOnce({ athleteName: "Test Child" });
    window.history.pushState({}, "", "/guardian-revoke/test-token");
    render(<GuardianRevokePage />);
    fireEvent.click(screen.getByTestId("btn-revoke-confirm"));
    const result = await screen.findByTestId("block-revoke-ok");
    expect(result).toHaveTextContent("hello@kinectem.com");
    expect(result).toHaveTextContent("if you want their data deleted");
    expect(result).not.toHaveTextContent("privacy@");
  });
});
