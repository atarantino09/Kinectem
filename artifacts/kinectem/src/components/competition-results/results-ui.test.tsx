import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/renderWithProviders";
import { PublishedRecaps } from "./PublishedRecaps";
import { BracketStoryLink } from "./BracketStoryLink";
import { TeamRecapCards } from "./TeamRecapCards";
import { RecapEditor, ResultsConsole } from "./ResultsConsole";
import { ImportCard } from "./ImportCard";
import { ResultsEntryPanel } from "./ResultsEntryPanel";
import type { ManagedRecap } from "@/lib/competition-results";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("@workspace/api-client-react", () => ({
  customFetch: fetchMock,
  useGetLoggedInUser: () => ({ data: { id: "u1" } }),
}));

const story = (o: Record<string, unknown>) => ({
  id: "s1", competitionId: "c1", bracketId: "b1", bracketLabel: "Boys U12", bracketOrder: 1,
  title: "Gold final", body: "Body", sourceUrl: null, resultsAsOf: null, partial: false,
  publishedAt: "2026-07-12T00:00:00Z", updatedAt: "2026-07-12T00:00:00Z",
  competition: { id: "c1", name: "Summer Cup", slug: "summer", logoUrl: null, brandColor: null, secondaryColor: null },
  coverage: [{ id: "article-1", title: "Team win", teamId: "t1", teamName: "Comets", bracketId: "b1", summary: null, gameDate: null }],
  ...o,
});

beforeEach(() => fetchMock.mockReset());

describe("visible post-competition results entry", () => {
  it("uses the native showPicker API during the CSV button click when available", async () => {
    renderWithProviders(<ImportCard cid="c1" onImported={vi.fn()} />);
    const picker = screen.getByTestId("input-import-file") as HTMLInputElement;
    const showPicker = vi.fn();
    Object.defineProperty(picker, "showPicker", { value: showPicker, configurable: true });
    await userEvent.setup().click(screen.getByTestId("tab-import-csv"));
    expect(showPicker).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("tab-import-csv")).toHaveAttribute("aria-selected", "true");
  });
  it("opens the file picker directly when CSV Results is clicked, including when already selected", async () => {
    renderWithProviders(<ImportCard cid="c1" onImported={vi.fn()} />);
    const picker = screen.getByTestId("input-import-file");
    const click = vi.spyOn(picker, "click").mockImplementation(() => {});
    const user = userEvent.setup();
    await user.click(screen.getByTestId("tab-import-csv"));
    expect(click).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("tab-import-csv")).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByTestId("tab-import-csv"));
    expect(click).toHaveBeenCalledTimes(2);
    expect(fetchMock).not.toHaveBeenCalled();
    click.mockRestore();
  });

  it("shows separate URL and upload fields immediately, with a route to bracket recaps", () => {
    renderWithProviders(<ResultsEntryPanel competitionId="c1" />);
    expect(screen.getByTestId("section-post-competition-results")).toHaveTextContent("After your tournament or league");
    expect(screen.getByLabelText("Results page URL")).toBeVisible();
    expect(screen.getByLabelText("Or upload results (.csv)")).toBeVisible();
    expect(screen.getByTestId("btn-review-results-recaps").closest("a")).toHaveAttribute("href", "/competitions/c1/results");
    expect(screen.getByTestId("btn-run-import")).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("imports the pasted URL without publishing a recap", async () => {
    const imported = vi.fn();
    fetchMock.mockResolvedValue({ id: "import-1" });
    renderWithProviders(<ImportCard cid="c1" onImported={imported} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Results page URL"), "https://results.example/finals");
    await user.click(screen.getByTestId("btn-run-import"));
    await waitFor(() => expect(imported).toHaveBeenCalledWith({ id: "import-1" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/competitions/c1/results-import");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ kind: "url", url: "https://results.example/finals" });
  });

  it("reads an uploaded CSV and imports its contents as results", async () => {
    const imported = vi.fn();
    const csv = "Bracket,Home Team,Away Team,Home Score,Away Score\nGold,Comets,Hawks,3,1";
    fetchMock.mockResolvedValue({ id: "import-2" });
    renderWithProviders(<ImportCard cid="c1" onImported={imported} />);
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText("Or upload results (.csv)"), new File([csv], "final-results.csv", { type: "text/csv" }));
    await waitFor(() => expect(screen.getByTestId("input-import-text")).toHaveValue(csv));
    expect(screen.getByTestId("tab-import-csv")).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByTestId("btn-run-import"));
    await waitFor(() => expect(imported).toHaveBeenCalledWith({ id: "import-2" }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ kind: "csv", text: csv });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects an oversized results CSV and clears earlier file contents", async () => {
    renderWithProviders(<ImportCard cid="c1" onImported={vi.fn()} />);
    const user = userEvent.setup();
    const field = screen.getByLabelText("Or upload results (.csv)");
    await user.upload(field, new File(["Gold,Comets,Hawks,3,1"], "valid.csv", { type: "text/csv" }));
    await waitFor(() => expect(screen.getByTestId("btn-run-import")).toBeEnabled());
    await user.upload(field, new File(["x".repeat(600_000)], "oversized.csv", { type: "text/csv" }));
    expect(screen.getByTestId("text-file-error")).toHaveTextContent("500 KB");
    expect(screen.getByTestId("input-import-text")).toHaveValue("");
    expect(screen.getByTestId("btn-run-import")).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

it("keeps unsaved edits when another operator saves a newer revision", async () => {
  const recap: ManagedRecap = {
    id: "s1", competitionId: "c1", bracketId: "b1", revision: 1, publishedAt: null, updatedAt: "",
    draft: {title: "Original", body: "Original body", importId: "i1", groupKey: "g1", sourceUrl: null, resultsAsOf: "", partial: true},
    published: null,
  };
  const { rerender } = renderWithProviders(<RecapEditor cid="c1" recap={recap} label="Gold" onDirty={() => {}} />);
  await userEvent.setup().type(screen.getByTestId("input-recap-title-s1"), " with my edits");
  rerender(<RecapEditor cid="c1" recap={{...recap, revision: 2, draft: {...recap.draft, title: "Other operator"}}} label="Gold" onDirty={() => {}} />);
  expect(screen.getByTestId("input-recap-title-s1")).toHaveValue("Original with my edits");
  expect(screen.getByTestId("recap-edit-conflict")).toBeInTheDocument();
  expect(screen.getByTestId("btn-save-recap-s1")).toBeDisabled();
});

it("does not roll a successful save back to an older cached workspace revision", async () => {
  const recap: ManagedRecap = {
    id: "s1", competitionId: "c1", bracketId: "b1", revision: 1, publishedAt: null, updatedAt: "",
    draft: {title: "Original", body: "Original body", importId: "i1", groupKey: "g1", sourceUrl: null, resultsAsOf: "", partial: true},
    published: null,
  };
  fetchMock.mockResolvedValue({...recap, revision: 2, draft: {...recap.draft, title: "Original edited"}});
  renderWithProviders(<RecapEditor cid="c1" recap={recap} label="Gold" onDirty={() => {}} />);
  const user = userEvent.setup();
  await user.type(screen.getByTestId("input-recap-title-s1"), " edited");
  await user.click(screen.getByTestId("btn-save-recap-s1"));
  await waitFor(() => expect(screen.getByTestId("btn-save-recap-s1")).toBeDisabled());
  expect(screen.getByTestId("input-recap-title-s1")).toHaveValue("Original edited");
  expect(screen.queryByTestId("recap-edit-conflict")).toBeNull();
});

describe("PublishedRecaps", () => {
  it("renders grouped stories, coverage and unattributed coverage", async () => {
    fetchMock.mockResolvedValue({
      data: [story({})], coverage: [],
      unattributedCoverage: [{ id: "article-9", title: "Loose", teamId: "t2", teamName: "Hawks", bracketId: null, summary: null, gameDate: null }],
    });
    renderWithProviders(<PublishedRecaps competitionId="c1" brand="#123456" />);
    expect(await screen.findByTestId("story-s1")).toBeInTheDocument();
    expect(screen.getByTestId("link-coverage-article-1")).toHaveAttribute("href", "/posts/article-1");
    expect(screen.getByTestId("link-coverage-article-9")).toBeInTheDocument();
    expect(screen.getByTestId("link-story-s1")).toHaveAttribute("href", "/competitions/stories/s1");
  });
});

describe("BracketStoryLink", () => {
  it("links only when story coverage includes this post", async () => {
    fetchMock.mockResolvedValue({ data: [story({})], coverage: [], unattributedCoverage: [] });
    renderWithProviders(<BracketStoryLink competitionId="c1" postId="article-1" />);
    expect(await screen.findByTestId("link-bracket-story")).toBeInTheDocument();
  });
  it("renders nothing for a post not in coverage", async () => {
    fetchMock.mockResolvedValue({ data: [story({})], coverage: [], unattributedCoverage: [] });
    renderWithProviders(<BracketStoryLink competitionId="c1" postId="article-404" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByTestId("link-bracket-story")).toBeNull();
  });
});

describe("PublishedRecaps gaps", () => {
  it("shows byline, source, as-of, partial; coverage without a story; dedups", async () => {
    const cov = (id: string, bid: string | null) => ({ id, title: id, teamId: "t", teamName: "T", bracketId: bid, summary: null, gameDate: null });
    fetchMock.mockResolvedValue({
      data: [story({ partial: true, sourceUrl: "https://src.example", resultsAsOf: "2026-07-12T10:00:00Z" })],
      coverage: [cov("article-1", "b1"), cov("article-5", "b2")],
      unattributedCoverage: [cov("article-9", null), cov("article-5", null)],
    });
    renderWithProviders(<PublishedRecaps competitionId="c1" brand="#123456" />);
    expect(await screen.findByTestId("badge-story-partial-s1")).toBeInTheDocument();
    expect(screen.getByTestId("text-story-meta-s1")).toHaveTextContent("Tournament recap by Summer Cup");
    expect(screen.getByTestId("link-story-source-s1")).toHaveAttribute("href", "https://src.example");
    expect(screen.getByTestId("list-bracket-coverage-b2")).toBeInTheDocument();
    expect(screen.getAllByTestId("link-coverage-article-1")).toHaveLength(1);
    expect(screen.getAllByTestId("link-coverage-article-5")).toHaveLength(1);
    expect(screen.getByTestId("link-coverage-article-9")).toBeInTheDocument();
  });
});

describe("TeamRecapCards", () => {
  it("shows error with retry", async () => {
    fetchMock.mockImplementation(async () => { throw new Error("boom"); });
    renderWithProviders(<TeamRecapCards teamId="t1" canManage={false} />);
    expect(await screen.findByTestId("error-team-recaps")).toBeInTheDocument();
    expect(screen.getByTestId("btn-retry-team-recaps")).toBeInTheDocument();
    fetchMock.mockResolvedValue({ data: [] });
    await userEvent.setup().click(screen.getByTestId("btn-retry-team-recaps"));
    await waitFor(() => expect(screen.queryByTestId("error-team-recaps")).toBeNull());
  });
  it("shows attribution and manager-only removal", async () => {
    fetchMock.mockResolvedValue({ data: [story({})] });
    const { unmount } = renderWithProviders(<TeamRecapCards teamId="t1" canManage={false} />);
    expect(await screen.findByText(/Tournament recap by Summer Cup/)).toBeInTheDocument();
    expect(screen.queryByTestId("btn-remove-team-recap-s1")).toBeNull();
    unmount();
    renderWithProviders(<TeamRecapCards teamId="t1" canManage />);
    expect(await screen.findByTestId("btn-remove-team-recap-s1")).toBeInTheDocument();
  });
});

describe("ResultsConsole", () => {
  it("blocks confirm until mappings are explicit and shows partial provenance", async () => {
    fetchMock.mockResolvedValue({
      brackets: [{ id: "b1", label: "Boys U12", sortOrder: 1 }],
      participants: [{ id: "p1", name: "Comets", gender: "boys", age: "U12", division: "Gold", bracket: "A", bracketId: "b1", teamId: "t1" }],
      recaps: [],
      imports: [{
        id: "i1", competitionId: "c1", kind: "url", sourceUrl: "https://r.example/x", importedAt: "2026-07-12T00:00:00Z",
        status: "partial", message: "2 pages unreachable", confirmed: false, resultsAsOf: "2026-07-12T10:00",
        groups: [{ key: "g1", label: "U12 Gold", gender: "boys", age: "U12", bracketId: null, complete: false,
          games: [{ id: "x1", home: "Comets", away: "Hawks", homeScore: 1, awayScore: 0, date: "2026-07-11", group: "g1", homeParticipantId: null, awayParticipantId: null }],
          standings: [] }],
      }],
    });
    renderWithProviders(<ResultsConsole competitionId="c1" />);
    await userEvent.setup().click(await screen.findByText("Advanced: review source results"));
    expect(await screen.findByTestId("badge-snapshot-status")).toHaveTextContent("partial");
    expect(screen.getByTestId("text-provenance")).toHaveTextContent("https://r.example/x");
    expect(screen.getByTestId("badge-incomplete-g1")).toBeInTheDocument();
    const confirm = screen.getByTestId("btn-confirm-mappings");
    expect(confirm).toBeDisabled();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByTestId("select-bracket-g1"), "b1");
    await user.selectOptions(screen.getByTestId("map-home-x1"), "p1");
    expect(confirm).toBeDisabled();
    await user.selectOptions(screen.getByTestId("map-away-x1"), "__external__");
    await waitFor(() => expect(confirm).toBeEnabled());
  });
});

describe("ResultsConsole review gaps", () => {
  const dup = (confirmed: boolean) => ({
    brackets: [{ id: "b1", label: "Boys U12", sortOrder: 1 }],
    participants: [
      { id: "p1", name: "Comets", gender: "boys", age: "U12", division: "Gold", bracket: "A", bracketId: "b1", teamId: null },
      { id: "p2", name: "Comets", gender: "girls", age: "U12", division: "Gold", bracket: "B", bracketId: null, teamId: null },
    ],
    recaps: [],
    imports: [{
      id: "i1", competitionId: "c1", kind: "csv", sourceUrl: null, importedAt: "2026-07-12T00:00:00Z",
      status: "ready", message: null, confirmed, resultsAsOf: "2026-07-12T10:00:00.000Z",
      groups: [{ key: "g1", label: "U12", gender: "boys", age: "U12", bracketId: "b1", complete: false,
        games: [{ id: "x1", home: "Comets", away: "Hawks", homeScore: 1, awayScore: null, date: "d", group: "g1", homeParticipantId: null, awayParticipantId: null }],
        standings: [{ team: "Comets", position: 1, points: 3, participantId: null }] }],
    }],
  });
  it("lists every same-name candidate with metadata, toggle disabled until scores present, editable group/standing names", async () => {
    fetchMock.mockResolvedValue(dup(false));
    renderWithProviders(<ResultsConsole competitionId="c1" />);
    await userEvent.setup().click(await screen.findByText("Advanced: review source results"));
    const cands = await screen.findByTestId("cands-home-x1");
    expect(cands).toHaveTextContent("2 teams share this name");
    expect(cands).toHaveTextContent("gender girls, age U12, division Gold, bracket B");
    expect(screen.getByTestId("check-complete-g1")).toBeDisabled();
    expect(screen.getByTestId("input-game-group-x1")).toBeEnabled();
    expect(screen.getByTestId("input-standing-team-g1-0")).toBeEnabled();
    const user = userEvent.setup();
    await user.type(screen.getByTestId("input-awayScore-x1"), "2");
    expect(screen.getByTestId("check-complete-g1")).toBeEnabled();
  });
  it("converts ISO as-of to local input and is read-only once confirmed", async () => {
    fetchMock.mockResolvedValue(dup(true));
    renderWithProviders(<ResultsConsole competitionId="c1" />);
    await userEvent.setup().click(await screen.findByText("Advanced: review source results"));
    expect(await screen.findByTestId("text-readonly-note")).toHaveTextContent("new import");
    expect(screen.getByTestId("fieldset-review")).toBeDisabled();
    expect(screen.queryByTestId("btn-confirm-mappings")).toBeNull();
  });
  it("csv tab shows the bracket header example", async () => {
    fetchMock.mockResolvedValue({ imports: [], recaps: [], brackets: [], participants: [] });
    renderWithProviders(<ResultsConsole competitionId="c1" />);
    await userEvent.setup().click(await screen.findByTestId("tab-import-csv"));
    expect(screen.getByTestId("text-csv-example")).toHaveTextContent("Bracket,Home Team,Away Team,Home Score,Away Score");
  });
});
