import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { customFetch } from "@workspace/api-client-react";
import { renderWithProviders } from "@/test";
import { extractBrandColorsFromDataUrl } from "@/lib/extractBrandColors";
import { AdminPartnerLanding } from "./AdminPartnerLanding";

vi.mock("@workspace/api-client-react", () => ({
  customFetch: vi.fn(),
}));

vi.mock("@/lib/extractBrandColors", () => ({
  extractBrandColorsFromDataUrl: vi.fn(async () => null),
}));

const mockedFetch = vi.mocked(customFetch);
const mockedExtractColors = vi.mocked(extractBrandColorsFromDataUrl);
let detailMembers: Array<Record<string, unknown>> = [];

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
      members: detailMembers,
      duplicateSwapRequests: requests,
    },
  };
}

beforeEach(() => {
  mockedFetch.mockReset();
  mockedExtractColors.mockReset();
  mockedExtractColors.mockResolvedValue(null);
  detailMembers = [];
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
      path ===
        "/api/v1/admin/partner-pages/partner-1/organization-search?q=Fox" &&
      options?.method === "GET"
    ) {
      return {
        data: [
          {
            id: "established-org-1",
            name: "Fox Soccer Academy",
            city: "Tampa",
            state: "FL",
            logoUrl: null,
            hasOwner: true,
            alreadyIncluded: false,
          },
          {
            id: "ownerless-org-1",
            name: "Fox Soccer Import",
            city: null,
            state: null,
            logoUrl: null,
            hasOwner: false,
            alreadyIncluded: false,
          },
        ],
      } as never;
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

describe("AdminPartnerLanding organization branding", () => {
  it("extracts colors from an uploaded logo and allows manual adjustment", async () => {
    detailMembers = [
      {
        id: "membership-1",
        visible: true,
        sourceColumn: "A",
        importOperationId: "import-1",
        hasOwner: false,
        teamCount: 1,
        contentCount: 0,
        duplicateName: false,
        canDeleteStaleImport: true,
        organization: {
          id: "org-1",
          name: "North Stars Club",
          location: null,
          city: null,
          state: null,
          logoUrl: null,
          brandPrimaryColor: null,
          brandSecondaryColor: null,
        },
      },
    ];
    mockedExtractColors.mockResolvedValue({
      primary: "#112233",
      secondary: "#aabbcc",
    });
    const user = userEvent.setup();
    renderWithProviders(<AdminPartnerLanding />);

    await user.click(await screen.findByRole("button", { name: "Edit North Stars" }));
    expect(
      await screen.findByTestId("member-brand-colors-membership-1"),
    ).toBeInTheDocument();

    const primaryHex = screen.getByLabelText(
      "North Stars Club primary color hex",
    );
    await user.clear(primaryHex);
    await user.type(primaryHex, "#334455");
    await user.click(screen.getByTestId("btn-save-member-brand-membership-1"));

    await waitFor(() => {
      const patchCall = mockedFetch.mock.calls.find(
        ([path, options]) =>
          path === "/api/v1/organizations/org-1" &&
          options?.method === "PATCH" &&
          String(options.body).includes("brandPrimaryColor"),
      );
      expect(patchCall).toBeDefined();
      expect(JSON.parse(String(patchCall?.[1]?.body))).toMatchObject({
        brandPrimaryColor: "#334455",
        brandSecondaryColor: "#06b6d4",
      });
    });
  });
});

describe("AdminPartnerLanding direct directory replacement", () => {
  it("allows a platform admin to replace a protected directory row with an established organization", async () => {
    detailMembers = [
      {
        id: "membership-1",
        visible: true,
        sourceColumn: "Fox Soccer Academy Premier",
        importOperationId: null,
        hasOwner: false,
        teamCount: 3,
        contentCount: 0,
        duplicateName: true,
        canDeleteStaleImport: false,
        protected: true,
        protection: ["not_import_created", "source_not_created_by_this_import"],
        duplicateCandidates: [],
        organization: {
          id: "staging-org-1",
          name: "Fox Soccer Academy Premier",
          location: null,
          city: null,
          state: null,
          logoUrl: null,
          brandPrimaryColor: null,
          brandSecondaryColor: null,
        },
      },
    ];
    const user = userEvent.setup();
    renderWithProviders(<AdminPartnerLanding />);

    await user.click(await screen.findByRole("button", { name: "Edit North Stars" }));
    await user.type(
      await screen.findByLabelText("Search claimed replacement organizations"),
      "Fox",
    );
    await waitFor(() =>
      expect(mockedFetch).toHaveBeenCalledWith(
        "/api/v1/admin/partner-pages/partner-1/organization-search?q=Fox",
        { method: "GET" },
      ),
    );
    expect(screen.getByText("Fox Soccer Academy")).toBeInTheDocument();
    expect(screen.queryByText("Fox Soccer Import")).not.toBeInTheDocument();
    expect(
      await screen.findByTestId(
        "btn-preview-replace-membership-1-established-org-1",
      ),
    ).toBeEnabled();
  });
});