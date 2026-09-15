import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { customFetch } from "@workspace/api-client-react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { useWhoami } from "@/hooks/useWhoami";
import PartnerLandingPage, {
  claimedOrgAccessSeenKey,
  partnerHeroShade,
} from "./PartnerLandingPage";

vi.mock("@workspace/api-client-react", () => ({
  customFetch: vi.fn(),
}));

vi.mock("@/hooks/useWhoami", () => ({
  useWhoami: vi.fn(),
}));

const mockedFetch = vi.mocked(customFetch);
const mockedWhoami = vi.mocked(useWhoami);

function partnerResponse(
  competition: Record<string, unknown> | null,
  organizations: Array<Record<string, unknown>> = [],
  page: Partial<{
    slug: string;
    officialName: string;
    associationLabel: string;
    introduction: string;
    logoUrl: string | null;
    bannerUrl: string | null;
    primaryColor: string;
    secondaryColor: string;
  }> = {},
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
        ...page,
      },
      competition,
      competitions: competition ? [competition] : [],
      organizations,
    },
  };
}

describe("PartnerLandingPage featured competition", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/partners/north-stars");
    localStorage.clear();
    mockedFetch.mockReset();
    mockedWhoami.mockReturnValue({
      data: { authenticated: false },
    } as never);
  });

  it("softens the hero shade for medium brand colors while protecting bright palettes", () => {
    expect(partnerHeroShade("#155EEF", "#06B6D4")).toEqual({
      start: 0.08,
      end: 0.3,
    });
    expect(partnerHeroShade("#FDE047", "#F8FAFC")).toEqual({
      start: 0.16,
      end: 0.46,
    });
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

  it("renders every featured competition", async () => {
    const response = partnerResponse({
      id: "competition-1",
      slug: "fall-classic-2026",
      name: "Fall Classic",
      type: "tournament",
      startDate: "2026-10-03",
      endDate: "2026-10-04",
      location: "Riverside",
    });
    response.data.competitions = [
      response.data.competition!,
      {
        id: "competition-2",
        slug: "winter-league-2026",
        name: "Winter League",
        type: "league",
        startDate: "2026-12-01",
        endDate: "2027-01-31",
        location: "North Fields",
      },
    ];
    mockedFetch.mockResolvedValue(response as never);

    renderWithProviders(<PartnerLandingPage />);

    expect(
      await screen.findByTestId("featured-partner-competition-card-competition-1"),
    ).toHaveTextContent("Fall Classic");
    expect(
      screen.getByTestId("featured-partner-competition-card-competition-2"),
    ).toHaveTextContent("Winter League");
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
    mockedWhoami.mockReturnValue({
      data: {
        authenticated: true,
        realUser: {
          id: "admin-1",
          name: "Platform Admin",
          email: "admin@kinectem.com",
          role: "admin",
        },
        viewingAs: null,
      },
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

  it("shows the slug-specific edit link when admin identity resolves after page data", async () => {
    let whoamiResult: ReturnType<typeof useWhoami> = {
      data: undefined,
      isLoading: true,
    } as never;
    mockedWhoami.mockImplementation(() => whoamiResult);
    mockedFetch.mockResolvedValue(partnerResponse(null) as never);

    const view = renderWithProviders(<PartnerLandingPage />);

    await screen.findByRole("heading", {
      name: "Kinectem is the youth-sports platform where the story of your season comes to life.",
    });
    expect(screen.queryByTestId("link-edit-partner-page")).not.toBeInTheDocument();

    whoamiResult = {
      data: {
        authenticated: true,
        realUser: {
          id: "admin-1",
          name: "Platform Admin",
          email: "admin@kinectem.com",
          role: "admin",
        },
        viewingAs: null,
      },
      isLoading: false,
    } as never;
    view.rerender(<PartnerLandingPage />);

    expect(await screen.findByTestId("link-edit-partner-page")).toHaveAttribute(
      "href",
      "/admin/organizations?section=partner&edit=north-stars",
    );
  });

  it("updates the admin edit destination when navigating between partner slugs", async () => {
    mockedWhoami.mockReturnValue({
      data: {
        authenticated: true,
        realUser: {
          id: "admin-1",
          name: "Platform Admin",
          email: "admin@kinectem.com",
          role: "admin",
        },
        viewingAs: null,
      },
    } as never);
    mockedFetch.mockImplementation(async (path) => {
      const slug = String(path).split("/").pop() ?? "";
      return partnerResponse(null, [], {
        slug,
        officialName: slug === "north-stars" ? "North Stars Soccer" : "Hudson Valley Soccer",
      }) as never;
    });

    renderWithProviders(<PartnerLandingPage />);

    expect(await screen.findByTestId("link-edit-partner-page")).toHaveAttribute(
      "href",
      "/admin/organizations?section=partner&edit=north-stars",
    );

    act(() => {
      window.history.pushState({}, "", "/partners/hudson-valley");
    });

    await waitFor(() => {
      expect(screen.getByTestId("link-edit-partner-page")).toHaveAttribute(
        "href",
        "/admin/organizations?section=partner&edit=hudson-valley",
      );
    });
  });

  it("never shows the admin edit link to regular users or masquerading admins", async () => {
    mockedFetch.mockResolvedValue(partnerResponse(null) as never);
    mockedWhoami.mockReturnValue({
      data: {
        authenticated: true,
        realUser: {
          id: "coach-1",
          name: "Regular Coach",
          email: "coach@example.com",
          role: "coach",
        },
        viewingAs: null,
      },
    } as never);

    const view = renderWithProviders(<PartnerLandingPage />);
    await screen.findByTestId("partner-hero");
    expect(screen.queryByTestId("link-edit-partner-page")).not.toBeInTheDocument();

    mockedWhoami.mockReturnValue({
      data: {
        authenticated: true,
        isMasquerading: true,
        realUser: {
          id: "admin-1",
          name: "Platform Admin",
          email: "admin@kinectem.com",
          role: "admin",
        },
        viewingAs: {
          id: "coach-1",
          name: "Regular Coach",
          email: "coach@example.com",
          role: "coach",
        },
      },
    } as never);
    view.rerender(<PartnerLandingPage />);

    expect(screen.queryByTestId("link-edit-partner-page")).not.toBeInTheDocument();
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
    expect(lockup).toHaveClass("mx-auto");
    expect(lockup.querySelector('[data-testid="partner-logo-separator"]')).toBeInTheDocument();
    expect(lockup.querySelector('[alt="Kinectem logo"]')).toBeInTheDocument();
  });

  it("contains edge-reaching partner artwork inside a padded fixed-size tile", async () => {
    mockedFetch.mockResolvedValue(
      partnerResponse(null, [], {
        officialName: "Wide Edge League",
        logoUrl:
          "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='120'%3E%3Crect width='400' height='120' fill='navy'/%3E%3C/svg%3E",
      }) as never,
    );

    renderWithProviders(<PartnerLandingPage />);

    const tile = await screen.findByTestId("partner-logo-tile");
    const logo = screen.getByTestId("partner-logo-image");
    expect(tile).toHaveClass(
      "h-32",
      "w-32",
      "overflow-hidden",
      "p-5",
      "md:h-40",
      "md:w-40",
      "md:p-6",
    );
    expect(logo).toHaveClass("block", "h-full", "w-full", "object-contain");
    expect(logo).not.toHaveClass("object-cover");
  });

  it("shows the current owner before an anonymous visitor enters a claimed club", async () => {
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
          owner: {
            userId: "owner-1",
            displayName: "Jordan Lee",
            avatarUrl: null,
          },
          teams: [],
        },
      ]) as never,
    );

    renderWithProviders(<PartnerLandingPage />);
    await userEvent.setup().click(
      await screen.findByRole("button", { name: "Find Your Club" }),
    );
    expect(await screen.findByTestId("club-owner-org-1")).toHaveTextContent(
      "Current owner: Jordan Lee",
    );
    expect(
      screen.getByRole("button", { name: "Request admin access" }),
    ).toBeInTheDocument();

    await userEvent.setup().click(
      await screen.findByRole("button", { name: "View club page" }),
    );
    const dialog = await screen.findByTestId("dialog-claimed-org-access");
    expect(dialog).toHaveTextContent("Jordan Lee");
    expect(within(dialog).getByRole("link", { name: "Jordan Lee" })).toHaveAttribute(
      "href",
      "/users/owner-1",
    );
    expect(dialog).toHaveTextContent(
      "You can continue to the club page now without requesting access.",
    );
    expect(
      within(dialog).getByRole("button", { name: "Continue to club page" }),
    ).toBeInTheDocument();
    expect(localStorage.getItem(claimedOrgAccessSeenKey("org-1"))).toBe("1");
    await userEvent.setup().click(
      within(dialog).getByRole("button", { name: "Sign in or create an account" }),
    );
    expect(window.location.pathname).toBe("/login");
    expect(new URLSearchParams(window.location.search).get("signup")).toBe("1");
    expect(new URLSearchParams(window.location.search).get("returnTo")).toBe(
      "/partners/north-stars?accessRequestOrg=org-1",
    );
  });

  it("lets a signed-out visitor continue to the club page without requesting", async () => {
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
          owner: {
            userId: "owner-1",
            displayName: "Jordan Lee",
            avatarUrl: null,
          },
          teams: [],
        },
      ]) as never,
    );
    const user = userEvent.setup();
    renderWithProviders(<PartnerLandingPage />);
    await user.click(await screen.findByRole("button", { name: "Find Your Club" }));
    await user.click(await screen.findByRole("button", { name: "View club page" }));
    await user.click(
      await screen.findByRole("button", { name: "Continue to club page" }),
    );

    expect(window.location.pathname).toBe("/organizations/org-1");
    expect(window.location.search).toBe("?showAround=1");
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it("opens the claimed-club dialog after signup return even when it was already seen", async () => {
    window.history.pushState(
      {},
      "",
      "/partners/north-stars?accessRequestOrg=org-1",
    );
    localStorage.setItem(claimedOrgAccessSeenKey("org-1"), "1");
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
          owner: {
            userId: "owner-1",
            displayName: "Jordan Lee",
            avatarUrl: null,
          },
          teams: [],
        },
      ]) as never,
    );

    renderWithProviders(<PartnerLandingPage />);

    expect(await screen.findByTestId("dialog-claimed-org-access")).toHaveTextContent(
      "Jordan Lee",
    );
    expect(window.location.search).not.toContain("accessRequestOrg");
  });

  it("sends a partner admin request and shows confirmation to a signed-in visitor", async () => {
    mockedWhoami.mockReturnValue({
      data: {
        authenticated: true,
        realUser: {
          id: "requester-1",
          name: "Example Coach",
          email: "coach@example.com",
          role: "coach",
        },
        viewingAs: null,
      },
    } as never);
    mockedFetch
      .mockResolvedValueOnce(
        partnerResponse(null, [
          {
            id: "org-1",
            name: "North Stars Soccer",
            location: "Riverside",
            city: "Riverside",
            state: "CA",
            logoUrl: null,
            canRequestClaim: false,
            owner: {
              userId: "owner-1",
              displayName: "Jordan Lee",
              avatarUrl: null,
            },
            teams: [],
          },
        ]) as never,
      )
      .mockResolvedValueOnce({
        data: {
          id: "request-1",
          status: "pending",
          requestedRole: "admin",
        },
      } as never);

    const user = userEvent.setup();
    renderWithProviders(<PartnerLandingPage />);
    await user.click(await screen.findByRole("button", { name: "Find Your Club" }));
    await user.click(await screen.findByRole("button", { name: "View club page" }));
    expect(
      await screen.findByRole("button", { name: "Continue to club page" }),
    ).toBeInTheDocument();
    await user.click(
      await screen.findByRole("button", { name: "Request admin access" }),
    );

    await waitFor(() =>
      expect(mockedFetch).toHaveBeenCalledWith(
        "/api/v1/partner-pages/north-stars/organizations/org-1/admin-requests",
        { method: "POST" },
      ),
    );
    expect(await screen.findByTestId("claimed-org-success")).toHaveTextContent(
      "Request sent securely",
    );
    expect(
      screen.getByRole("button", { name: "Continue to club page" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Request admin access" }),
    ).not.toBeInTheDocument();
  });

  it("lets an eligible organization admin request a duplicate swap and shows pending state", async () => {
    mockedWhoami.mockReturnValue({
      data: {
        authenticated: true,
        realUser: {
          id: "requester-1",
          name: "Club Admin",
          email: "admin@example.com",
          role: "coach",
        },
        viewingAs: null,
      },
    } as never);
    const initial = partnerResponse(null, [
      {
        id: "staging-org-1",
        membershipId: "membership-1",
        name: "North Stars Soccer",
        location: "Riverside",
        city: "Riverside",
        state: "CA",
        logoUrl: null,
        canRequestClaim: false,
        canRequestDuplicateSwap: true,
        duplicateSwapRequest: null,
        owner: null,
        teams: [],
      },
    ]);
    (initial.data as typeof initial.data & {
      duplicateSwapTargets?: Array<{ id: string; name: string; city: string | null; state: string | null }>;
    }).duplicateSwapTargets = [
      { id: "target-org-1", name: "North Stars Soccer", city: "Riverside", state: "CA" },
    ];
    const pending = partnerResponse(null, [
      {
        ...initial.data.organizations[0],
        duplicateSwapRequest: {
          id: "swap-request-1",
          status: "pending",
          targetOrganizationId: "target-org-1",
        },
      },
    ]);
    (pending.data as typeof pending.data & {
      duplicateSwapTargets?: Array<{ id: string; name: string; city: string | null; state: string | null }>;
    }).duplicateSwapTargets = (initial.data as typeof initial.data & {
      duplicateSwapTargets?: Array<{ id: string; name: string; city: string | null; state: string | null }>;
    }).duplicateSwapTargets;
    mockedFetch
      .mockResolvedValueOnce(initial as never)
      .mockResolvedValueOnce({
        data: {
          id: "swap-request-1",
          status: "pending",
          sourceMembershipId: "membership-1",
          targetOrganizationId: "target-org-1",
        },
      } as never)
      .mockResolvedValueOnce(pending as never);

    const user = userEvent.setup();
    renderWithProviders(<PartnerLandingPage />);
    await user.click(await screen.findByRole("button", { name: "Find Your Club" }));
    const swap = await screen.findByTestId("duplicate-swap-staging-org-1");
    await user.selectOptions(
      within(swap).getByRole("combobox"),
      "target-org-1",
    );
    await user.click(within(swap).getByRole("button", { name: "Request correction" }));

    await waitFor(() =>
      expect(mockedFetch).toHaveBeenCalledWith(
        "/api/v1/partner-pages/north-stars/duplicate-swap-requests",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            sourceMembershipId: "membership-1",
            targetOrganizationId: "target-org-1",
          }),
        }),
      ),
    );
    expect(await screen.findByText("Correction request pending platform review.")).toBeInTheDocument();
  });

  it("keeps ownerless partner clubs on the existing organization-page path", async () => {
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
          owner: null,
          teams: [],
        },
      ]) as never,
    );

    renderWithProviders(<PartnerLandingPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Find Your Club" }));
    await user.click(await screen.findByRole("button", { name: "View club page" }));

    expect(window.location.pathname).toBe("/organizations/org-1");
    expect(window.location.search).toBe("?showAround=1");
    expect(screen.queryByTestId("dialog-claimed-org-access")).not.toBeInTheDocument();
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
    mockedWhoami.mockReturnValue({
      data: {
        authenticated: true,
        realUser: {
          id: "user-1",
          name: "Example Coach",
          email: "coach@example.com",
          role: "coach",
        },
        viewingAs: null,
      },
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

      await user.click(screen.getAllByRole("button", { name: "Request ownership access" })[0]);
      const requestPanel = await screen.findByTestId("partner-access-request");
      expect(requestPanel).toHaveTextContent("North Stars Soccer");
      expect(scrollIntoView).toHaveBeenLastCalledWith({
        behavior: "smooth",
        block: "center",
      });

      await user.click(screen.getAllByRole("button", { name: "Request ownership access" })[1]);
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

  it("clearly explains when the typed club name does not match", async () => {
    mockedWhoami.mockReturnValue({
      data: {
        authenticated: true,
        realUser: {
          id: "coach-1",
          name: "Andrew Tarantino",
          email: "coach@example.com",
          role: "coach",
        },
        viewingAs: null,
      },
    } as never);
    mockedFetch.mockResolvedValue(
      partnerResponse(null, [
        {
          id: "org-1",
          name: "Athletic Soccer Club Saugerties - HV",
          location: null,
          city: null,
          state: null,
          logoUrl: null,
          canRequestClaim: true,
          teams: [],
        },
      ]) as never,
    );
    const user = userEvent.setup();
    renderWithProviders(<PartnerLandingPage />);

    await user.click(await screen.findByRole("button", { name: "Find Your Club" }));
    await user.click(screen.getByRole("button", { name: "Request ownership access" }));
    await user.type(
      screen.getByLabelText("Organization name"),
      "Athletic Soccer Club Saugerties - H",
    );
    await user.type(
      screen.getByPlaceholderText("Club president, director…"),
      "President",
    );
    await user.click(
      screen.getByText(/I selected the correct organization/),
    );
    await user.click(screen.getByText(/I am authorized to represent/));
    await user.click(
      screen.getByRole("button", {
        name: "Request ownership of Athletic Soccer Club Saugerties - HV",
      }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The club name doesn't match. Type “Athletic Soccer Club Saugerties - HV” exactly as shown, then submit again.",
    );
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });
});
