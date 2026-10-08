import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/renderWithProviders";
import { RecapsCard } from "./RecapsCard";
import type { ManagedRecap, Snapshot, Workspace } from "@/lib/competition-results";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("@workspace/api-client-react", () => ({ customFetch: fetchMock, useGetLoggedInUser: () => ({ data: { id: "u1" } }) }));

const grp = (key: string, bracketId: string) => ({ key, label: key, gender: "", age: "", bracketId, complete: false, games: [], standings: [] });
const snap = { id: "i1", competitionId: "c1", kind: "csv", sourceUrl: null, importedAt: "", status: "ready", message: null, confirmed: true, resultsAsOf: null,
  groups: [grp("g1", "b1"), grp("g2", "b2"), grp("g3", "b3")] } as Snapshot;
const recap = (id: string, bracketId: string, published = false): ManagedRecap => ({ id, competitionId: "c1", bracketId, revision: 1, publishedAt: null, updatedAt: "",
  draft: { title: "T" + id, body: "B", importId: "i1", groupKey: "g", sourceUrl: null, resultsAsOf: null, partial: false }, published: published ? { title: "T" + id, body: "B" } : null });
const ws = (recaps: ManagedRecap[]): Workspace => ({ imports: [snap], recaps, participants: [],
  brackets: [{ id: "b1", label: "One", sortOrder: 1 }, { id: "b2", label: "Two", sortOrder: 2 }, { id: "b3", label: "Three", sortOrder: 3 }] });

beforeEach(() => fetchMock.mockReset());

describe("RecapsCard", () => {
  it("prepares, generates all missing in one request, and retries failed keys with the same requestId", async () => {
    const w = ws([recap("r1", "b1", true)]);
    const gens: any[] = [];
    fetchMock.mockImplementation(async (u: string, init?: any) => {
      const url = String(u ?? "");
      if (url.endsWith("/prepare")) return snap;
      if (url.endsWith("/results-workspace")) return w;
      if (url.endsWith("/generate")) {
        gens.push(JSON.parse(init.body));
        return gens.length === 1 ? { data: [recap("r2", "b2")], errors: [{ groupKey: "g3", error: "boom", code: "x" }] } : { data: [recap("r3", "b3")], errors: [] };
      }
      return {};
    });
    renderWithProviders(<RecapsCard cid="c1" snap={snap} ws={w} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId("btn-generate-recaps"));
    await screen.findByTestId("list-generate-errors");
    expect(gens).toHaveLength(1);
    expect(gens[0]).toMatchObject({ groupKeys: ["g2", "g3"], preserveExisting: true });
    expect(screen.getByTestId("btn-generate-recaps")).toHaveTextContent("Retry");
    await user.click(screen.getByTestId("btn-generate-recaps"));
    await waitFor(() => expect(gens).toHaveLength(2));
    expect(gens[1].requestId).toBe(gens[0].requestId);
  });

  it("batch publishes saved drafts and shows partial failures", async () => {
    const w = ws([recap("r1", "b1"), recap("r2", "b2")]);
    let body: any;
    fetchMock.mockImplementation(async (u: string, init?: any) => {
      const url = String(u ?? "");
      if (url.endsWith("/publish-batch")) { body = JSON.parse(init.body); return { data: [recap("r1", "b1", true)], errors: [{ id: "r2", error: "conflict", code: "stale" }] }; }
      return {};
    });
    renderWithProviders(<RecapsCard cid="c1" snap={snap} ws={w} />);
    await userEvent.setup().click(screen.getByTestId("btn-publish-all"));
    expect((await screen.findByTestId("list-publish-errors"))).toHaveTextContent("conflict");
    expect(body.recaps).toEqual([{ id: "r1", expectedRevision: 1 }, { id: "r2", expectedRevision: 1 }]);
  });

  it("disables batch publish while an edit is unsaved", async () => {
    const w = ws([recap("r1", "b1")]);
    renderWithProviders(<RecapsCard cid="c1" snap={snap} ws={w} />);
    expect(screen.getByTestId("btn-publish-all")).toBeEnabled();
    await userEvent.setup().type(screen.getByTestId("input-recap-title-r1"), "x");
    await waitFor(() => expect(screen.getByTestId("btn-publish-all")).toBeDisabled());
    expect(screen.getByTestId("text-dirty-block")).toBeInTheDocument();
  });
});
