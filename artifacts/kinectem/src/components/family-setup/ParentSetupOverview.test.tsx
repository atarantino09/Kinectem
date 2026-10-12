import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ParentSetupOverview } from "./ParentSetupOverview";
import { SignUpForm } from "@/components/login-page/SignUpForm";
import { InviteHeaderCard } from "@/components/invite-accept/InviteHeaderCard";

vi.mock("wouter", () => ({ Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
const fetchMock = vi.fn();
vi.mock("@workspace/api-client-react", () => ({ customFetch: (...args: unknown[]) => fetchMock(...args) }));

function renderSignup(returnTo: string | null = null) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { throwOnError: false, retry: false } } })}>
    <SignUpForm initialRole="parent" skipPathStep returnTo={returnTo}
      onSwitchSignin={vi.fn()} onError={vi.fn()} onPending={vi.fn()} />
  </QueryClientProvider>);
}

describe("parent setup messaging", () => {
  beforeEach(() => { fetchMock.mockReset(); });
  it("explains the ordered three steps and optional second parent", () => {
    render(<ParentSetupOverview />);
    const items = within(screen.getByTestId("text-parent-steps")).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Create your parent account");
    expect(items[1]).toHaveTextContent("Add the other parent");
    expect(items[1]).toHaveTextContent("(optional)");
    expect(items[1]).toHaveTextContent("or skip");
    expect(items[2]).toHaveTextContent("Create your child’s account");
    expect(screen.getByText(/They sign in or create their own parent account and accept/)).toHaveTextContent("After you finish your child’s account in Step 3");
    expect(screen.getByTestId("note-check-other-parent")).toHaveTextContent("Before you start");
  });

  it("shows the complete roadmap on the very first parent DOB screen", () => {
    renderSignup();
    expect(screen.getByTestId("form-age-gate")).toBeInTheDocument();
    expect(screen.getByTestId("parent-setup-overview")).toBeInTheDocument();
    expect(screen.getByText("Your date of birth")).toBeInTheDocument();
    expect(screen.getByText("Enter your date of birth—not your child’s.")).toBeInTheDocument();
  });

  it("does not tell an invited second parent to create another child", () => {
    renderSignup("/family-invites/guardian/existing-child-invitation");
    expect(screen.queryByTestId("parent-setup-overview")).not.toBeInTheDocument();
  });

  it("shows the same steps on the team invite before signup", () => {
    render(<InviteHeaderCard organizationName="Example Club" teamName="Example Team"
      isPlayerInvite positionLabel="Player" childHint="" loggedIn={false} accepted={false}
      needsChildSetup={false} accepting={false} token="fixture-invite" onAccept={vi.fn()} />);
    expect(screen.getByTestId("parent-setup-overview")).toBeInTheDocument();
    expect(screen.getByTestId("btn-create-guardian")).toHaveTextContent("Start with your parent account");
    expect(screen.queryByText("Create a guardian account")).not.toBeInTheDocument();
    expect(screen.getByTestId("parent-setup-overview")).toHaveTextContent("automatically be added to Example Team’s roster");
  });

  it("names the invited team during the first parent signup step", async () => {
    fetchMock.mockResolvedValue({ team: { name: "Example Team" }, organization: { name: "Example Club" }, invite: { position: "player" } });
    renderSignup("/invites/fixture-team-token");
    expect(await screen.findByText(/You are adding a child to/)).toHaveTextContent("Example Team");
    expect(screen.getByTestId("team-setup-context")).toHaveTextContent("Only add children who play on this team.");
    expect(screen.getByTestId("team-setup-context")).toHaveTextContent("Organization: Example Club");
    expect(screen.getByTestId("parent-setup-overview")).toHaveTextContent("automatically be added to Example Team’s roster");
  });

  it("does not imply a verified destination or standalone enrollment when an invite cannot load", async () => {
    fetchMock.mockRejectedValue(new Error("Invite unavailable"));
    renderSignup("/invites/unavailable");
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn’t load the team details");
    expect(screen.getByTestId("team-setup-context")).toHaveTextContent("has not been verified yet");
    expect(screen.queryByText(/Creating a child profile in Family/)).not.toBeInTheDocument();
  });

  it("keeps the first-step roadmap until the signed-in parent chooses their account", () => {
    render(<InviteHeaderCard organizationName="Example Club" teamName="Example Team"
      isPlayerInvite positionLabel="Player" childHint="" loggedIn accepted={false}
      needsChildSetup={false} accepting token="fixture-invite" onAccept={vi.fn()} />);
    expect(screen.getByTestId("parent-setup-overview")).toBeInTheDocument();
    expect(screen.getByTestId("invite-current-account")).toHaveTextContent("Step 1");
    expect(within(screen.getByTestId("parent-setup-overview")).getByText(/automatically be added/)).toHaveTextContent("Example Team’s roster");
  });
  it("does not replay Step 1 once the parent account has been validated for setup", () => {
    render(<InviteHeaderCard organizationName="Example Club" teamName="Example Team"
      isPlayerInvite positionLabel="Player" childHint="" loggedIn accepted
      needsChildSetup accepting={false} token="fixture-invite" onAccept={vi.fn()} />);
    expect(screen.queryByTestId("parent-setup-overview")).not.toBeInTheDocument();
    expect(screen.queryByTestId("btn-accept-invite")).not.toBeInTheDocument();
  });

  it("renders the real organization logo and brand colors in the invite header", () => {
    render(<InviteHeaderCard organizationName="Example Club" teamName="Example Team"
      organizationBranding={{ logoUrl: "https://example.com/club-logo.png", brandPrimaryColor: "#002266", brandSecondaryColor: "#004488" }}
      isPlayerInvite positionLabel="Player" childHint="" loggedIn={false} accepted={false}
      needsChildSetup={false} accepting={false} token="fixture-invite" onAccept={vi.fn()} />);
    const logo = screen.getByTestId("invite-org-logo");
    expect(logo).toHaveAttribute("src", "https://example.com/club-logo.png");
    expect(logo).toHaveAttribute("alt", "EXAMPLE CLUB logo");
    expect(screen.getByTestId("invite-branded-header").getAttribute("style")).toContain("#002266");
    expect(screen.getByTestId("invite-branded-header")).not.toHaveClass("from-purple-600");
    fireEvent.error(logo);
    expect(screen.queryByTestId("invite-org-logo")).not.toBeInTheDocument();
    expect(screen.getByText("EXAMPLE CLUB")).toBeInTheDocument();
  });
});
