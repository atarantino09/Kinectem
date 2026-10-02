import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test";
import { setMockSearch, wouterMock } from "@/test/mocks/wouter";
import { useToastMock } from "@/test/mocks/toast";

vi.mock("wouter", () => ({ ...wouterMock }));
vi.mock("@/hooks/use-toast", () => useToastMock);

const fetchMock = vi.fn();
vi.mock("@workspace/api-client-react", () => ({
  customFetch: (...a: unknown[]) => fetchMock(...a),
}));

import HistoricalRecapPage from "./HistoricalRecapPage";

type Call = { url: string; method: string; body: any };
const calls = (): Call[] =>
  fetchMock.mock.calls.map(([url, init]) => ({
    url: String(url),
    method: (init?.method as string) ?? "GET",
    body: init?.body ? JSON.parse(init.body as string) : null,
  }));

const existingPost = {
  id: "p1",
  title: "Old title",
  body: "Old body",
  recapKind: "historical",
  articleStatus: "draft",
  context: { type: "team", id: "team-real" },
  assets: [{ url: "/api/v1/historical-clippings/abc", fileType: "image/jpeg" }],
  historical: {
    gameDate: null,
    year: 1974,
    newspaper: null,
    byline: null,
    publicationDate: null,
    rightsConfirmed: true,
    reviewed: true,
  },
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.useRealTimers();
});
afterEach(() => vi.useRealTimers());

function route(handlers: Record<string, (c: Call) => unknown>) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const c: Call = {
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(init.body as string) : null,
    };
    for (const k of Object.keys(handlers)) {
      if (`${c.method} ${c.url}`.startsWith(k)) return handlers[k](c);
    }
    throw new Error(`unhandled ${c.method} ${c.url}`);
  });
}

describe("HistoricalRecapPage", () => {
  it("shows forbidden before any controls", async () => {
    setMockSearch("?teamId=t1");
    route({
      "GET /api/v1/historical-recaps/destination": () => {
        throw Object.assign(new Error("no"), { status: 403 });
      },
    });
    renderWithProviders(<HistoricalRecapPage />);
    expect(await screen.findByTestId("historical-forbidden")).toBeTruthy();
    expect(screen.queryByTestId("input-historical-title")).toBeNull();
  });

  it("uses canonical post context, not the query scope, and does not autosave on hydrate", async () => {
    setMockSearch("?teamId=WRONG&postId=p1");
    route({
      "GET /api/v1/posts/p1": () => existingPost,
      "GET /api/v1/historical-recaps/destination": () => ({ name: "Real Team" }),
    });
    renderWithProviders(<HistoricalRecapPage />);
    expect(await screen.findByText(/Posting to: Real Team/)).toBeTruthy();
    const dest = calls().filter((c) => c.url.includes("destination"));
    expect(dest.every((c) => c.url.includes("teamId=team-real"))).toBe(true);
    await new Promise((r) => setTimeout(r, 1800));
    expect(calls().some((c) => c.method === "PATCH")).toBe(false);
  });

  it("creates once, queues edits during an in-flight save, and publishes latest content", async () => {
    setMockSearch("?teamId=t1");
    let release: (v: unknown) => void = () => {};
    const gate = new Promise((r) => (release = r));
    route({
      "GET /api/v1/historical-recaps/destination": () => ({ name: "Tigers" }),
      "POST /api/v1/historical-recaps": async () => {
        await gate;
        return { id: "new1" };
      },
      "PATCH /api/v1/historical-recaps/new1": () => ({}),
      "POST /api/v1/posts/new1/publish": () => ({}),
    });
    renderWithProviders(<HistoricalRecapPage />);
    const title = await screen.findByTestId("input-historical-title");
    fireEvent.change(title, { target: { value: "First" } });
    await userEvent.click(screen.getByTestId("button-save-draft"));
    await waitFor(() =>
      expect(calls().filter((c) => c.method === "POST" && c.url === "/api/v1/historical-recaps")).toHaveLength(1),
    );
    fireEvent.change(title, { target: { value: "Second" } });
    await userEvent.click(screen.getByTestId("button-save-draft"));
    await act(async () => release(null));
    await waitFor(() => {
      const patches = calls().filter((c) => c.method === "PATCH");
      expect(patches.at(-1)?.body.title).toBe("Second");
    });
    expect(
      calls().filter((c) => c.method === "POST" && c.url === "/api/v1/historical-recaps"),
    ).toHaveLength(1);
  });

  it("blocks publish until rights and review are confirmed", async () => {
    setMockSearch("?teamId=t1");
    route({
      "GET /api/v1/historical-recaps/destination": () => ({ name: "Tigers" }),
    });
    renderWithProviders(<HistoricalRecapPage />);
    await screen.findByTestId("input-historical-title");
    fireEvent.change(screen.getByTestId("input-historical-title"), { target: { value: "T" } });
    await userEvent.click(screen.getByTestId("radio-date-year"));
    fireEvent.change(screen.getByTestId("input-historical-year"), { target: { value: "1980" } });
    await userEvent.click(screen.getByTestId("button-publish"));
    expect(await screen.findByTestId("text-form-error")).toBeTruthy();
    expect(calls().some((c) => c.url.includes("/publish"))).toBe(false);
    expect((screen.getByTestId("button-extract-text") as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps image and manual text when extraction fails, and resets review on transcript edit", async () => {
    setMockSearch("?postId=p1");
    route({
      "GET /api/v1/posts/p1": () => existingPost,
      "GET /api/v1/historical-recaps/destination": () => ({ name: "Real Team" }),
      "POST /api/v1/ai/transcribe": () => {
        throw Object.assign(new Error("Provider down"), { status: 502 });
      },
      "PATCH /api/v1/historical-recaps/p1": () => ({}),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ blob: async () => new Blob(["x"], { type: "image/png" }) })),
    );
    vi.stubGlobal(
      "Image",
      class {
        naturalWidth = 100;
        naturalHeight = 100;
        onload: (() => void) | null = null;
        set src(_v: string) {
          setTimeout(() => this.onload?.(), 0);
        }
      },
    );
    renderWithProviders(<HistoricalRecapPage />);
    const reviewed = await screen.findByTestId("checkbox-reviewed");
    expect(reviewed.getAttribute("data-state")).toBe("checked");
    fireEvent.change(screen.getByTestId("textarea-historical-body"), { target: { value: "Edited text" } });
    await waitFor(() =>
      expect(screen.getByTestId("checkbox-reviewed").getAttribute("data-state")).toBe("unchecked"),
    );
    await userEvent.click(screen.getByTestId("checkbox-provider-consent"));
    await userEvent.click(screen.getByTestId("button-extract-text"));
    await userEvent.click(await screen.findByTestId("button-confirm-replace"));
    expect(await screen.findByTestId("text-extract-error")).toBeTruthy();
    expect((screen.getByTestId("textarea-historical-body") as HTMLTextAreaElement).value).toBe("Edited text");
    expect(calls().find((c) => c.url.includes("transcribe"))?.body.teamId).toBe("team-real");
    vi.unstubAllGlobals();
  });
});
