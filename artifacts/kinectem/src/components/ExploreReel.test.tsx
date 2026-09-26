import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  me: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  customFetch: mocks.fetch,
  getListFeedQueryKey: () => ["/api/v1/feed"],
  useGetLoggedInUser: mocks.me,
  useFollowTeam: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useFollowOrg: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/components/PostCard", () => ({
  PostCard: () => <div>Story</div>,
}));

import { ExploreReel } from "./ExploreReel";

beforeEach(() => {
  mocks.fetch.mockReset().mockResolvedValue({
    data: [],
    pagination: { hasMore: false, nextCursor: null },
    reason: "no_matches",
  });
  mocks.me.mockReset().mockReturnValue({ data: { id: "viewer-1", state: "NJ" } });
});

describe("Explore filters", () => {
  it("starts with all sports in the viewer's state and refetches for sport and state selections", async () => {
    renderWithProviders(<ExploreReel active />);

    expect(screen.getByLabelText("Sport")).toHaveValue("");
    expect(screen.getByLabelText("State")).toHaveValue("NJ");
    expect(screen.getByTestId("explore-filter-summary")).toHaveTextContent("all sports in New Jersey");
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledWith(
      "/api/v1/posts/explore?limit=8&state=NJ",
      { method: "GET" },
    ));

    fireEvent.change(screen.getByLabelText("Sport"), { target: { value: "Soccer" } });
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledWith(
      "/api/v1/posts/explore?limit=8&state=NJ&sport=Soccer",
      { method: "GET" },
    ));

    fireEvent.change(screen.getByLabelText("State"), { target: { value: "PA" } });
    expect(screen.getByTestId("explore-filter-summary")).toHaveTextContent("Soccer in Pennsylvania");
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledWith(
      "/api/v1/posts/explore?limit=8&state=PA&sport=Soccer",
      { method: "GET" },
    ));
    expect(screen.getByLabelText("Sport")).toHaveValue("Soccer");
  });

  it("asks for a state rather than showing unrelated stories when the profile has none", async () => {
    mocks.me.mockReturnValue({ data: { id: "viewer-1", state: null } });
    renderWithProviders(<ExploreReel active />);

    expect(screen.getByLabelText("State")).toHaveValue("");
    expect(screen.getByText("Choose a state to find public stories.")).toBeInTheDocument();
    expect(mocks.fetch).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("State"), { target: { value: "NY" } });
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledWith(
      "/api/v1/posts/explore?limit=8&state=NY",
      { method: "GET" },
    ));
  });
});