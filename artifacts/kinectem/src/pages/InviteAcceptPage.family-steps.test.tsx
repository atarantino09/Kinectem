import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import InviteAcceptPage from "./InviteAcceptPage";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), toast: vi.fn(), navigate: vi.fn(), me: { id: "parent-fixture" } as { id: string } | null }));
vi.mock("@workspace/api-client-react", () => ({
  customFetch: (...args: unknown[]) => mocks.fetch(...args),
  useGetLoggedInUser: () => ({ data: mocks.me }),
}));
vi.mock("wouter", () => ({
  useRoute: () => [true, { token: "test-parent-invite" }],
  useLocation: () => ["/invites/test-parent-invite", mocks.navigate],
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/components/family-setup/FamilySetup", () => ({
  FamilySetup: () => <div data-testid="step-two-fixture">Step 2 · Add the other parent</div>,
}));
vi.mock("@/components/invite-accept/InviteBenefitsCard", () => ({ InviteBenefitsCard: () => null }));

const envelope = {
  invite: { id: "i1", role: "player", position: "player", invitedName: null, status: "pending" },
  team: { id: "t1", name: "Example Team" },
  organization: { id: "o1", name: "Example Club" },
};

describe("parent team invitation continuation", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
    mocks.me = { id: "parent-fixture" };
  });
  it("validates once and opens step 2 automatically after parent signup", async () => {
    mocks.fetch.mockImplementation(async (url: string) => url.endsWith("/accept") ? { requiresChildSetup: true } : envelope);
    render(<QueryClientProvider client={new QueryClient()}><InviteAcceptPage /></QueryClientProvider>);
    await screen.findByTestId("step-two-fixture");
    expect(screen.queryByTestId("parent-setup-overview")).not.toBeInTheDocument();
    expect(mocks.fetch.mock.calls.filter(([url]) => url.endsWith("/accept"))).toHaveLength(1);
    expect(mocks.fetch).toHaveBeenCalledWith("/api/v1/invites/test-parent-invite/accept", { method: "POST" });
  });
  it("does not start child setup when the server rejects the invitation", async () => {
    mocks.fetch.mockImplementation(async (url: string) => {
      if (url.endsWith("/accept")) throw new Error("This invitation is for a different parent");
      return envelope;
    });
    render(<QueryClientProvider client={new QueryClient()}><InviteAcceptPage /></QueryClientProvider>);
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" })));
    expect(screen.queryByTestId("step-two-fixture")).not.toBeInTheDocument();
    expect(screen.getByTestId("btn-accept-invite")).not.toBeDisabled();
    expect(mocks.fetch.mock.calls.filter(([url]) => url.endsWith("/accept"))).toHaveLength(1);
  });
  it("keeps the first-step explanation for visitors who have not signed in", async () => {
    mocks.me = null;
    mocks.fetch.mockResolvedValue(envelope);
    render(<QueryClientProvider client={new QueryClient()}><InviteAcceptPage /></QueryClientProvider>);
    await screen.findByTestId("parent-setup-overview");
    expect(mocks.fetch.mock.calls.some(([url]) => url.endsWith("/accept"))).toBe(false);
    expect(screen.queryByTestId("step-two-fixture")).not.toBeInTheDocument();
  });
});
