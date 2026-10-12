import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestQueryClient } from "@/test/renderWithProviders";
import { useNewPostForm } from "./useNewPostForm";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  create: vi.fn(),
  toast: vi.fn(),
  navigate: vi.fn(),
  createOptions: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("wouter", () => ({ useLocation: () => ["/posts/new", mocks.navigate] }));
vi.mock("@workspace/api-client-react", async (importOriginal) => ({
  ...await importOriginal<typeof import("@workspace/api-client-react")>(),
  customFetch: mocks.fetch,
  useCreatePost: (options: unknown) => { mocks.createOptions(options); return { mutateAsync: mocks.create }; },
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const submitEvent = () => ({ preventDefault: vi.fn() } as unknown as React.FormEvent);
afterEach(() => vi.restoreAllMocks());

describe("untouched composer navigation", () => {
  it.each(["long", "short"] as const)("keeps a new %s composer pristine without navigation or unload warnings", async (initialType) => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { result } = renderForm({ initialType, initialCompetitionId: null });
    await waitFor(() => expect(result.current.isDirty).toBe(false));
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
    const link = document.createElement("a");
    link.href = "/teams/team-1";
    const click = vi.fn((event: Event) => event.preventDefault()); // avoid JSDOM native navigation
    link.addEventListener("click", click);
    document.body.append(link);
    try {
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      expect(click).toHaveBeenCalledOnce();
      act(() => result.current.requestCancel());
      expect(confirm).not.toHaveBeenCalled();
      expect(mocks.navigate).toHaveBeenCalledWith("/teams/team-1");
    } finally {
      link.remove();
    }
  });

  it.each([null, { season: "2025", gamePlayedDate: "2025-09-01", attested: true }])(
    "restores a pristine baseline on draft reopen with retro metadata %j", async (previousSeason) => {
      mocks.fetch.mockImplementation(async (url: string) => url === "/api/v1/posts/article-draft"
        ? { id: "article-draft", title: "Reopened", body: "Saved content", gameDate: "2025-09-01T12:00:00Z",
          previousSeason, context: { type: "team", id: "team-1" } }
        : { data: [], competitions: [] });
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
      const { result } = renderForm({ initialDraftId: "article-draft", initialCompetitionId: null });
      await waitFor(() => expect(result.current.title).toBe("Reopened"));
      expect(result.current.isDirty).toBe(false);
      act(() => result.current.requestCancel());
      expect(confirm).not.toHaveBeenCalled();
      act(() => result.current.previousSeason.setEnabled(!previousSeason));
      expect(result.current.isDirty).toBe(true);
      const unload = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(unload);
      expect(unload.defaultPrevented).toBe(true);
      mocks.navigate.mockClear();
      act(() => result.current.requestCancel());
      expect(confirm).toHaveBeenCalledOnce();
      expect(mocks.navigate).not.toHaveBeenCalled();
    },
  );
});

describe("serialized recap persistence", () => {
  it("coalesces rapid first saves and queues Enter publication on the canonical draft with latest edits", async () => {
    const first = deferred<{ id: string }>();
    mocks.create.mockReturnValueOnce(first.promise);
    const { result } = renderForm();
    act(() => { result.current.setTitle("Review"); result.current.setBody("First version"); });
    let save!: Promise<void>;
    let publish!: Promise<void>;
    act(() => {
      save = result.current.onSaveDraft();
      void result.current.onSaveDraft();
      publish = result.current.onPublish(submitEvent());
      void result.current.onPublish(submitEvent());
    });
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(result.current.saving).toBe(true);
    expect(result.current.publishing).toBe(true);
    act(() => result.current.setBody("Latest version"));
    await act(async () => { first.resolve({ id: "article-draft" }); await Promise.all([save, publish]); });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    const patches = mocks.fetch.mock.calls.filter(([, options]) => options?.method === "PATCH");
    expect(JSON.parse(patches.at(-1)![1].body).body).toBe("Latest version");
    expect(mocks.fetch.mock.calls.filter(([url]) => url.endsWith("/publish"))).toHaveLength(1);
    expect(result.current.saving).toBe(false);
    expect(result.current.publishing).toBe(false);
  });

  it("reuses the exact creation key and payload after an uncertain response, then saves edited content", async () => {
    mocks.create.mockRejectedValueOnce(new Error("lost response"));
    const { result } = renderForm();
    act(() => { result.current.setTitle("Review"); result.current.setBody("Original"); });
    await act(() => result.current.onPublish(submitEvent()));
    const original = mocks.create.mock.calls[0][0];
    const key = mocks.createOptions.mock.calls[0][0].request.headers["Idempotency-Key"];
    act(() => result.current.setBody("Edited while retrying"));
    await act(() => result.current.onPublish(submitEvent()));
    expect(mocks.create.mock.calls[1][0]).toEqual(original);
    expect(mocks.createOptions.mock.calls.every(([o]) => o.request.headers["Idempotency-Key"] === key)).toBe(true);
    const patch = mocks.fetch.mock.calls.find(([, options]) => options?.method === "PATCH")!;
    expect(JSON.parse(patch[1].body).body).toBe("Edited while retrying");
    await act(() => result.current.onPublish(submitEvent()));
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });

  it.each(["publish", "save"] as const)("allows a corrected first %s after a definitive 413, with a fresh request key", async (intent) => {
    mocks.create.mockRejectedValueOnce(Object.assign(new Error("Photo too large"), { status: 413 }));
    const { result } = renderForm();
    act(() => {
      result.current.setTitle("Photo recap");
      result.current.setBody("A tournament review.");
      result.current.setPhotos(["data:image/png;base64,oversized"]);
    });
    const key = mocks.createOptions.mock.lastCall![0].request.headers["Idempotency-Key"];
    await act(() => intent === "publish" ? result.current.onPublish(submitEvent()) : result.current.onSaveDraft());
    expect(mocks.create.mock.calls[0][0].data.photoUrls).toEqual(["data:image/png;base64,oversized"]);
    act(() => result.current.setPhotos([]));
    await act(() => intent === "publish" ? result.current.onPublish(submitEvent()) : result.current.onSaveDraft());
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.create.mock.calls[1][0].data.photoUrls ?? []).toEqual([]);
    expect(mocks.createOptions.mock.lastCall![0].request.headers["Idempotency-Key"]).not.toBe(key);
  });

  it("drains a delayed autosave before publishing and prevents it from overwriting newer edits", async () => {
    const patch = deferred<{ id: string }>();
    const fallback = mocks.fetch.getMockImplementation()!;
    let intercepted = false;
    mocks.fetch.mockImplementation((url: string, options?: RequestInit) => {
      if (options?.method === "PATCH" && !intercepted) { intercepted = true; return patch.promise; }
      return fallback(url, options);
    });
    const { result } = renderForm({ initialDraftId: "article-draft" });
    await waitFor(() => expect(result.current.title).toBe("Playoff win"));
    act(() => result.current.setBody("Autosave version"));
    await waitFor(() => expect(intercepted).toBe(true), { timeout: 2500 });
    act(() => result.current.setBody("Final version"));
    let publishing!: Promise<void>;
    act(() => { publishing = result.current.onPublish(submitEvent()); });
    expect(mocks.fetch.mock.calls.filter(([url]) => url.endsWith("/publish"))).toHaveLength(0);
    await act(async () => { patch.resolve({ id: "article-draft" }); await publishing; });
    const writes = mocks.fetch.mock.calls.filter(([, options]) => options?.method === "PATCH");
    expect(writes.map(([, o]) => JSON.parse(o.body).body)).toEqual(["Autosave version", "Final version"]);
    await new Promise((resolve) => setTimeout(resolve, 1300));
    expect(mocks.fetch.mock.calls.filter(([, options]) => options?.method === "PATCH")).toHaveLength(2);
  });

  it("keeps busy through publication and handles schedule failure as saved, not failed", async () => {
    const publish = deferred<{ id: string }>();
    const fallback = mocks.fetch.getMockImplementation()!;
    mocks.fetch.mockImplementation((url: string, options?: RequestInit) => {
      if (url.endsWith("/publish")) return publish.promise;
      if (url.endsWith("/link-recap")) return Promise.reject(new Error("schedule unavailable"));
      return fallback(url, options);
    });
    const { result } = renderForm({ initialDraftId: "article-draft", initialScheduleEventId: "event-1" });
    await waitFor(() => expect(result.current.title).toBe("Playoff win"));
    let operation!: Promise<void>;
    act(() => { operation = result.current.onPublish(submitEvent()); });
    await waitFor(() => expect(mocks.fetch.mock.calls.some(([url]) => url.endsWith("/publish"))).toBe(true));
    expect(result.current.saving).toBe(true);
    expect(result.current.publishing).toBe(true);
    await act(async () => { publish.resolve({ id: "article-draft" }); await operation; });
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Recap saved" }));
    expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Failed to post" }));
  });

  it("keeps failed autosaves dirty without an automatic retry loop, while allowing manual retry", async () => {
    const fallback = mocks.fetch.getMockImplementation()!;
    let failed = false;
    mocks.fetch.mockImplementation((url: string, options?: RequestInit) => {
      if (options?.method === "PATCH" && !failed) { failed = true; return Promise.reject(new Error("offline")); }
      return fallback(url, options);
    });
    const { result } = renderForm({ initialDraftId: "article-draft" });
    await waitFor(() => expect(result.current.title).toBe("Playoff win"));
    act(() => result.current.setBody("Unsaved changes"));
    await waitFor(() => expect(failed).toBe(true), { timeout: 2500 });
    await new Promise((resolve) => setTimeout(resolve, 1400));
    expect(mocks.fetch.mock.calls.filter(([, o]) => o?.method === "PATCH")).toHaveLength(1);
    expect(result.current.isDirty).toBe(true);
    await act(() => result.current.onSaveDraft());
    expect(mocks.fetch.mock.calls.filter(([, o]) => o?.method === "PATCH")).toHaveLength(2);
    expect(result.current.isDirty).toBe(false);
  });
});

describe("competition-only composer context", () => {
  it("preselects the saved overall bracket from the claimed schedule, including future deep-linked games", async () => {
    const fallback = mocks.fetch.getMockImplementation()!;
    mocks.fetch.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.endsWith("/tournament-schedule")) return { data: [{
        tournamentId: "cup-2", bracketId: "bracket-gold", matches: [{
          id: "future-match", matchDate: "2099-06-12", opponentName: "Rovers", bracketId: "bracket-gold",
        }],
      }] };
      if (url.endsWith("/brackets")) return { data: [{ id: "bracket-gold", label: "2016 U10 Boys Gold" }] };
      return fallback(url, options);
    });
    const { result } = renderForm({ initialMatchId: "future-match", initialGameDate: "2099-06-12" });
    await waitFor(() => expect(result.current.bracketId).toBe("bracket-gold"));
    act(() => { result.current.setTitle("Gold recap"); result.current.setBody("The recap."); });
    await act(() => result.current.onSaveDraft());
    expect(mocks.create.mock.calls[0][0].data.bracketId).toBe("bracket-gold");
  });
  it("keeps an explicit no-bracket choice in new recap payloads", async () => {
    const { result } = renderForm();
    act(() => {
      result.current.setTitle("No bracket"); result.current.setBody("The recap.");
      result.current.setBracketId("");
    });
    await act(() => result.current.onSaveDraft());
    expect(mocks.create.mock.calls[0][0].data.bracketId).toBeNull();
  });
  it("shows the inherited bracket and game when reopening, without treating either as a manual edit", async () => {
    const fallback = mocks.fetch.getMockImplementation()!;
    mocks.fetch.mockImplementation(async (url: string, options?: RequestInit) => {
      const response = await fallback(url, options);
      return url === "/api/v1/posts/article-draft" && options?.method === "GET"
        ? { ...response, bracketId: "bracket-gold", competitionGameId: "game-1" } : response;
    });
    const { result } = renderForm({
      initialDraftId: "article-draft", initialTeamId: null, initialCompetitionId: null,
    });
    await waitFor(() => expect(result.current.bracketId).toBe("bracket-gold"));
    expect(result.current.competitionGameId).toBe("game-1");
    act(() => result.current.setBody("Updated draft."));
    await act(() => result.current.onSaveDraft());
    const patch = mocks.fetch.mock.calls.find(([, options]) => options?.method === "PATCH")!;
    expect(JSON.parse(patch[1].body)).not.toHaveProperty("bracketId");
    expect(JSON.parse(patch[1].body)).not.toHaveProperty("competitionGameId");
  });
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
