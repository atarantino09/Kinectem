import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { customFetch } from "@workspace/api-client-react";
import { renderWithProviders } from "@/test";
import { AdminPartnerLanding } from "./AdminPartnerLanding";

vi.mock("@workspace/api-client-react", () => ({
  customFetch: vi.fn(),
}));

vi.mock("@/lib/extractBrandColors", () => ({
  extractBrandColorsFromDataUrl: vi.fn(async () => null),
}));

const mockedFetch = vi.mocked(customFetch);

const pageSummary = {
  id: "partner-1",
  slug: "north-stars",
  officialName: "North Stars",
  associationLabel: "League",
  published: true,
  memberCount: 1,
};

const requestRow = {
  id: "swap-request-1",
  status: "pending" as const,
  sourceMembershipId: "membership-1",
  sourceOrganizationId: "staging-org-1",
  targetOrganizationId: "target-org-1",
  requestedByUserId: "requester-1",
  requestedAt: "2026-09-16T12:00:00.000Z",
  decidedAt: null,
  sourceOrganization: { id: "staging-org-1", name: "North Stars Soccer" },
  targetOrganization: { id: "target-org-1", name: "North Stars Soccer" },
  requester: { id: "requester-1", name: "Club Admin", email: "admin@example.com" },
  approver: null,
};

function detail(requests = [requestRow]) {
  return {
    data: {
      ...pageSummary,
      introduction: "",
      logoUrl: null,
      bannerUrl: null,
      primaryColor: "#155EEF",
      secondaryColor: "#06B6D4",
      competition: null,
      competitions: [],
      members: [],
      duplicateSwapRequests: requests,
    },
  };
}

beforeEach(() => {
  mockedFetch.mockReset();
  mockedFetch.mockImplementation(async (path, options) => {
    if (path === "/api/v1/admin/partner-pages" && options?.method === "GET") {
      return { data: [pageSummary] } as never;
    }
    if (path === "/api/v1/admin/org-lists" && options?.method === "GET") {
      return { data: [] } as never;
    }
    if (path === "/api/v1/admin/partner-pages/partner-1" && options?.method === "GET") {
      return detail() as never;
    }
    if (
      path === "/api/v1/admin/partner-duplicate-swap-requests/swap-request-1/decision" &&
      options?.method === "POST"
    ) {
      return { data: { ...requestRow, status: "approved" } } as never;
    }
    return { data: [] } as never;
  });
});

describe("AdminPartnerLanding duplicate swap review queue", () => {
  it("shows approve and deny controls for pending requests and posts the decision", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminPartnerLanding />);

    await user.click(await screen.findByRole("button", { name: "Edit North Stars" }));
    expect(await screen.findByTestId("duplicate-swap-request-swap-request-1")).toHaveTextContent(
      "North Stars Soccer",
    );
    expect(screen.getByRole("button", { name: "Approve directory swap" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deny" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Approve directory swap" }));
    await waitFor(() =>
      expect(mockedFetch).toHaveBeenCalledWith(
        "/api/v1/admin/partner-duplicate-swap-requests/swap-request-1/decision",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ decision: "approved" }),
        }),
      ),
    );
  });
});