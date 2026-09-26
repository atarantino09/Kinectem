import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test";
import { AdminLayout } from "./AdminLayout";

vi.mock("@/hooks/useWhoami", () => ({
  useWhoami: () => ({
    isLoading: false,
    data: { authenticated: true, realUser: { role: "admin" } },
  }),
}));

describe("admin navigation", () => {
  it("keeps promo codes and removes the obsolete Founding 100 destination", () => {
    renderWithProviders(<AdminLayout><div>Admin content</div></AdminLayout>);
    expect(screen.getByTestId("admin-nav-promo-codes")).toBeTruthy();
    expect(screen.queryByTestId("admin-nav-founding-100")).toBeNull();
    expect(screen.getByText("Admin content")).toBeTruthy();
  });
});