import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";

import { renderWithProviders } from "@/test";

const { customFetchMock, toastMock } = vi.hoisted(() => ({
  customFetchMock: vi.fn(),
  toastMock: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  customFetch: customFetchMock,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@/components/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import AdminCompetitionClaimLinks from "./AdminCompetitionClaimLinks";

describe("AdminCompetitionClaimLinks", () => {
  beforeEach(() => {
    customFetchMock.mockReset();
    toastMock.mockReset();
    customFetchMock.mockResolvedValue({
      data: [
        {
          id: "competition-1",
          name: "Legacy Fall Finale",
          type: "tournament",
          slug: "legacy-fall-finale",
          location: null,
          startDate: "2026-09-12",
          endDate: "2026-09-13",
          logoUrl: null,
          brandColor: null,
          secondaryColor: null,
          promoCode: null,
          token: "claim-token",
          messagedAt: null,
          facebookAddedAt: null,
        },
      ],
    });
  });

  it("links the competition name to its public competition page", async () => {
    renderWithProviders(<AdminCompetitionClaimLinks />);

    const link = await screen.findByTestId("link-competition-page-competition-1");
    expect(link).toHaveAttribute(
      "href",
      "/competitions/c/legacy-fall-finale",
    );
    expect(link).toHaveTextContent("Legacy Fall Finale");
  });
});