import { beforeAll, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { InviteRosterDialog } from "./InviteRosterDialog";

const mocks = vi.hoisted(() => ({
  createJoinLink: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  useAddTeamMember: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateRosterInvite: () => ({ mutateAsync: vi.fn(), isPending: false }),
  createRosterInvite: vi.fn(),
  useGetOrCreateTeamJoinLink: ({ mutation }: { mutation?: { onSuccess?: (response: { token: string }) => void } }) => {
    mocks.createJoinLink.mockImplementation(() => {
      mutation?.onSuccess?.({ token: "team-join-token" });
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

describe("InviteRosterDialog role-specific copy", () => {
  it("updates shared copy for role-based invite flows and explains CSV rows use their own roles", async () => {
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
      "Showing: Player (parent / player invitation).",
    );
    expect(roleNotice).toHaveTextContent(
      "Parent/player invitations use family setup wording; coach and staff invitations use staff wording.",
    );
    expect(message).toHaveTextContent("Set up your player's account");

    await user.click(screen.getByTestId("select-existing-invite-position"));
    await user.click(await screen.findByRole("option", { name: "Head Coach" }));

    expect(screen.getByTestId("invite-message-current-role")).toHaveTextContent(
      "Showing: Head Coach (staff invitation).",
    );
    expect(message).toHaveTextContent(
      "has invited you to join Falcons on Kinectem as a Coach.",
    );

    await user.click(screen.getByRole("tab", { name: /email/i }));
    expect(screen.getByTestId("invite-message-current-role")).toHaveTextContent(
      "Showing: Player (parent / player invitation).",
    );
    await user.click(screen.getByTestId("select-email-invite-position"));
    await user.click(await screen.findByRole("option", { name: "Team Manager" }));
    expect(screen.getByTestId("invite-message-current-role")).toHaveTextContent(
      "Showing: Team Manager (staff invitation).",
    );

    await user.click(screen.getByRole("tab", { name: /bulk/i }));
    expect(screen.getByTestId("invite-message-current-role")).toHaveTextContent(
      "Showing: Player (parent / player invitation).",
    );
    await user.click(screen.getByTestId("select-bulk-invite-position"));
    await user.click(
      await screen.findByRole("option", { name: "Assistant Coach" }),
    );
    expect(screen.getByTestId("invite-message-current-role")).toHaveTextContent(
      "Showing: Assistant Coach (staff invitation).",
    );

    await user.click(screen.getByRole("tab", { name: /import csv/i }));
    expect(screen.queryByTestId("invite-message-role-notice")).not.toBeInTheDocument();
    expect(screen.queryByTestId("text-invite-message")).not.toBeInTheDocument();
    expect(screen.getByTestId("csv-invite-message-note")).toHaveTextContent(
      "CSV imports send each person an invite based on the role in their own row.",
    );
  });
});