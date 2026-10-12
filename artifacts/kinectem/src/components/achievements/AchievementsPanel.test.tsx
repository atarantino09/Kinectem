import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state: { data: unknown; error?: unknown } = { data: null };
const update = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-achievements", async (orig) => ({
  ...(await orig<typeof import("@/hooks/use-achievements")>()),
  useAchievements: () => ({ data: state.data, isLoading: false, isError: !!state.error, error: state.error, refetch: vi.fn() }),
  useUpdateAchievementSettings: () => ({ mutate: update, isPending: false }),
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

beforeEach(() => { state.data = null; state.error = undefined; update.mockClear(); });

describe("AchievementsPanel", () => {
  it.each([false, true])("explains the team-photo requirement without calling it a recap (earned: %s)", (earned) => {
    state.data = { ...base, subject: "team", canManage: true,
      catalog: [{ key: "team-photo", name: "Team Photo", subject: "team", thresholds: [1], criteria: 'Upload a team photo using "Add photo" at the top of your team page.' }],
      awards: earned ? [{ key: "team-photo", tier: 1, threshold: 1, earnedAt: "2026-10-12" }] : [],
      featured: earned ? ["team-photo"] : [], progress: { "team-photo": earned ? 1 : 0 },
    };
    render(<QueryClientProvider client={new QueryClient()}><AchievementsPanel subject="team" id="t" /></QueryClientProvider>);
    fireEvent.click(screen.getByTestId("button-open-achievements-team"));
    const row = screen.getByTestId("achievement-team-photo");
    expect(row.textContent).toContain("Required: upload 1 team photo");
    expect(row.textContent).toContain(earned ? "Team photo badge earned." : "No team photo yet.");
    expect(row.textContent).not.toContain("qualifying recaps");
    if (earned) expect(screen.getByTestId("button-feature-team-photo")).toHaveAttribute("aria-pressed", "true");
  });

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
  it.each(["user", "team", "organization"] as const)("provides achievement-only privacy controls for %s managers", (subject) => {
    state.data = { ...base, subject, canManage: true, visibility: "private" };
    render(<QueryClientProvider client={new QueryClient()}><AchievementsPanel subject={subject} id="u" /></QueryClientProvider>);
    expect(screen.getByTestId("text-achievements-private").textContent).toContain(subject === "user" ? "Only you" : "managers");
    fireEvent.click(screen.getByTestId(`button-open-achievements-${subject}`));
    fireEvent.click(screen.getByTestId("switch-achievements-visibility"));
    expect(update).toHaveBeenCalledWith({ visibility: "public" }, expect.any(Object));
    expect(screen.getByText(/This only affects achievements/).textContent).toContain("Public by default");
  });
  it("allows a fourth featured badge and manual removal, displaying all badges once", () => {
    const extraCatalog = [
      ...catalog,
      { key: "beyond-scoreboard", name: "Beyond the Scoreboard", thresholds: [5, 15, 30], criteria: "c", subject: "user" },
      { key: "retro-recapper", name: "Retro Recapper", thresholds: [5, 20, 50], criteria: "c", subject: "user" },
    ];
    const earned = [...awards, ...extraCatalog.slice(2).map((c) => ({ key: c.key, tier: 1, threshold: 5, earnedAt: "x" }))];
    const selected = extraCatalog.slice(0, 3).map((c) => c.key);
    state.data = { ...base, canManage: true, catalog: extraCatalog, awards: earned, featured: selected };
    const view = wrap();
    fireEvent.click(screen.getByTestId("button-open-achievements-user"));
    fireEvent.click(screen.getByTestId("button-feature-retro-recapper"));
    expect(update).toHaveBeenLastCalledWith({ featured: [...selected, "retro-recapper"] }, expect.any(Object));
    fireEvent.click(screen.getByTestId("button-feature-first-story"));
    expect(update).toHaveBeenLastCalledWith({ featured: selected.slice(1) }, expect.any(Object));
    state.data = { ...base, catalog: extraCatalog, awards: earned, featured: [...selected, "retro-recapper"] };
    view.rerender(<QueryClientProvider client={new QueryClient()}><AchievementsPanel subject="user" id="u" /></QueryClientProvider>);
    const row = screen.getByTestId("row-achievements-user");
    expect(row.querySelectorAll("li")).toHaveLength(4);
    expect(row.className).toContain("flex-wrap");
  });
});
