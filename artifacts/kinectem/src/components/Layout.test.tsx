import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "@/test";
import {
  getMockLocation,
  resetWouterMock,
  setMockLocation,
  wouterMock,
} from "@/test/mocks/wouter";

vi.mock("wouter", () => wouterMock);

vi.mock("@workspace/api-client-react", () => ({
  useGetLoggedInUser: () => ({
    data: { id: "user-1", firstName: "Test", lastName: "User", role: "user" },
    error: null,
  }),
  useGetUnreadMessageCount: () => ({ data: { unreadCount: 0 } }),
  getGetLoggedInUserQueryKey: () => ["/api/v1/users/me"],
  customFetch: vi.fn(),
}));

vi.mock("@/hooks/useWhoami", () => ({
  useWhoami: () => ({
    data: { authenticated: true, realUser: { role: "user" } },
  }),
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("@/components/UserAvatar", () => ({
  UserAvatar: () => null,
}));
vi.mock("@/components/NotificationsBell", () => ({
  NotificationsBell: () => null,
}));
vi.mock("@/components/CreateOrgDialog", () => ({
  CreateOrgDialog: () => null,
}));
vi.mock("@/components/MasqueradeBanner", () => ({
  MasqueradeBanner: () => null,
}));
vi.mock("@/components/AnnouncementBanner", () => ({
  AnnouncementBanner: () => null,
}));
vi.mock("@/components/CreateMenuItems", () => ({
  CreateMenuItems: () => null,
}));
vi.mock("@/components/MobileBottomNav", () => ({
  MobileBottomNav: () => null,
}));
vi.mock("@/components/MobileTopBar", () => ({
  MobileTopBar: () => null,
}));

vi.mock("@/components/broadcasts/broadcastsApi", () => ({
  fetchUnreadCount: vi.fn().mockResolvedValue(0),
  unreadCountQueryKey: () => ["/api/v1/broadcasts/unread-count"],
}));

vi.mock("@/components/ui/dropdown-menu", () => {
  const passthrough = ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  );
  return {
    DropdownMenu: passthrough,
    DropdownMenuContent: passthrough,
    DropdownMenuItem: passthrough,
    DropdownMenuSeparator: () => null,
    DropdownMenuTrigger: passthrough,
  };
});

vi.mock("@/components/ui/sheet", () => {
  const passthrough = ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  );
  return {
    Sheet: passthrough,
    SheetContent: passthrough,
    SheetDescription: passthrough,
    SheetTitle: passthrough,
  };
});

import { Layout } from "./Layout";

describe("Layout global search", () => {
  it("keeps the submitted term on results and clears it after leaving", async () => {
    const user = userEvent.setup();
    resetWouterMock();
    setMockLocation("/");

    const { rerender } = renderWithProviders(
      <Layout>
        <div>Page content</div>
      </Layout>,
    );

    const searchInput = screen.getByTestId("input-header-search");
    await user.type(searchInput, "Westfield");
    await user.keyboard("{Enter}");

    expect(getMockLocation()).toBe("/search?q=Westfield");
    expect(screen.getByTestId("input-header-search")).toHaveValue("Westfield");

    setMockLocation("/search?q=Westfield");
    rerender(
      <Layout>
        <div>Search results</div>
      </Layout>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("input-header-search")).toHaveValue("Westfield"),
    );

    setMockLocation("/teams/team-1");
    rerender(
      <Layout>
        <div>Team page</div>
      </Layout>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("input-header-search")).toHaveValue(""),
    );
  });
});
