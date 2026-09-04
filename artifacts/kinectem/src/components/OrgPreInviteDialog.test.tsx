import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test";
import { toastSpy, useToastMock } from "@/test/mocks/toast";
import {
  buildOrganizationPreInviteMessage,
  OrgPreInviteDialog,
} from "./OrgPreInviteDialog";

vi.mock("@/hooks/use-toast", () => useToastMock);

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("OrgPreInviteDialog", () => {
  it("builds personalized plain-text copy for every intended role and the follow-up invite", () => {
    const message = buildOrganizationPreInviteMessage(
      "Westfield Athletic Club",
      "https://example.com/app/organizations/org-1",
    );
    expect(message).toContain("Westfield Athletic Club admins, coaches, players, and parents");
    expect(message).toContain("https://example.com/app/organizations/org-1");
    expect(message).toContain("follow-up email from Kinectem");
    expect(message).toContain("specific team invitation");
    expect(message).toContain(
      "the youth-sports platform where the story of your season comes to life",
    );
    expect(message).toContain(
      "the one we already use. They run our season. Kinectem makes it last.",
    );
    expect(message).toContain(
      "turns quick coach notes into polished recaps, tags every player",
    );
    expect(message).toContain(
      "It gives our club one living home for the moments that matter — without replacing the tools we already use.",
    );
    expect(message).toContain(
      "there is an AI Assist tool built in to game recap editor",
    );
    expect(message).not.toContain(
      "brings team updates, schedules, highlights, game recaps",
    );
  });

  it("copies the complete message and reports success", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    renderWithProviders(
      <OrgPreInviteDialog orgId="org-1" organizationName="Westfield Athletic Club" open onOpenChange={vi.fn()} />,
    );
    const message = (screen.getByTestId("text-org-pre-invite-message") as HTMLTextAreaElement).value;
    await user.click(screen.getByTestId("btn-copy-org-pre-invite"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(message));
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Pre-invite message copied" }));
  });

  it("falls back to the browser copy command when Clipboard API is unavailable", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", {
      value: execCommand,
      configurable: true,
    });
    renderWithProviders(
      <OrgPreInviteDialog orgId="org-1" organizationName="Westfield Athletic Club" open onOpenChange={vi.fn()} />,
    );
    await user.click(screen.getByTestId("btn-copy-org-pre-invite"));
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Pre-invite message copied" }));
  });

  it("reports copy failure and gives the exact re-entry location when an automatic prompt is dismissed", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("blocked"));
    renderWithProviders(
      <OrgPreInviteDialog orgId="org-1" organizationName="Westfield Athletic Club" open automatic onOpenChange={onOpenChange} />,
    );
    await user.click(screen.getByTestId("btn-copy-org-pre-invite"));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Couldn't copy" })));
    await user.click(screen.getByTestId("btn-dismiss-org-pre-invite"));
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({
      description: "Reopen it any time from Manage > Pre-invite message.",
    }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});