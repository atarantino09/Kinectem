import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "./App";

vi.mock("@/components/Layout", () => ({
  Layout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/pages/admin/AdminDashboard", () => ({
  default: () => <div>Admin landing</div>,
}));

afterEach(() => window.history.replaceState(null, "", "/"));

describe("old in-app admin bookmark", () => {
  it("redirects Founding 100 to the admin landing instead of a dead page", async () => {
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    window.history.replaceState(null, "", `${base}/admin/founding-100`);
    render(<App />);
    expect(await screen.findByText("Admin landing")).toBeTruthy();
    expect(window.location.pathname).toBe(`${base}/admin`);
  });
});