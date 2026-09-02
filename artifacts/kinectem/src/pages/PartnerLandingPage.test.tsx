import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
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
    expect(
      screen.getByTestId("link-featured-partner-competition").closest("a"),
    ).toHaveAttribute("href", "/c/fall-classic-2026");
  });

  it("shows the platform hero messaging and centers the separator between marks", async () => {
    mockedFetch.mockResolvedValue(partnerResponse(null) as never);

    renderWithProviders(<PartnerLandingPage />);

    expect(
      await screen.findByRole("heading", {
        name: "Kinectem is the youth-sports platform where the story of your season comes to life.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Kinectem is not another registration, scheduling, or communication app — it's the layer that sits on top of the one you already use. They run your season. Kinectem makes it last.",
      ),
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
});
