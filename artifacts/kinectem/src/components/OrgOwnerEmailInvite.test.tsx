import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { customFetch } from "@workspace/api-client-react";
import { renderWithProviders } from "@/test";
import { toastSpy, useToastMock } from "@/test/mocks/toast";
import { OrgOwnerEmailInvite } from "./OrgOwnerEmailInvite";

vi.mock("@workspace/api-client-react", () => ({ customFetch: vi.fn() }));
vi.mock("@/hooks/use-toast", () => useToastMock);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(customFetch).mockResolvedValue({ data: { sent: true } });
});

describe("organization owner email invitation", () => {
  it("opens an email form and sends the existing secure owner invitation", async () => {
    const user = userEvent.setup();
    renderWithProviders(<OrgOwnerEmailInvite orgId="org-1" orgName="Example Club" />);
    expect(screen.getByText(/Sending an invitation does not assign ownership yet/)).toBeInTheDocument();
    await user.click(screen.getByTestId("btn-invite-org-owner"));
    const send = screen.getByTestId("btn-send-org-owner-invite");
    expect(send).toBeDisabled();
    await user.type(screen.getByLabelText("Owner email address"), "owner@club");
    expect(send).toBeDisabled();
    await user.type(screen.getByLabelText("Owner email address"), ".org");
    await user.click(send);
    await waitFor(() => expect(customFetch).toHaveBeenCalledWith(
      "/api/v1/admin/org-claim-links/org-1/email-owner-invite",
      { method: "POST", body: JSON.stringify({ email: "owner@club.org" }) },
    ));
    expect(await screen.findByRole("status")).toHaveTextContent("Owner invitation emailed to owner@club.org");
    expect(screen.queryByLabelText("Owner email address")).not.toBeInTheDocument();
  });

  it("preserves the email and displays a delivery error instead of reporting success", async () => {
    vi.mocked(customFetch).mockRejectedValue(new Error("Email is not configured."));
    const user = userEvent.setup();
    renderWithProviders(<OrgOwnerEmailInvite orgId="org-1" orgName="Example Club" />);
    await user.click(screen.getByTestId("btn-invite-org-owner"));
    await user.type(screen.getByLabelText("Owner email address"), "owner@club.org");
    await user.click(screen.getByTestId("btn-send-org-owner-invite"));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({
      title: "Couldn't send owner invitation",
      description: "Email is not configured.",
      variant: "destructive",
    })));
    expect(screen.getByLabelText("Owner email address")).toHaveValue("owner@club.org");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByTestId("btn-send-org-owner-invite")).toBeEnabled();
  });

  it("clears cancelled input without sending an invitation", async () => {
    const user = userEvent.setup();
    renderWithProviders(<OrgOwnerEmailInvite orgId="org-1" orgName="Example Club" />);
    await user.click(screen.getByTestId("btn-invite-org-owner"));
    await user.type(screen.getByLabelText("Owner email address"), "owner@club.org");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByTestId("btn-invite-org-owner"));
    expect(screen.getByLabelText("Owner email address")).toHaveValue("");
    expect(customFetch).not.toHaveBeenCalled();
  });
});
