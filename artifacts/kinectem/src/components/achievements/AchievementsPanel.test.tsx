import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state: { data: unknown; error?: unknown } = { data: null };
vi.mock("@/hooks/use-achievements", async (orig) => ({
  ...(await orig<typeof import("@/hooks/use-achievements")>()),
  useAchievements: () => ({ data: state.data, isLoading: false, isError: !!state.error, error: state.error, refetch: vi.fn() }),
  useUpdateAchievementSettings: () => ({ mutate: vi.fn(), isPending: false }),
  useAcknowledgeAchievements: () => ({ mutate: vi.fn() }),
  usePauseTeamStreak: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("wouter", () => ({ Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
import { AchievementsPanel } from "./AchievementsPanel";

const catalog = [
  { key: "first-story", name: "First Story", subject: "user", thresholds: [1], criteria: "c" },
  { key: "team-storyteller", name: "Team Storyteller", subject: "user", thresholds: [10, 25, 50], criteria: "c" },
];
const awards = [
  { key: "first-story", tier: 1, threshold: 1, earnedAt: "x" },
  { key: "team-storyteller", tier: 2, threshold: 25, earnedAt: "x" },
];
const base = { subject: "user", id: "u", canManage: false, visibility: "public", featured: [], catalog, awards, rolloutAt: "x" };
const wrap = () => render(<QueryClientProvider client={new QueryClient()}><AchievementsPanel subject="user" id="u" /></QueryClientProvider>);

beforeEach(() => { state.data = null; state.error = undefined; });

describe("AchievementsPanel", () => {
  it("shows only featured badges; viewers with none see nothing", () => {
    state.data = { ...base, featured: ["team-storyteller"] };
    wrap();
    expect(screen.getByTestId("row-achievements-user").textContent).toContain("Team Storyteller");
    expect(screen.getByTestId("row-achievements-user").textContent).not.toContain("First Story");
  });
  it("keeps the public earned collection accessible without auto-featuring badges", () => {
    state.data = base;
    const { container } = wrap();
    expect(container.textContent).toContain("View collection");
    expect(screen.queryByTestId("row-achievements-user")).toBeNull();
  });
  it("owner sees privacy switch and prompt; no pause without canPause", () => {
    state.data = { ...base, canManage: true, visibility: "private", progress: { "team-storyteller": 12 },
      streaks: [{ teamId: "t", teamName: "T", current: 2, best: 3, paused: false, deadline: "2025-01-10T23:59:59Z", status: "active", lastDay: null, canPause: false }] };
    wrap();
    expect(screen.getByTestId("text-achievements-private")).toBeTruthy();
    fireEvent.click(screen.getByTestId("button-open-achievements-user"));
    expect(screen.getByTestId("switch-achievements-visibility")).toBeTruthy();
    expect(screen.getByTestId("progress-team-storyteller").textContent).toContain("12 qualifying recaps; next: Gold at 50");
    expect(screen.getByTestId("streak-t").textContent).toContain("end of Jan 10 UTC");
    expect(screen.queryByTestId("button-pause-t")).toBeNull();
  });
  it("shows pause when canPause", () => {
    state.data = { ...base, canManage: true, streaks: [{ teamId: "t", teamName: "T", current: 2, best: 3, paused: false, deadline: null, status: "active", lastDay: null, canPause: true }] };
    wrap();
    fireEvent.click(screen.getByTestId("button-open-achievements-user"));
    expect(screen.getByTestId("button-pause-t")).toBeTruthy();
  });
  it("renders nothing on 404", () => {
    state.error = { status: 404 };
    const { container } = wrap();
    expect(container.textContent).toBe("");
  });
});
