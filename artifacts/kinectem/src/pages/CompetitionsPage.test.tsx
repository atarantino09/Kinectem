import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { customFetch } from "@workspace/api-client-react";
import { renderWithProviders } from "@/test/renderWithProviders";
import CompetitionsPage from "./CompetitionsPage";

const mocks = vi.hoisted(() => ({
  role: "admin" as "admin" | "coach",
  isMasquerading: false,
  viewingRole: "coach" as "admin" | "coach",
}));

vi.mock("@/hooks/useWhoami", () => ({
  useWhoami: () => ({
    data: {
      authenticated: true,
      isMasquerading: mocks.isMasquerading,
      realUser: {
        id: "viewer-1",
        name: "Support Admin",
        email: "admin@example.com",
        role: mocks.role,
      },
      viewingAs: mocks.isMasquerading
        ? {
            id: "viewing-1",
            name: "Viewing User",
            email: "viewing@example.com",
            role: mocks.viewingRole,
          }
        : null,
    },
  }),
}));

vi.mock("@/components/OrganizerSidebar", () => ({
  OrganizerSidebar: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  NewHubDialog: () => null,
}));

vi.mock("@workspace/api-client-react", () => ({
  customFetch: vi.fn(),
}));

const mockedFetch = vi.mocked(customFetch);

describe("CompetitionsPage platform admin access", () => {
  beforeEach(() => {
    mocks.role = "admin";
    mocks.isMasquerading = false;
    mocks.viewingRole = "coach";
    mockedFetch.mockReset();
    mockedFetch.mockImplementation(async (path) => {
      if (String(path) === "/api/v1/my/organizers") {
        return { data: [] };
      }
      if (String(path).startsWith("/api/v1/admin/competitions?")) {
        return {
          data: [
            {
              id: "competition-936",
              slug: "spring-classic",
              name: "Spring Classic",
              type: "tournament",
              startDate: "2026-04-01",
              endDate: "2026-04-03",
              location: "Riverside",
              organizerId: null,
              matchCount: 12,
              participantCount: 8,
              claimedCount: 4,
              pendingClaimCount: 1,
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        };
      }
      throw new Error(`Unexpected request: ${String(path)}`);
    });
  });

  it("lets a platform admin search every competition and open its console", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CompetitionsPage />);

    await user.type(
      screen.getByTestId("input-admin-competition-search"),
      "Spring",
    );

    expect(await screen.findByText("Spring Classic")).toBeInTheDocument();
    expect(
      screen.getByTestId("link-admin-competition-competition-936"),
    ).toHaveAttribute("href", "/competitions/competition-936");
    await waitFor(() =>
      expect(mockedFetch).toHaveBeenCalledWith(
        "/api/v1/admin/competitions?q=Spring",
        { method: "GET" },
      ),
    );
  });

  it("keeps the all-competition finder hidden from regular users", async () => {
    mocks.role = "coach";
    renderWithProviders(<CompetitionsPage />);

    expect(
      screen.queryByTestId("card-admin-competition-finder"),
    ).not.toBeInTheDocument();
    expect(mockedFetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/admin/competitions"),
      expect.anything(),
    );
  });

  it("hides platform-admin access while the admin is masquerading", () => {
    mocks.role = "admin";
    mocks.isMasquerading = true;
    mocks.viewingRole = "coach";
    renderWithProviders(<CompetitionsPage />);

    expect(
      screen.queryByTestId("card-admin-competition-finder"),
    ).not.toBeInTheDocument();
  });
});