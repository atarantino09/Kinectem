import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { customFetch } from "@workspace/api-client-react";
import { renderWithProviders } from "@/test/renderWithProviders";
import PartnerLandingPage from "./PartnerLandingPage";

vi.mock("@workspace/api-client-react", () => ({
  customFetch: vi.fn(),
  useGetLoggedInUser: () => ({ data: null }),
}));

const mockedFetch = vi.mocked(customFetch);

function partnerResponse(competition: Record<string, unknown> | null) {
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
      organizations: [],
    },
  };
}

describe("PartnerLandingPage featured competition", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/partners/north-stars");
    mockedFetch.mockReset();
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

  it("keeps the existing page unchanged when no competition is linked", async () => {
    mockedFetch.mockResolvedValue(partnerResponse(null) as never);

    renderWithProviders(<PartnerLandingPage />);

    expect(await screen.findByText("Welcome to the North Stars.")).toBeInTheDocument();
    expect(
      screen.queryByTestId("featured-partner-competition"),
    ).not.toBeInTheDocument();
  });
});