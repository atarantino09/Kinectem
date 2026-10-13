import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import AdminActivity from "./AdminActivity";

vi.mock("@workspace/api-client-react", () => ({ customFetch: vi.fn() }));
vi.mock("@/components/AdminLayout", () => ({ AdminLayout: ({ children }: any) => <main>{children}</main> }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

function mount() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <AdminActivity />
  </QueryClientProvider>);
}

describe("admin activity", () => {
  it("shows user events and sends role and date-sort filters", async () => {
    vi.mocked(customFetch).mockImplementation(async (url) => {
      if (String(url).endsWith("/admins")) return { data: [] };
      if (String(url).endsWith("/actions")) return { data: ["sign_in"] };
      return {
        data: [{ id: "test", actionType: "sign_in", actorType: "user", source: "activity",
          admin: { id: "coach", name: "Test Coach" }, createdAt: "2026-10-13T12:00:00Z" }],
        pagination: { totalCount: 1, hasMore: false },
      };
    });
    mount();
    expect(await screen.findByText("Test Coach")).toBeTruthy();
    expect(screen.getByText("User")).toBeTruthy();
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "Activity by role" }));
    await user.click(await screen.findByRole("option", { name: "Users only" }));
    await waitFor(() => expect(vi.mocked(customFetch).mock.calls.some(([url]) => String(url).includes("actorType=user"))).toBe(true));
    await user.click(screen.getByRole("combobox", { name: "Sort activity" }));
    await user.click(await screen.findByRole("option", { name: "Oldest first" }));
    await waitFor(() => expect(vi.mocked(customFetch).mock.calls.some(([url]) => String(url).includes("order=oldest"))).toBe(true));
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("combobox", { name: "Activity by role" }).textContent).toBe("All activity");
  });

  it("does not misreport request failures as an empty log", async () => {
    vi.mocked(customFetch).mockRejectedValue(new Error("Unavailable"));
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load activity");
    expect(screen.queryByText("No activity matches the current filters.")).toBeNull();
  });
});
