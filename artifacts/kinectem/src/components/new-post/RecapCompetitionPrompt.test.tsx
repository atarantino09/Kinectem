import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestQueryClient } from "@/test/renderWithProviders";
import { RecapCompetitionPrompt } from "./RecapCompetitionPrompt";

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@workspace/api-client-react", async (orig) => ({
  ...(await orig<typeof import("@workspace/api-client-react")>()),
  customFetch: mocks.fetch,
}));

const a = { id: "a", slug: "a", name: "Spring League", type: "league" };
const b = { id: "b", slug: "b", name: "Summer Cup", type: "tournament" };
const game = { id: "g1", matchNumber: "3", matchDate: "2000-01-02", startTime: null, isHome: true, opponentName: "Hawks" };
const future = { ...game, id: "g2", matchDate: "2999-01-01", opponentName: "Future FC" };

function setup(comps = [a], extra = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const ui = (cs: typeof comps) => (
    <QueryClientProvider client={client}>
      <RecapCompetitionPrompt open teamId="t1" competitions={cs} onConfirm={onConfirm} onCancel={onCancel} {...extra} />
    </QueryClientProvider>
  );
  const client = createTestQueryClient();
  const r = render(ui(comps));
  return { onConfirm, onCancel, rerender: () => r.rerender(ui(comps)) };
}

beforeEach(() => {
  mocks.fetch.mockReset();
  mocks.fetch.mockResolvedValue({ data: [{ tournamentId: "a", matches: [game, future] }] });
});

describe("RecapCompetitionPrompt", () => {
  it("routes the close button through cancel rather than silently skipping the decision", async () => {
    const user = userEvent.setup();
    const { onCancel, onConfirm } = setup();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("preselects a single competition and sends played game", async () => {
    const { onConfirm } = setup();
    const sel = await screen.findByTestId("select-game");
    expect(screen.queryByText(/Future FC/)).toBeNull();
    await userEvent.selectOptions(sel, "g1");
    await userEvent.click(screen.getByTestId("button-competition-continue"));
    expect(onConfirm).toHaveBeenCalledWith("a", game);
  });

  it("requires explicit choice with multiple competitions", async () => {
    const { onConfirm } = setup([a, b]);
    const btn = screen.getByTestId("button-competition-continue");
    expect(btn).toBeDisabled();
    await userEvent.click(screen.getByTestId("radio-competition-a"));
    await userEvent.click(btn);
    expect(onConfirm).toHaveBeenCalledWith("a", undefined);
  });

  it("opts out with empty string", async () => {
    const { onConfirm } = setup();
    await userEvent.click(screen.getByTestId("checkbox-competition-linked"));
    await userEvent.click(screen.getByTestId("button-competition-continue"));
    expect(onConfirm).toHaveBeenCalledWith("");
  });

  it("keeps selection across rerender and cancels", async () => {
    const { rerender, onCancel } = setup([a, b]);
    await userEvent.click(screen.getByTestId("radio-competition-b"));
    rerender();
    await waitFor(() => expect(screen.getByTestId("radio-competition-b")).toBeChecked());
    await userEvent.click(screen.getByTestId("button-competition-cancel"));
    expect(onCancel).toHaveBeenCalled();
  });
});
