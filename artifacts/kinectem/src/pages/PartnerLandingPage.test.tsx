import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { customFetch, useGetLoggedInUser } from "@workspace/api-client-react";
import { renderWithProviders } from "@/test/renderWithProviders";
import PartnerLandingPage from "./PartnerLandingPage";

vi.mock("@workspace/api-client-react", () => ({
  customFetch: vi.fn(),
  useGetLoggedInUser: vi.fn(),
}));

const mockedFetch = vi.mocked(customFetch);
const mockedUser = vi.mocked(useGetLoggedInUser);

function partnerResponse(
  competition: Record<string, unknown> | null,
  organizations: Array<Record<string, unknown>> = [],
) {
  return {
    data: {
      page: {
        slug: "north-stars",
        officialName: "North Stars Soccer",
        associationLabel: "League",
        introduction: "Welcome to the North Stars.",
        logoUrl: null,
        bannerUrl: null,
        primaryColor: "#155EEF",
        secondaryColor: "#06B6D4",
      },
      competition,
      organizations,
    },
  };
}

describe("PartnerLandingPage featured competition", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/partners/north-stars");
    mockedFetch.mockReset();
    mockedUser.mockReturnValue({ data: null } as never);
  });

  it("shows public competition details and links to the canonical public page", async () => {
    mockedFetch.mockResolvedValue(
      partnerResponse({
        id: "competition-1",
        slug: "fall-classic-2026",
        name: "Fall Classic",
        type: "tournament",
        startDate: "2026-10-03",
        endDate: "2026-10-04",
        location: "Riverside Sports Complex",
      }) as never,
    );

    renderWithProviders(<PartnerLandingPage />);

    const card = await screen.findByTestId("featured-partner-competition");
    expect(card).toHaveTextContent("Fall Classic");
    expect(card).toHaveTextContent("Riverside Sports Complex");
    expect(screen.getByText("Featured competition")).toBeInTheDocument();
    expect(screen.getByText("Event spotlight")).toBeInTheDocument();
    expect(screen.getByTestId("featured-competition-type")).toHaveTextContent("tournament");
    expect(screen.getByTestId("featured-competition-dates")).toHaveTextContent("Oct 3, 2026 – Oct 4, 2026");
    expect(screen.getByTestId("featured-competition-location")).toHaveTextContent("Riverside Sports Complex");
    expect(
      screen.getByTestId("link-featured-partner-competition").closest("a"),
    ).toHaveAttribute("href", "/c/fall-classic-2026");
  });

  it("keeps the featured layout scannable when the public location is missing", async () => {
    mockedFetch.mockResolvedValue(
      partnerResponse({
        id: "competition-2",
        slug: "winter-league-2026",
        name: "Winter League",
        type: "league",
        startDate: "2026-12-01",
        endDate: "2027-01-31",
        location: null,
      }) as never,
    );

    renderWithProviders(<PartnerLandingPage />);

    const card = await screen.findByTestId("featured-partner-competition");
    expect(card).toHaveTextContent("Winter League");
    expect(screen.getByTestId("featured-competition-type")).toHaveTextContent("league");
    expect(screen.getByTestId("featured-competition-dates")).toHaveTextContent("Dec 1, 2026 – Jan 31, 2027");
    expect(screen.queryByTestId("featured-competition-location")).not.toBeInTheDocument();
    expect(screen.getByTestId("link-featured-partner-competition").closest("a")).toHaveAttribute(
      "href",
      "/c/winter-league-2026",
    );
  });

  it("shows the partner edit console link only to platform admins", async () => {
    mockedUser.mockReturnValue({
      data: { id: "admin-1", email: "admin@kinectem.com", role: "admin" },
    } as never);
    mockedFetch.mockResolvedValue(partnerResponse(null) as never);

    renderWithProviders(<PartnerLandingPage />);

    const editLink = await screen.findByTestId("link-edit-partner-page");
    expect(editLink).toHaveAttribute(
      "href",
      "/admin/organizations?section=partner&edit=north-stars",
    );
  });

  it("does not show the partner edit console link to regular visitors", async () => {
    mockedFetch.mockResolvedValue(partnerResponse(null) as never);

    renderWithProviders(<PartnerLandingPage />);

    await screen.findByRole("heading", {
      name: "Kinectem is the youth-sports platform where the story of your season comes to life.",
    });
    expect(
      screen.queryByTestId("link-edit-partner-page"),
    ).not.toBeInTheDocument();
  });

  it("shows the platform hero messaging and centers the separator between marks", async () => {
    mockedFetch.mockResolvedValue(partnerResponse(null) as never);

    renderWithProviders(<PartnerLandingPage />);

    const hero = await screen.findByTestId("partner-hero");
    expect(hero).toHaveClass("py-8", "md:py-12");
    expect(screen.getByTestId("partner-hero-branding")).toHaveClass("mb-5");
    expect(screen.getByTestId("partner-hero-opening")).toHaveClass("gap-5");
    expect(
      screen.getByRole("heading", {
        name: "Kinectem is the youth-sports platform where the story of your season comes to life.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Kinectem is not another registration, scheduling, or communication app — it's the layer that sits on top of the one you already use. They run your season. Kinectem makes it last.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "After the final whistle, Kinectem turns quick coach notes into polished recaps, tags every player, and builds a lasting history families can revisit. It gives clubs one living home for the moments that matter — without replacing the tools they already use.",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("partner-hero-opening")).getByRole("button", {
        name: /find your club/i,
      }),
    ).toBeInTheDocument();
    const lockup = screen.getByTestId("partner-logo-lockup");
    expect(lockup.querySelector('[data-testid="partner-logo-separator"]')).toBeInTheDocument();
    expect(lockup.querySelector('[alt="Kinectem logo"]')).toBeInTheDocument();
  });

  it("adds the guided tour trigger to each club page link", async () => {
    mockedFetch.mockResolvedValue(
      partnerResponse(null, [
        {
          id: "org-1",
          name: "North Stars Soccer",
          location: "Riverside",
          city: "Riverside",
          state: "CA",
          logoUrl: null,
          canRequestClaim: false,
          teams: [],
        },
      ]) as never,
    );

    renderWithProviders(<PartnerLandingPage />);
    await userEvent.setup().click(
      await screen.findByRole("button", { name: "Find Your Club" }),
    );

    const viewClubButton = await screen.findByRole("button", {
      name: "View club page",
    });
    expect(viewClubButton.closest("a")).toHaveAttribute(
      "href",
      "/organizations/org-1?showAround=1",
    );
  });

  it("keeps the existing page unchanged when no competition is linked", async () => {
    mockedFetch.mockResolvedValue(partnerResponse(null) as never);

    renderWithProviders(<PartnerLandingPage />);

    expect(await screen.findByText("Welcome to the North Stars.")).toBeInTheDocument();
    expect(
      screen.queryByTestId("featured-partner-competition"),
    ).not.toBeInTheDocument();
  });

  it("shows the create-club callout beside directory results", async () => {
    mockedFetch.mockResolvedValue(
      partnerResponse(null, [
        {
          id: "org-1",
          name: "North Stars Soccer",
          location: "Riverside",
          city: "Riverside",
          state: "CA",
          logoUrl: null,
          canRequestClaim: false,
          teams: [],
        },
      ]) as never,
    );

    renderWithProviders(<PartnerLandingPage />);
    await userEvent.setup().click(
      await screen.findByRole("button", { name: "Find Your Club" }),
    );

    const callout = await screen.findByTestId("create-club-callout");
    expect(callout).toHaveTextContent("Don't see your club?");
    expect(callout).toHaveTextContent("Create it on Kinectem");
    expect(callout).toHaveTextContent("Questions or need a hand?");
    expect(callout.querySelector('a[href="mailto:competitions@kinectem.com"]')).toBeInTheDocument();
    expect(screen.getByTestId("btn-create-club").closest("a")).toHaveAttribute(
      "href",
      "/login?signup=1&returnTo=%2Forganizations%2Fmine%3Fnew%3D1",
    );
    expect(screen.getByText("North Stars Soccer")).toBeInTheDocument();
  });

  it("keeps the create-club callout available when a search has no matches", async () => {
    mockedFetch.mockResolvedValue(partnerResponse(null) as never);

    renderWithProviders(<PartnerLandingPage />);
    await userEvent.setup().click(
      await screen.findByRole("button", { name: "Find Your Club" }),
    );

    const search = await screen.findByPlaceholderText("Search club name or location");
    await userEvent.setup().type(search, "does-not-exist");

    expect(screen.getByTestId("create-club-callout")).toBeInTheDocument();
    expect(screen.getByText("No clubs match that search.")).toBeInTheDocument();
    expect(screen.getByTestId("btn-create-club").closest("a")).toHaveAttribute(
      "href",
      "/login?signup=1&returnTo=%2Forganizations%2Fmine%3Fnew%3D1",
    );
    expect(screen.getByRole("link", { name: "competitions@kinectem.com" })).toHaveAttribute(
      "href",
      "mailto:competitions@kinectem.com",
    );
  });

  it("links signed-in visitors directly to the new organization dialog", async () => {
    mockedUser.mockReturnValue({
      data: { id: "user-1", email: "coach@example.com" },
    } as never);
    mockedFetch.mockResolvedValue(partnerResponse(null) as never);

    renderWithProviders(<PartnerLandingPage />);
    await userEvent.setup().click(
      await screen.findByRole("button", { name: "Find Your Club" }),
    );

    await screen.findByTestId("create-club-callout");
    expect(screen.getByTestId("btn-create-club").closest("a")).toHaveAttribute(
      "href",
      "/organizations/mine?new=1",
    );
  });

  it("scrolls the selected access request into view and updates when switching clubs", async () => {
    mockedFetch.mockResolvedValue(
      partnerResponse(null, [
        {
          id: "org-1",
          name: "North Stars Soccer",
          location: "Riverside",
          city: "Riverside",
          state: "CA",
          logoUrl: null,
          canRequestClaim: true,
          teams: [],
        },
        {
          id: "org-2",
          name: "Harbor United",
          location: "Bayview",
          city: "Bayview",
          state: "CA",
          logoUrl: null,
          canRequestClaim: true,
          teams: [],
        },
      ]) as never,
    );

    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
    const user = userEvent.setup();

    try {
      renderWithProviders(<PartnerLandingPage />);
      await user.click(await screen.findByRole("button", { name: "Find Your Club" }));

      await user.click(screen.getAllByRole("button", { name: "Request access" })[0]);
      const requestPanel = await screen.findByTestId("partner-access-request");
      expect(requestPanel).toHaveTextContent("North Stars Soccer");
      expect(scrollIntoView).toHaveBeenLastCalledWith({
        behavior: "smooth",
        block: "center",
      });

      await user.click(screen.getAllByRole("button", { name: "Request access" })[1]);
      expect(requestPanel).toHaveTextContent("Harbor United");
      expect(scrollIntoView).toHaveBeenLastCalledWith({
        behavior: "smooth",
        block: "center",
      });
      expect(scrollIntoView).toHaveBeenCalledTimes(2);
    } finally {
      scrollIntoView.mockRestore();
    }
  });
});
