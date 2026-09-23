import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { customFetch } from "@workspace/api-client-react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { useWhoami } from "@/hooks/useWhoami";
import { CompetitionPartnerPagesPanel } from "./CompetitionPartnerPagesPanel";

vi.mock("@workspace/api-client-react", () => ({
  customFetch: vi.fn(),
}));

vi.mock("@/hooks/useWhoami", () => ({
  useWhoami: vi.fn(),
}));

const mockedFetch = vi.mocked(customFetch);
const mockedWhoami = vi.mocked(useWhoami);

const linked = {
  id: "partner-linked",
  slug: "linked-league",
  officialName: "Linked League",
  associationLabel: "League",
  logoUrl: null,
  published: true,
  linked: true,
};
const available = {
  id: "partner-available",
  slug: "available-association",
  officialName: "Available Association",
  associationLabel: "Association",
  logoUrl: null,
  published: false,
  linked: false,
};

describe("CompetitionPartnerPagesPanel", () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    mockedWhoami.mockReturnValue({
      data: {
        realUser: { id: "admin", role: "admin" },
        viewingAs: { id: "admin", role: "admin" },
        isMasquerading: false,
      },
    } as never);
  });

  it("shows connections, publication state, search, and connects a page", async () => {
    let pages = [linked, available];
    mockedFetch.mockImplementation(async (path, init) => {
      if (init?.method === "PUT") {
        pages = pages.map((page) =>
          page.id === available.id ? { ...page, linked: true } : page,
        );
        return { data: { id: available.id, linked: true } } as never;
      }
      return { data: pages } as never;
    });
    const user = userEvent.setup();
    renderWithProviders(
      <CompetitionPartnerPagesPanel competitionId="competition-1" />,
    );

    await user.click(screen.getByTestId("btn-toggle-partnerships"));
    expect(await screen.findByText("Linked League")).toBeInTheDocument();
    expect(screen.getByText("Unpublished · hidden publicly")).toBeInTheDocument();

    await user.type(
      screen.getByRole("textbox", { name: "Search partnership pages" }),
      "Available",
    );
    expect(screen.queryByText("Linked League")).not.toBeInTheDocument();
    const row = screen.getByTestId("competition-partner-page-partner-available");
    await user.click(within(row).getByRole("button", { name: "Connect" }));

    await waitFor(() =>
      expect(mockedFetch).toHaveBeenCalledWith(
        "/api/v1/admin/competitions/competition-1/partner-pages/partner-available",
        { method: "PUT" },
      ),
    );
    expect(await within(row).findByText("Connected")).toBeInTheDocument();
  });

  it("requires confirmation before disconnecting", async () => {
    let pages = [linked];
    mockedFetch.mockImplementation(async (_path, init) => {
      if (init?.method === "DELETE") {
        pages = [{ ...linked, linked: false }];
        return { data: { id: linked.id, linked: false } } as never;
      }
      return { data: pages } as never;
    });
    const user = userEvent.setup();
    renderWithProviders(
      <CompetitionPartnerPagesPanel competitionId="competition-1" />,
    );

    await user.click(screen.getByTestId("btn-toggle-partnerships"));
    const row = await screen.findByTestId(
      "competition-partner-page-partner-linked",
    );
    await user.click(within(row).getByRole("button", { name: "Disconnect" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("will stop appearing");
    await user.click(within(dialog).getByRole("button", { name: "Disconnect" }));

    await waitFor(() =>
      expect(mockedFetch).toHaveBeenCalledWith(
        "/api/v1/admin/competitions/competition-1/partner-pages/partner-linked",
        { method: "DELETE" },
      ),
    );
  });

  it("does not show or query the admin control for non-platform admins", () => {
    mockedWhoami.mockReturnValue({
      data: {
        realUser: { id: "owner", role: "user" },
        viewingAs: { id: "owner", role: "user" },
        isMasquerading: false,
      },
    } as never);

    renderWithProviders(
      <CompetitionPartnerPagesPanel competitionId="competition-1" />,
    );

    expect(
      screen.queryByTestId("competition-partnerships-panel"),
    ).not.toBeInTheDocument();
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("does not show or query the admin control while masquerading", () => {
    mockedWhoami.mockReturnValue({
      data: {
        realUser: { id: "admin", role: "admin" },
        viewingAs: { id: "coach", role: "coach" },
        isMasquerading: true,
      },
    } as never);

    renderWithProviders(
      <CompetitionPartnerPagesPanel competitionId="competition-1" />,
    );

    expect(
      screen.queryByTestId("competition-partnerships-panel"),
    ).not.toBeInTheDocument();
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});