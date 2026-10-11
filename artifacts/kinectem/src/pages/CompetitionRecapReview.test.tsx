import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { customFetch } from "@workspace/api-client-react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { CurationPanel } from "./CompetitionConsolePage";
import SettingsPage from "./SettingsPage";

vi.mock("@workspace/api-client-react", async importOriginal => ({
  ...await importOriginal<typeof import("@workspace/api-client-react")>(),
  customFetch: vi.fn(),
}));
const fetchMock = vi.mocked(customFetch);

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/app/competitions/cup?recaps=pending#recaps");
});

describe("competition review console", () => {
  it("auto-expands a deep link, uses typed View IDs, and preserves reviewed state through feature/unfeature", async () => {
    const recap = {
      id: "recap-id", postId: "article-recap-id", title: "The complete story",
      teamName: "Demo team", teamId: "demo-team", featured: false, reviewState: "pending",
      createdAt: "2026-10-10T12:00:00Z", effectiveGameDate: "2026-10-10", bracketId: null,
    };
    fetchMock.mockImplementation(async (url, init) => {
      if (String(url).endsWith("/brackets")) {
        return { data: [{ id: "bracket-id", label: "Demo bracket" }] } as never;
      }
      if (init?.method === "POST") {
        recap.featured = JSON.parse(String(init.body)).featured;
        recap.reviewState = recap.featured ? "featured" : "reviewed";
        return {} as never;
      }
      const selected = new URL(String(url), "https://example.test").searchParams.get("review");
      return {
        data: selected === recap.reviewState ? [{ ...recap }] : [],
        pendingCount: recap.reviewState === "pending" ? 1 : 0,
        reviewedCount: recap.reviewState === "reviewed" ? 1 : 0,
        featuredCount: recap.reviewState === "featured" ? 1 : 0,
        nextOffset: null,
      } as never;
    });
    const user = userEvent.setup();
    renderWithProviders(<CurationPanel competitionId="cup" />);
    expect(await screen.findByText("The complete story")).toBeInTheDocument();
    expect(screen.getByTestId("recap-actions-recap-id")).toHaveClass("grid", "grid-cols-2", "w-full", "min-w-0");
    expect(screen.getByTestId("select-recap-bracket-recap-id")).toHaveClass("col-span-2", "w-full");
    expect(screen.getByTestId("btn-review-recap-id")).toHaveClass("col-span-2", "whitespace-normal");
    expect(screen.getByRole("button", { name: "Pending (1)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reviewed / not featured (0)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Featured (0)" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View/ })).toHaveAttribute("href", "/app/posts/article-recap-id");
    expect(screen.getByRole("link", { name: "Competition recap email settings" })).toHaveAttribute("href", "/app/settings#email-notifications");
    await user.click(screen.getByRole("button", { name: "Reviewed — don’t feature" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Pending (0)" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Reviewed / not featured (1)" })).toBeInTheDocument();
    await user.click(screen.getByTestId("recaps-view-reviewed"));
    expect(await screen.findByText("Reviewed · not featured")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Feature$/ }));
    await user.click(screen.getByTestId("recaps-view-featured"));
    expect(await screen.findByText("Featured · reviewed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Featured (1)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reviewed / not featured (0)" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Remove from rail/ }));
    await user.click(screen.getByTestId("recaps-view-reviewed"));
    expect(await screen.findByText("Reviewed · not featured")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reviewed / not featured (1)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Featured (0)" })).toBeInTheDocument();
  });

  it("lets an administrator reach older outstanding rows rather than stopping at 100", async () => {
    fetchMock.mockImplementation(async url => {
      const offset = new URL(String(url), "https://example.test").searchParams.get("offset");
      return { data: [], pendingCount: 103, reviewedCount: 205, featuredCount: 101, nextOffset: offset === "0" ? 100 : null } as never;
    });
    renderWithProviders(<CurationPanel competitionId="cup" />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Older recaps" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("offset=100"), expect.anything()));
    expect(await screen.findByRole("button", { name: "Newer recaps" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reviewed / not featured (205)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Featured (101)" })).toBeInTheDocument();
  });
  it("shows zero on every tab when the competition has no eligible recaps", async () => {
    fetchMock.mockResolvedValue({ data: [], pendingCount: 0, reviewedCount: 0, featuredCount: 0, nextOffset: null } as never);
    renderWithProviders(<CurationPanel competitionId="cup" />);
    await screen.findByText("No recaps in this view.");
    for (const name of ["Pending (0)", "Reviewed / not featured (0)", "Featured (0)"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });
});

describe("personal competition recap email controls", () => {
  const defaults = {
    socialFollow: true, socialComment: true, socialReaction: true, socialTag: true,
    teamRecap: true, teamRoster: true, teamBroadcast: true, reminderSchedule: true,
    reminderGameRecap: true, digestWeekly: true, motivational: true, pauseAll: false,
    competitionRecapMode: "digest",
  };
  it("saves the personal delivery mode without overwriting unrelated preferences", async () => {
    fetchMock.mockResolvedValue(defaults);
    renderWithProviders(<SettingsPage />);
    const select = await screen.findByLabelText("Competition recap review emails");
    expect(select).toHaveValue("digest");
    await userEvent.setup().selectOptions(select, "immediate");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/v1/notifications/preferences", expect.objectContaining({
      method: "PUT", body: JSON.stringify({ competitionRecapMode: "immediate" }),
    })));
  });
  it("shows the saved mode but disables email controls while all emails are paused", async () => {
    fetchMock.mockResolvedValue({ ...defaults, competitionRecapMode: "off", pauseAll: true });
    renderWithProviders(<SettingsPage />);
    const select = await screen.findByLabelText("Competition recap review emails");
    expect(select).toHaveValue("off");
    expect(select).toBeDisabled();
  });
});
