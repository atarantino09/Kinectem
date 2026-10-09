import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import InviteAcceptPage from "./InviteAcceptPage";
import { emptyDraft, loadDraft, saveDraft } from "@/lib/family-setup";
import { rememberInviteAccount } from "@/lib/parent-invite-account";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), toast: vi.fn(), navigate: vi.fn(), me: { id: "stale-cached-user" } as { id: string } | null, token: "test-parent-invite" }));
vi.mock("@workspace/api-client-react", () => ({
  customFetch: (...args: unknown[]) => mocks.fetch(...args),
  useGetLoggedInUser: () => ({ data: mocks.me }),
}));
vi.mock("wouter", () => ({
  useRoute: () => [true, { token: mocks.token }],
  useLocation: () => [`/invites/${mocks.token}`, mocks.navigate],
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/components/family-setup/FamilySetup", () => ({
  FamilySetup: ({ userId }: { userId: string }) => <div data-testid="step-two-fixture">Step 2 · Add the other parent · {userId}</div>,
}));
vi.mock("@/components/invite-accept/InviteBenefitsCard", () => ({ InviteBenefitsCard: () => null }));

const envelope = {
  invite: { id: "i1", role: "player", position: "player", invitedName: null, status: "pending" },
  team: { id: "t1", name: "Example Team" },
  organization: { id: "o1", name: "Example Club" },
};
const parent = { id: "parent-fixture", name: "Current Parent", email: "parent@example.test", role: "parent" };
const signedIn = (user = parent) => ({ authenticated: true, realUser: user });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
function mount(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return { client, ...render(<QueryClientProvider client={client}><InviteAcceptPage /></QueryClientProvider>) };
}
const accepts = () => mocks.fetch.mock.calls.filter(([url]) => url.endsWith("/accept"));
function respond(session: unknown = signedIn(), invite = envelope) {
  mocks.fetch.mockImplementation(async (url: string) => {
    if (url.endsWith("/whoami")) return session;
    if (url.endsWith("/accept")) return { requiresChildSetup: true };
    return invite;
  });
}

describe("parent team invitation account step", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
    mocks.token = "test-parent-invite";
    mocks.me = { id: "stale-cached-user" };
  });
  it("starts a signed-out visitor at all three steps with the invited team and auth links", async () => {
    respond({ authenticated: false });
    mount();
    await screen.findByTestId("btn-create-guardian");
    expect(screen.getByTestId("text-parent-steps")).toHaveTextContent("Create your parent account");
    expect(screen.getByTestId("text-parent-steps")).toHaveTextContent("Add the other parent");
    expect(screen.getByTestId("text-parent-steps")).toHaveTextContent("Create your child’s account");
    expect(screen.getByTestId("parent-setup-overview")).toHaveTextContent("Example Team");
    expect(screen.getByTestId("btn-create-guardian").closest("a")).toHaveAttribute("href", "/login?signup=parent&returnTo=%2Finvites%2Ftest-parent-invite");
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", expect.stringContaining("parentInvite=1"));
    expect(accepts()).toHaveLength(0);
  });
  it("identifies a lingering session and waits for explicit continuation", async () => {
    respond();
    mount();
    await screen.findByTestId("invite-current-account");
    expect(screen.getByTestId("invite-current-account")).toHaveTextContent("Current Parent (parent@example.test)");
    expect(screen.getByTestId("parent-setup-overview")).toBeInTheDocument();
    expect(screen.getByTestId("btn-switch-parent-account")).toBeInTheDocument();
    expect(accepts()).toHaveLength(0);
    fireEvent.click(screen.getByTestId("btn-accept-invite"));
    await screen.findByTestId("step-two-fixture");
    expect(accepts()).toHaveLength(1);
    expect(screen.queryByTestId("parent-setup-overview")).not.toBeInTheDocument();
  });
  it("validates once and opens step 2 directly after invitation-specific authentication", async () => {
    rememberInviteAccount(mocks.token, parent.id);
    respond();
    mount();
    await screen.findByTestId("step-two-fixture");
    expect(accepts()).toHaveLength(1);
    expect(screen.getByTestId("step-two-fixture")).toHaveTextContent(parent.id);
  });
  it("does not duplicate acceptance during StrictMode effects or repeated clicks", async () => {
    rememberInviteAccount(mocks.token, parent.id);
    respond();
    render(<StrictMode><QueryClientProvider client={new QueryClient()}><InviteAcceptPage /></QueryClientProvider></StrictMode>);
    await screen.findByTestId("step-two-fixture");
    expect(accepts()).toHaveLength(1);
  });
  it("ignores continuation for another invitation or adult", async () => {
    rememberInviteAccount("different-token", parent.id);
    rememberInviteAccount(mocks.token, "other-adult");
    respond();
    mount();
    await screen.findByTestId("invite-current-account");
    expect(accepts()).toHaveLength(0);
  });
  it("does not trust public accepted status to open setup for an arbitrary adult", async () => {
    respond(signedIn(), { ...envelope, invite: { ...envelope.invite, status: "accepted" } });
    mount();
    await screen.findByTestId("btn-accept-invite");
    expect(accepts()).toHaveLength(0);
    expect(screen.queryByTestId("step-two-fixture")).not.toBeInTheDocument();
  });
  it("keeps loading and stale cached users from triggering acceptance", async () => {
    const auth = deferred<unknown>();
    rememberInviteAccount(mocks.token, "stale-cached-user");
    respond(auth.promise);
    const client = new QueryClient();
    client.setQueryData(["parent-invite-session", mocks.token], signedIn({ ...parent, id: "stale-cached-user" }));
    mount(client);
    await screen.findByRole("status");
    expect(accepts()).toHaveLength(0);
    expect(screen.queryByTestId("btn-accept-invite")).not.toBeInTheDocument();
    await act(async () => auth.resolve(signedIn()));
    await screen.findByTestId("invite-current-account");
    expect(accepts()).toHaveLength(0);
  });
  it("resumes the same user's draft only after server validation", async () => {
    saveDraft(parent.id, `team:${mocks.token}`, emptyDraft());
    respond();
    mount();
    await screen.findByTestId("step-two-fixture");
    expect(accepts()).toHaveLength(1);
  });
  it("never opens a different user's saved draft", async () => {
    saveDraft("another-parent", `team:${mocks.token}`, emptyDraft());
    respond();
    mount();
    await screen.findByTestId("invite-current-account");
    expect(accepts()).toHaveLength(0);
  });
  it("shows a retryable validation error instead of setup, including on draft resumption", async () => {
    saveDraft(parent.id, `team:${mocks.token}`, emptyDraft());
    respond();
    mocks.fetch.mockImplementation(async (url: string) => {
      if (url.endsWith("/whoami")) return signedIn();
      if (url.endsWith("/accept")) throw new Error("This invitation is for a different parent");
      return envelope;
    });
    mount();
    await screen.findByRole("alert");
    expect(screen.queryByTestId("step-two-fixture")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("btn-accept-invite")).not.toBeDisabled());
    expect(accepts()).toHaveLength(1);
    respond();
    fireEvent.click(screen.getByTestId("btn-accept-invite"));
    await screen.findByTestId("step-two-fixture");
  });
  it("rechecks the session before sending acceptance", async () => {
    respond();
    mount();
    await screen.findByTestId("invite-current-account");
    respond(signedIn({ ...parent, id: "different-adult" }));
    fireEvent.click(screen.getByTestId("btn-accept-invite"));
    await waitFor(() => expect(screen.getByTestId("invite-current-account")).toBeInTheDocument());
    expect(accepts()).toHaveLength(0);
    expect(screen.queryByTestId("step-two-fixture")).not.toBeInTheDocument();
  });
  it("discards in-flight acceptance when the session changes", async () => {
    const acceptance = deferred<unknown>();
    mocks.fetch.mockImplementation(async (url: string) => url.endsWith("/whoami") ? signedIn() : url.endsWith("/accept") ? acceptance.promise : envelope);
    mount();
    await screen.findByTestId("btn-accept-invite");
    fireEvent.click(screen.getByTestId("btn-accept-invite"));
    await waitFor(() => expect(accepts()).toHaveLength(1));
    respond(signedIn({ ...parent, id: "different-adult" }));
    await act(async () => acceptance.resolve({ requiresChildSetup: true }));
    await waitFor(() => expect(screen.getByTestId("btn-accept-invite")).not.toBeDisabled());
    expect(screen.queryByTestId("step-two-fixture")).not.toBeInTheDocument();
  });
  it("hides setup immediately when a verified session changes", async () => {
    rememberInviteAccount(mocks.token, parent.id);
    respond();
    const { client } = mount();
    await screen.findByTestId("step-two-fixture");
    respond(signedIn({ ...parent, id: "different-adult" }));
    await act(async () => { await client.invalidateQueries({ queryKey: ["parent-invite-session", mocks.token] }); });
    await waitFor(() => expect(screen.queryByTestId("step-two-fixture")).not.toBeInTheDocument());
    expect(accepts()).toHaveLength(1);
  });
  it("switches only on request, clears query data, and preserves every user's family draft", async () => {
    const draft = emptyDraft();
    saveDraft("another-parent", `team:${mocks.token}`, draft);
    respond();
    const { client } = mount();
    const cancel = vi.spyOn(client, "cancelQueries");
    const clear = vi.spyOn(client, "clear");
    await screen.findByTestId("invite-current-account");
    expect(mocks.fetch.mock.calls.some(([url]) => url.endsWith("/logout"))).toBe(false);
    fireEvent.click(screen.getByTestId("btn-switch-parent-account"));
    await waitFor(() => expect(clear).toHaveBeenCalled());
    expect(cancel).toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenCalledWith("/api/v1/auth/logout", { method: "POST" });
    expect(loadDraft("another-parent", `team:${mocks.token}`)?.requestId).toBe(draft.requestId);
  });
  it("allows retrying an unavailable auth check without accepting", async () => {
    mocks.fetch.mockImplementation(async (url: string) => {
      if (url.endsWith("/whoami")) throw new Error("offline");
      return envelope;
    });
    mount();
    await screen.findByRole("button", { name: "Retry account check" });
    expect(accepts()).toHaveLength(0);
    respond();
    fireEvent.click(screen.getByRole("button", { name: "Retry account check" }));
    await screen.findByTestId("invite-current-account");
    expect(accepts()).toHaveLength(0);
  });
  it("does not restore the previous invitation's setup when the token changes", async () => {
    rememberInviteAccount(mocks.token, parent.id);
    respond();
    const { client, rerender } = mount();
    await screen.findByTestId("step-two-fixture");
    mocks.token = "new-player-invite";
    rerender(<QueryClientProvider client={client}><InviteAcceptPage /></QueryClientProvider>);
    await screen.findByTestId("invite-current-account");
    expect(screen.queryByTestId("step-two-fixture")).not.toBeInTheDocument();
    expect(accepts()).toHaveLength(1);
  });
  it("leaves coach acceptance as an explicit ordinary invitation action", async () => {
    respond(signedIn(), { ...envelope, invite: { ...envelope.invite, role: "coach", position: "assistant_coach" } });
    mount();
    await screen.findByTestId("btn-accept-invite");
    expect(screen.queryByTestId("parent-setup-overview")).not.toBeInTheDocument();
    expect(accepts()).toHaveLength(0);
    mocks.fetch.mockResolvedValue({});
    fireEvent.click(screen.getByTestId("btn-accept-invite"));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/teams/t1"));
    expect(screen.queryByTestId("step-two-fixture")).not.toBeInTheDocument();
  });
});
