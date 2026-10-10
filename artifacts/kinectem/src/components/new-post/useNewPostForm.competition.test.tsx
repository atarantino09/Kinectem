import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestQueryClient } from "@/test/renderWithProviders";
import { useNewPostForm } from "./useNewPostForm";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  create: vi.fn(),
  toast: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("wouter", () => ({ useLocation: () => ["/posts/new", mocks.navigate] }));
vi.mock("@workspace/api-client-react", async (importOriginal) => ({
  ...await importOriginal<typeof import("@workspace/api-client-react")>(),
  customFetch: mocks.fetch,
  useCreatePost: () => ({ mutateAsync: mocks.create }),
  useCreatePostTags: () => ({ mutateAsync: vi.fn() }),
  useDeletePost: () => ({ mutateAsync: vi.fn() }),
  useGetLoggedInUser: () => ({ data: { id: "author-1" } }),
}));

const initial = {
  initialType: "long" as const,
  initialDraftId: null,
  initialEditId: null,
  initialTeamId: "team-1",
  initialCompetitionId: "cup-2",
  initialFrom: "/teams/team-1",
};

function renderForm(params: Partial<Parameters<typeof useNewPostForm>[0]> = {}) {
  const client = createTestQueryClient();
  return renderHook(() => useNewPostForm({ ...initial, ...params }), {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockResolvedValue({ id: "article-draft", context: { type: "team", id: "team-1" } });
  mocks.fetch.mockImplementation(async (url: string, options?: RequestInit) => {
    if (url.endsWith("/claimed-competitions")) return { competitions: [{ id: "cup-2", name: "Cup Two" }] };
    if (url.endsWith("/tournament-schedule")) return { data: [] };
    if (url.endsWith("/brackets")) return { data: [] };
    if (options?.method === "GET" && url === "/api/v1/posts/article-draft") {
      return { id: "article-draft", title: "Playoff win", body: "A great extra game.",
        gameDate: "2026-06-12T12:00:00.000Z", context: { type: "team", id: "team-1" }, competition: { id: "cup-2" } };
    }
    return { id: "article-draft", status: "published" };
  });
});

describe("competition-only composer context", () => {
  it("starts with no date, opponent, or match and keeps explicit context through create and autosave", async () => {
    const { result } = renderForm();
    expect(result.current.competitionId).toBe("cup-2");
    expect(result.current.competitionGameId).toBe("");
    expect(result.current.gameDate).toBe("");
    act(() => {
      result.current.setTitle("Playoff win");
      result.current.setBody("An unlisted game.");
      result.current.setGameDate("2026-06-12");
    });
    await act(() => result.current.onSaveDraft());
    expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      postType: "long", status: "draft", context: { type: "team", id: "team-1" },
      competitionId: "cup-2", competitionGameId: null,
      gameDate: "2026-06-12T12:00:00.000Z",
    }) });
    expect(mocks.create.mock.calls[0][0].data).not.toHaveProperty("opponentName");
    act(() => result.current.setBody("More playoff details."));
    await waitFor(() => {
      const patch = mocks.fetch.mock.calls.find(([, options]) => options?.method === "PATCH");
      expect(patch).toBeDefined();
      expect(JSON.parse(patch![1].body)).toMatchObject({ competitionId: "cup-2", competitionGameId: null });
    }, { timeout: 2500 });
  });

  it("reopens with the saved competition and leaves untouched match and bracket links absent on save and publish", async () => {
    const { result } = renderForm({ initialDraftId: "article-draft", initialTeamId: null, initialCompetitionId: null });
    await waitFor(() => expect(result.current.title).toBe("Playoff win"));
    expect(result.current.competitionId).toBe("cup-2");
    expect(result.current.composerTeamId).toBe("team-1");
    act(() => result.current.setBody("Edited after reopening."));
    await act(() => result.current.onSaveDraft());
    const patch = mocks.fetch.mock.calls.find(([, options]) => options?.method === "PATCH")!;
    const payload = JSON.parse(patch[1].body);
    expect(payload).not.toHaveProperty("competitionId");
    expect(payload).not.toHaveProperty("competitionGameId");
    expect(payload).not.toHaveProperty("bracketId");
    await act(() => result.current.onPublish({ preventDefault: vi.fn() } as unknown as React.FormEvent));
    expect(mocks.fetch).toHaveBeenCalledWith("/api/v1/posts/article-draft/publish", expect.objectContaining({ method: "POST" }));
    expect(mocks.navigate).toHaveBeenCalledWith("/teams/team-1");
  });

  it("autosaves an optional game selection even when its date matches the existing date", async () => {
    const { result } = renderForm({ initialDraftId: "article-draft", initialCompetitionId: null });
    await waitFor(() => expect(result.current.title).toBe("Playoff win"));
    act(() => result.current.setCompetitionGameId("game-1", {
      id: "game-1", matchNumber: "1", matchDate: "2026-06-12",
      startTime: null, isHome: true, opponentName: "Rovers",
    }));
    await waitFor(() => {
      const patch = mocks.fetch.mock.calls.find(([, options]) => options?.method === "PATCH");
      expect(patch).toBeDefined();
      expect(JSON.parse(patch![1].body)).toMatchObject({ competitionId: "cup-2", competitionGameId: "game-1" });
    }, { timeout: 2500 });
  });

  it.each(["entering", "selecting"])("keeps an undated competition draft blank on reopen, then saves and publishes after %s a date", async (dateChoice) => {
    mocks.fetch.mockImplementation(async (url: string) => url === "/api/v1/posts/article-draft"
      ? { id: "article-draft", title: "Undated playoff", gameDate: null, competition: { id: "cup-2" }, context: { type: "team", id: "team-1" } }
      : { data: [], competitions: [] });
    const { result } = renderForm({ initialDraftId: "article-draft", initialCompetitionId: null });
    await waitFor(() => expect(result.current.title).toBe("Undated playoff"));
    expect(result.current.gameDate).toBe("");
    expect(result.current.tagRoster).toBe(false);
    act(() => {
      result.current.setBody("Playoff details entered after reopening.");
      if (dateChoice === "entering") {
        result.current.setGameDate("2026-06-20");
      } else {
        result.current.setCompetitionGameId("game-2", {
          id: "game-2", matchNumber: "2", matchDate: "2026-06-20",
          startTime: null, isHome: true, opponentName: "Rovers",
        });
      }
    });
    expect(result.current.tagRoster).toBe(true);
    await act(() => result.current.onSaveDraft());
    const saved = mocks.fetch.mock.calls.find(([, options]) => options?.method === "PATCH")!;
    expect(JSON.parse(saved[1].body).gameDate).toBe("2026-06-20T12:00:00.000Z");
    mocks.fetch.mockClear();
    await act(() => result.current.onPublish({ preventDefault: vi.fn() } as unknown as React.FormEvent));
    const published = mocks.fetch.mock.calls.find(([, options]) => options?.method === "PATCH")!;
    expect(JSON.parse(published[1].body).gameDate).toBe("2026-06-20T12:00:00.000Z");
    expect(mocks.fetch).toHaveBeenCalledWith("/api/v1/posts/article-draft/publish", expect.objectContaining({ method: "POST" }));
  });

  it("preserves an explicit roster-tag opt-out on an already-dated draft", async () => {
    const { result } = renderForm({ initialDraftId: "article-draft", initialCompetitionId: null });
    await waitFor(() => expect(result.current.title).toBe("Playoff win"));
    act(() => result.current.setTagRoster(false));
    act(() => result.current.setGameDate("2026-06-20"));
    expect(result.current.tagRoster).toBe(false);
    await act(() => result.current.onSaveDraft());
    const saved = mocks.fetch.mock.calls.find(([, options]) => options?.method === "PATCH")!;
    expect(JSON.parse(saved[1].body).gameDate).toBeNull();
  });

  it("preserves ordinary and match-specific recap defaults", () => {
    const ordinary = renderForm({ initialCompetitionId: null });
    expect(ordinary.result.current.gameDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const match = renderForm({ initialMatchId: "game-1", initialGameDate: "2026-06-12", initialOpponent: "Rovers" });
    expect(match.result.current.gameDate).toBe("2026-06-12");
    expect(match.result.current.competitionGameId).toBe("game-1");
  });

  it("sends explicit null on a new non-competition recap instead of allowing automatic competition attribution", async () => {
    const { result } = renderForm({ initialCompetitionId: null });
    act(() => {
      result.current.setTitle("Friendly win");
      result.current.setBody("A friendly match outside our tournament.");
      result.current.setCompetitionId("");
    });
    await act(() => result.current.onSaveDraft());
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ competitionId: null }),
    }));
  });

  it("persists a prompted competition and its chosen game on a regular recap", async () => {
    const { result } = renderForm({ initialCompetitionId: null });
    act(() => {
      result.current.setTitle("Cup win");
      result.current.setBody("A strong cup performance.");
      result.current.setCompetitionId("cup-2");
      result.current.setCompetitionGameId("game-1", {
        id: "game-1", matchNumber: "1", matchDate: "2026-06-12",
        startTime: null, isHome: true, opponentName: "Rovers",
      });
    });
    await act(() => result.current.onSaveDraft());
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        competitionId: "cup-2", competitionGameId: "game-1",
        gameDate: "2026-06-12T12:00:00.000Z", opponentName: "Rovers",
      }),
    }));
  });
});
