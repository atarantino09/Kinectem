import { vi, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test";
import { customFetch } from "@workspace/api-client-react";
import DraftsPage from "./DraftsPage";

vi.mock("@workspace/api-client-react", () => ({ customFetch: vi.fn() }));

it("loads the real API drafts path and routes team and direct-org history back to the historical composer", async () => {
  vi.mocked(customFetch).mockResolvedValue({
    data: [
      { id: "article-1", title: "Team history", recapKind: "historical", team: { id: "t1", name: "Team" }, createdAt: "2026-10-02" },
      { id: "orgpost-2", title: "School history", recapKind: "historical", organizationId: "o1", team: null,
        organization: { id: "o1", name: "School" }, createdAt: "2026-10-02" },
    ],
  });
  renderWithProviders(<DraftsPage />);
  expect(await screen.findByText("Team history")).toBeTruthy();
  expect(customFetch).toHaveBeenCalledWith("/api/v1/drafts", { method: "GET" });
  expect(screen.getByText("Team history").closest("a")?.getAttribute("href")).toContain("teamId=t1&postId=article-1");
  expect(screen.getByText("School history").closest("a")?.getAttribute("href")).toContain("organizationId=o1&postId=orgpost-2");
});

it("shows a recoverable error instead of claiming saved drafts are gone", async () => {
  vi.mocked(customFetch).mockRejectedValue(new Error("connection unavailable"));
  renderWithProviders(<DraftsPage />);
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.queryByText("No drafts yet.")).toBeNull();
});