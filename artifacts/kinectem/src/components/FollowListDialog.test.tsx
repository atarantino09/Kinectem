import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test";
import { toastSpy, useToastMock } from "@/test/mocks/toast";

const customFetchMock = vi.fn();
const useListTeamFollowersMock = vi.fn();
const useListOrgFollowersMock = vi.fn();

vi.mock("@/hooks/use-toast", () => useToastMock);
vi.mock("@workspace/api-client-react", () => ({
  customFetch: (...args: unknown[]) => customFetchMock(...args),
  queryOpts: <T,>(options: T) => options,
  getListTeamFollowersQueryKey: (teamId: string) => [
    `/api/v1/teams/${teamId}/followers`,
  ],
  getListOrgFollowersQueryKey: (orgId: string) => [
    `/api/v1/organizations/${orgId}/followers`,
  ],
  useListUserFollowers: () => ({ data: { data: [] }, isLoading: false }),
  useListUserFollowing: () => ({ data: { data: [] }, isLoading: false }),
  useListTeamFollowers: (...args: unknown[]) => useListTeamFollowersMock(...args),
  useListOrgFollowers: (...args: unknown[]) => useListOrgFollowersMock(...args),
}));

import { FollowListDialog } from "./FollowListDialog";

const follower = {
  id: "follower-1",
  displayName: "Taylor Follower",
  avatarUrl: null,
};

function renderDialog(
  variant: { kind: "team-followers"; teamId: string } | { kind: "org-followers"; orgId: string },
  canManageFollowers = true,
) {
  return renderWithProviders(
    <FollowListDialog
      open
      onOpenChange={() => {}}
      title="Followers"
      variant={variant}
      canManageFollowers={canManageFollowers}
    />,
  );
}

describe("FollowListDialog follower removal", () => {
  beforeEach(() => {
    useListTeamFollowersMock.mockReturnValue({
      data: { data: [follower] },
      isLoading: false,
    });
    useListOrgFollowersMock.mockReturnValue({
      data: { data: [follower] },
      isLoading: false,
    });
    customFetchMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    [{ kind: "team-followers", teamId: "team-1" } as const],
    [{ kind: "org-followers", orgId: "org-1" } as const],
  ])("shows the remove control for a manager on %o", (variant) => {
    renderDialog(variant);
    expect(
      screen.getByTestId("button-remove-follower-follower-1"),
    ).toBeInTheDocument();
  });

  it("requires confirmation, calls the exact team endpoint, and removes immediately", async () => {
    let resolveRequest: (() => void) | undefined;
    customFetchMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const user = userEvent.setup();
    renderDialog({ kind: "team-followers", teamId: "team-1" });

    await user.click(screen.getByTestId("button-remove-follower-follower-1"));
    expect(screen.getByTestId("dialog-remove-follower-confirm")).toBeInTheDocument();
    expect(customFetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("button-confirm-remove-follower"));
    expect(customFetchMock).toHaveBeenCalledWith(
      "/api/v1/teams/team-1/followers/follower-1",
      { method: "DELETE" },
    );
    await waitFor(() =>
      expect(
        screen.queryByTestId("follow-item-follower-1"),
      ).not.toBeInTheDocument(),
    );

    resolveRequest?.();
  });

  it("uses the exact organization endpoint", async () => {
    const user = userEvent.setup();
    renderDialog({ kind: "org-followers", orgId: "org-1" });

    await user.click(screen.getByTestId("button-remove-follower-follower-1"));
    await user.click(screen.getByTestId("button-confirm-remove-follower"));
    await waitFor(() =>
      expect(customFetchMock).toHaveBeenCalledWith(
        "/api/v1/organizations/org-1/followers/follower-1",
        { method: "DELETE" },
      ),
    );
  });

  it("restores the follower and shows the server error when removal fails", async () => {
    customFetchMock.mockRejectedValue({ data: { error: "This follower is protected" } });
    const user = userEvent.setup();
    renderDialog({ kind: "team-followers", teamId: "team-1" });

    await user.click(screen.getByTestId("button-remove-follower-follower-1"));
    await user.click(screen.getByTestId("button-confirm-remove-follower"));

    await waitFor(() =>
      expect(screen.getByTestId("follow-item-follower-1")).toBeInTheDocument(),
    );
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Couldn't remove follower",
        description: "This follower is protected",
        variant: "destructive",
      }),
    );
  });

  it("does not expose removal to a non-manager", () => {
    renderDialog({ kind: "team-followers", teamId: "team-1" }, false);
    expect(
      screen.queryByTestId("button-remove-follower-follower-1"),
    ).not.toBeInTheDocument();
  });
});