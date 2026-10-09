import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ParentSetupOverview } from "./ParentSetupOverview";
import { SignUpForm } from "@/components/login-page/SignUpForm";
import { InviteHeaderCard } from "@/components/invite-accept/InviteHeaderCard";

vi.mock("wouter", () => ({ Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

function renderSignup(returnTo: string | null = null) {
  return render(<QueryClientProvider client={new QueryClient()}>
    <SignUpForm initialRole="parent" skipPathStep returnTo={returnTo}
      onSwitchSignin={vi.fn()} onError={vi.fn()} onPending={vi.fn()} />
  </QueryClientProvider>);
}

describe("parent setup messaging", () => {
  it("explains the ordered three steps and optional second parent", () => {
    render(<ParentSetupOverview />);
    const items = within(screen.getByTestId("text-parent-steps")).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Create your parent account");
    expect(items[1]).toHaveTextContent("Add the other parent");
    expect(items[1]).toHaveTextContent("(optional)");
    expect(items[1]).toHaveTextContent("or skip");
    expect(items[2]).toHaveTextContent("Create your child’s account");
    expect(screen.getByText(/They finish their own account/)).toBeInTheDocument();
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
  });
});
