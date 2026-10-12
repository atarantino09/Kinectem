import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Contributor } from "@/hooks/use-achievements";

const state = vi.hoisted(() => ({ data: [] as Contributor[] }));
vi.mock("@/hooks/use-achievements", () => ({
  useOrgContributors: () => ({ data: state.data, isLoading: false, isError: false }),
}));
vi.mock("wouter", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
import { ContributorsSection } from "./ContributorsSection";

beforeEach(() => { state.data = []; });
describe("public career badges", () => {
  it("starts collapsed and opens and closes from its heading", () => {
    state.data = [{ id: "coach", name: "Coach", role: "Coach", teams: [], awards: [], featured: [] }];
    render(<ContributorsSection orgId="org" />);
    const toggle = screen.getByRole("button", { name: "Coaches & Contributors (1)" });
    const card = screen.getByTestId("contributor-coach");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(card).not.toBeVisible();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(card).toBeVisible();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(card).not.toBeVisible();
  });
  it("shows all four earned selections once at highest tier in a wrapping row", () => {
    const keys = ["first-story", "team-storyteller", "beyond-scoreboard", "retro-recapper"];
    state.data = [{
      id: "coach", name: "Coach", role: "Coach", teams: [{ id: "team", name: "Team" }],
      featured: [...keys, "team-storyteller", "unearned"],
      awards: [...keys.map((key) => ({ key, tier: 1 as const, threshold: 1, earnedAt: "" })),
        { key: "team-storyteller", tier: 3, threshold: 50, earnedAt: "" }],
    }];
    render(<ContributorsSection orgId="org" />);
    fireEvent.click(screen.getByRole("button", { name: "Coaches & Contributors (1)" }));
    const card = screen.getByTestId("contributor-coach");
    expect(card.textContent).toContain("Retro Recapper");
    expect(card.textContent).toContain("Gold · 50");
    expect(card.textContent).not.toContain("Bronze · 1 ·");
    expect(card.textContent?.match(/\(career\)/g)).toHaveLength(4);
  });
  it("has no badge display when the API withholds a private career collection", () => {
    state.data = [{ id: "coach", name: "Coach", role: "Coach", teams: [], awards: [], featured: [] }];
    render(<ContributorsSection orgId="org" />);
    expect(screen.getByTestId("contributor-coach").textContent).not.toContain("(career)");
  });
});
