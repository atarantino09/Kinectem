import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { InviteRosterDialog } from "./InviteRosterDialog";

const mocks = vi.hoisted(() => ({
  createJoinLink: vi.fn(),
  toast: vi.fn(),
  linkFails: false,
  sendInvite: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  useAddTeamMember: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateRosterInvite: () => ({ mutateAsync: mocks.sendInvite, isPending: false }),
  createRosterInvite: vi.fn(),
  useGetOrCreateTeamJoinLink: ({ mutation }: { mutation?: { onSuccess?: (response: { token: string }) => void; onError?: () => void } }) => {
    mocks.createJoinLink.mockImplementation(() => {
      if (mocks.linkFails) mutation?.onError?.();
      else mutation?.onSuccess?.({ token: "team-join-token" });
    });
    return { mutate: mocks.createJoinLink, isPending: false };
  },
  useGetLoggedInUser: () => ({
    data: { firstName: "Jordan", lastName: "Lee" },
  }),
  useSearchUsers: () => ({ data: { data: [] }, isFetching: false }),
  useListTeamMembers: () => ({ data: { data: [] } }),
  useListRosterInvites: () => ({ data: { data: [] } }),
  getListTeamMembersQueryKey: () => ["team-members"],
  getListRosterInvitesQueryKey: () => ["roster-invites"],
  queryOpts: (options: unknown) => options,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

beforeAll(() => {
  // Radix Select checks this pointer API while opening its portaled option list.
  // JSDOM does not implement it, although browsers do.
  Object.defineProperties(HTMLElement.prototype, {
    hasPointerCapture: { configurable: true, value: () => false },
    setPointerCapture: { configurable: true, value: () => undefined },
    releasePointerCapture: { configurable: true, value: () => undefined },
  });
});

beforeEach(() => {
  mocks.linkFails = false;
  mocks.toast.mockClear();
  mocks.createJoinLink.mockClear();
  mocks.sendInvite.mockReset();
  mocks.sendInvite.mockResolvedValue({ emailSent: true, acceptUrl: "https://example.test/invites/coach-specific-token", outcome: "invited" });
});

describe("InviteRosterDialog role-specific copy", () => {
  it("opens coach invitations directly with the coach role and never uses the family join link", async () => {
    const user = userEvent.setup();
    const props = { teamId: "team-1", seasonId: "season-1", teamName: "Falcons", onOpenChange: vi.fn() };
    const { rerender } = renderWithProviders(<InviteRosterDialog {...props} open />);
    await screen.findByTestId("text-invite-message");
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Invite parents & players");
    await user.click(screen.getByTestId("button-copy-invite-message"));
    await user.click(screen.getByTestId("button-invite-coaches"));
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Invite coaches");
    expect(screen.queryByTestId("invite-copy-share-panel")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /email/i })).toHaveAttribute("data-state", "active");
    expect(screen.getByTestId("select-email-invite-position")).toHaveTextContent("Head Coach");
    await user.type(screen.getByTestId("input-invite-email"), "coach@example.invalid");
    await user.click(screen.getByTestId("btn-send-invite"));
    expect(mocks.sendInvite).toHaveBeenCalledWith({
      teamId: "team-1", data: { email: "coach@example.invalid", seasonId: "season-1", position: "coach" },
    });
    expect(await screen.findByTestId("text-invite-accept-message")).toHaveTextContent("coach-specific-token");
    expect(screen.getByTestId("text-invite-accept-message")).not.toHaveTextContent("team-join-token");
    await user.click(screen.getByTestId("button-back-family-invites"));
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Invite parents & players");
    expect(await screen.findByTestId("text-invite-message")).toHaveTextContent("Set up your player's account");
    expect(screen.getByTestId("button-copy-invite-message")).toHaveTextContent("Copy parent/player message & link");
    expect(screen.getByTestId("other-invite-methods")).not.toHaveAttribute("open");
    await user.click(screen.getByTestId("button-invite-coaches"));
    expect(screen.getByTestId("input-invite-email")).toHaveValue("");
    rerender(<InviteRosterDialog {...props} open={false} />);
    rerender(<InviteRosterDialog {...props} open />);
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Invite parents & players");
  });

  it("lets managers retry preparing a failed invitation without copying an empty message", async () => {
    mocks.linkFails = true;
    const user = userEvent.setup();
    renderWithProviders(
      <InviteRosterDialog teamId="team-1" seasonId="season-1" teamName="Falcons" open onOpenChange={vi.fn()} />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't prepare the invitation message");
    expect(screen.queryByTestId("button-copy-invite-message")).not.toBeInTheDocument();
    expect(mocks.createJoinLink).toHaveBeenCalledOnce();
    mocks.linkFails = false;
    await user.click(screen.getByTestId("button-retry-invite-link"));
    expect(await screen.findByTestId("button-copy-invite-message")).toBeEnabled();
    expect(screen.getByTestId("text-invite-message")).toHaveTextContent("/invites/team-join-token");
    expect(mocks.createJoinLink).toHaveBeenCalledTimes(2);
  });

  it("puts full-message copying first and keeps other invite methods secondary", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    renderWithProviders(
      <InviteRosterDialog teamId="team-1" seasonId="season-1" teamName="Falcons" open onOpenChange={vi.fn()} />,
    );
    const copy = await screen.findByRole("button", { name: "Copy parent/player message & link" });
    const otherMethods = screen.getByTestId("other-invite-methods");
    expect(copy).toBeVisible();
    expect(copy).toHaveClass("bg-violet-700", "text-white");
    expect(screen.getByTestId("button-invite-coaches")).toHaveClass("bg-blue-600", "text-white");
    expect(screen.getByRole("heading", { name: "Invite parents & players", level: 3 })).toHaveClass("text-violet-900");
    expect(screen.getByText("Coach invitations")).toHaveClass("text-blue-800");
    expect(otherMethods).not.toHaveAttribute("open");
    expect(screen.getByTestId("input-roster-search")).not.toBeVisible();
    expect(screen.getByTestId("invite-link-only")).not.toHaveAttribute("open");
    expect(copy.compareDocumentPosition(otherMethods) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    await user.click(copy);
    expect(writeText).toHaveBeenCalledWith(screen.getByTestId("text-invite-message").textContent);
    expect(writeText.mock.calls.at(-1)?.[0]).toContain("/invites/team-join-token");
    expect(await screen.findByRole("button", { name: "Copied! Share with parents & players" })).toBeVisible();
  });

  it("returns to the primary family invitation after reopening from CSV", async () => {
    const user = userEvent.setup();
    const props = { teamId: "team-1", seasonId: "season-1", teamName: "Falcons", onOpenChange: vi.fn() };
    const { rerender } = renderWithProviders(<InviteRosterDialog {...props} open />);
    await screen.findByTestId("text-invite-message");
    await user.click(screen.getByTestId("other-invite-methods").querySelector("summary")!);
    await user.click(screen.getByRole("tab", { name: /import csv/i }));
    expect(screen.queryByTestId("text-invite-message")).not.toBeInTheDocument();
    rerender(<InviteRosterDialog {...props} open={false} />);
    rerender(<InviteRosterDialog {...props} open />);
    expect(await screen.findByTestId("text-invite-message")).toHaveTextContent("Set up your player's account");
    expect(screen.getByTestId("other-invite-methods")).not.toHaveAttribute("open");
  });

  it("reports clipboard failure without showing a false copied state", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("Clipboard blocked"));
    mocks.toast.mockClear();
    renderWithProviders(
      <InviteRosterDialog teamId="team-1" seasonId="season-1" teamName="Falcons" open onOpenChange={vi.fn()} />,
    );
    await user.click(await screen.findByRole("button", { name: "Copy parent/player message & link" }));
    expect(mocks.toast).toHaveBeenCalledWith({ title: "Couldn't copy message", variant: "destructive" });
    expect(screen.queryByRole("button", { name: /Copied! Share/ })).not.toBeInTheDocument();
  });

  it("keeps the shared message parent/player-only and explains CSV rows use their own roles", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <InviteRosterDialog
        teamId="team-1"
        seasonId="season-1"
        teamName="Falcons"
        open
        onOpenChange={vi.fn()}
      />,
    );

    const roleNotice = await screen.findByTestId("invite-message-role-notice");
    const message = await screen.findByTestId("text-invite-message");

    expect(roleNotice).toHaveTextContent(
      "For parents & players only — not coaches.",
    );
    expect(
      screen.getByText(/a group text, GroupMe, TeamSnap, or 360 Player/i),
    ).toBeInTheDocument();
    expect(message).toHaveTextContent("Set up your player's account");

    await user.click(screen.getByTestId("other-invite-methods").querySelector("summary")!);
    await user.click(screen.getByTestId("select-existing-invite-position"));
    await user.click(await screen.findByRole("option", { name: "Head Coach" }));

    expect(screen.getByTestId("invite-message-current-role")).toHaveTextContent(
      "For parents & players only — not coaches.",
    );
    expect(message).toHaveTextContent("Set up your player's account");
    expect(message).not.toHaveTextContent("as a Coach");

    await user.click(screen.getByRole("tab", { name: /email/i }));
    expect(screen.getByTestId("invite-message-current-role")).toHaveTextContent(
      "For parents & players only — not coaches.",
    );
    await user.click(screen.getByTestId("select-email-invite-position"));
    await user.click(await screen.findByRole("option", { name: "Team Manager" }));
    expect(screen.getByTestId("invite-message-current-role")).toHaveTextContent(
      "For parents & players only — not coaches.",
    );

    await user.click(screen.getByRole("tab", { name: /bulk/i }));
    expect(screen.getByTestId("invite-message-current-role")).toHaveTextContent(
      "For parents & players only — not coaches.",
    );
    await user.click(screen.getByTestId("select-bulk-invite-position"));
    await user.click(
      await screen.findByRole("option", { name: "Assistant Coach" }),
    );
    expect(screen.getByTestId("invite-message-current-role")).toHaveTextContent(
      "For parents & players only — not coaches.",
    );

    await user.click(screen.getByRole("tab", { name: /import csv/i }));
    expect(screen.queryByTestId("invite-message-role-notice")).not.toBeInTheDocument();
    expect(screen.queryByTestId("text-invite-message")).not.toBeInTheDocument();
    expect(screen.getByTestId("csv-invite-message-note")).toHaveTextContent(
      "CSV imports send each person an invite based on the role in their own row.",
    );
  });

  it("copies manually selected invite text as plain text", async () => {
    renderWithProviders(
      <InviteRosterDialog
        teamId="team-1"
        seasonId="season-1"
        teamName="Falcons"
        open
        onOpenChange={vi.fn()}
      />,
    );

    const message = await screen.findByTestId("text-invite-message");
    expect(message.textContent).toContain("/invites/team-join-token");
    const selection = window.getSelection();
    const range = document.createRange();
    const textNode = message.firstChild;
    if (!(textNode instanceof Text)) {
      throw new Error("Expected invite message to render as one plain text node");
    }
    const partialMessage = (message.textContent ?? "").slice(0, 42);
    range.setStart(textNode, 0);
    range.setEnd(textNode, partialMessage.length);
    selection?.removeAllRanges();
    selection?.addRange(range);

    const clipboardData = {
      clearData: vi.fn(),
      setData: vi.fn(),
    } as unknown as DataTransfer;
    const copyDefaultAction = fireEvent.copy(message, { clipboardData });

    expect(copyDefaultAction).toBe(false);
    expect(clipboardData.clearData).toHaveBeenCalledOnce();
    expect(clipboardData.setData).toHaveBeenCalledWith(
      "text/plain",
      partialMessage,
    );
    expect(clipboardData.setData).not.toHaveBeenCalledWith(
      "text/html",
      expect.anything(),
    );
  });

  it("keeps the Copy button on the same full plain-text message", async () => {
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
    renderWithProviders(
      <InviteRosterDialog
        teamId="team-1"
        seasonId="season-1"
        teamName="Falcons"
        open
        onOpenChange={vi.fn()}
      />,
    );

    const message = await screen.findByTestId("text-invite-message");
    await user.click(screen.getByTestId("button-copy-invite-message"));

    expect(writeText).toHaveBeenCalledWith(message.textContent);
    expect(mocks.toast).toHaveBeenCalledWith({ title: "Message copied" });
  });
});