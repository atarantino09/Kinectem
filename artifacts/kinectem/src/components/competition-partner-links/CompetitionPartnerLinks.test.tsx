import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/renderWithProviders";
import { CompetitionPartnerLinks } from "./CompetitionPartnerLinks";

const m = vi.hoisted(() => ({ fetch: vi.fn(), who: vi.fn() }));
type Watch = { callback: IntersectionObserverCallback; target: Element | null; root: Element | Document | null; disconnected: boolean; observer: IntersectionObserver };
const watches: Watch[] = [];
async function scrollToMore() {
  const watch = [...watches].reverse().find((w) => !w.disconnected && w.target?.isConnected);
  expect(watch?.root).toBe(screen.getByTestId("partner-links-panel"));
  await act(async () => watch?.callback(
    [{ isIntersecting: true, target: watch.target! } as IntersectionObserverEntry], watch.observer,
  ));
}
vi.mock("@workspace/api-client-react", () => ({ customFetch: m.fetch }));
vi.mock("@/hooks/useWhoami", () => ({ useWhoami: () => ({ data: m.who() }) }));

const part = (id: string, name: string, extra = {}) => ({
  id, name, division: "D1", bracket: "A", age: "U10", gender: "Boys",
  claimed: false, pending: false, teamId: null, ...extra,
});
const participants = [part("p1", "Rapids"), part("p2", "Comets"), part("p3", "Taken", { claimed: true }), part("p4", "Ghost", { hidden: true })];
const team = (id: string, name: string, extra = {}) => ({
  id, name, organizationId: `o${id}`, organizationName: "Club", city: "Austin", state: "TX",
  gender: "Boys", level: "Gold", ageGroup: null, archived: false, slotStatus: null, ...extra,
});
const admin = { authenticated: true, realUser: { id: "u", role: "admin" } };
const clubs = [
  { id: "oa", name: "Twin Club", city: "Austin", state: "TX", teamCount: 2 },
  { id: "ob", name: "Twin Club", city: "Dallas", state: "TX", teamCount: 1 },
];
type Over = { post?: unknown; hasMore?: boolean; teams?: unknown[]; suggestions?: unknown[]; clubsErr?: boolean; optsErr?: boolean };

function impl(over: Over) {
  return async (url: string, opts?: { method?: string }) => {
    if (opts?.method === "POST") {
      if (over.post instanceof Error) throw over.post;
      return over.post;
    }
    if (url.includes("partner-pages")) return { data: [{ id: "pg", slug: "s", officialName: "Page", published: true }] };
    if (url.includes("partner-team-clubs")) {
      if (over.clubsErr) throw new Error("clubs down");
      return { data: clubs };
    }
    if (over.optsErr) throw new Error("opts down");
    if (url.includes("suggestedFor=")) return { data: over.suggestions ?? [], hasMore: false, nextCursor: null };
    return {
      data: over.teams ?? [team("t1", "Rapids"), team("t2", "Other Name"), team("t3", "Old", { archived: true }),
        team("t4", "Linked", { slotStatus: "linked" }), team("t5", "Wait", { slotStatus: "pending" })],
      hasMore: !!over.hasMore,
      nextCursor: over.hasMore ? "continuation" : null,
    };
  };
}
const el = (p = participants) => <CompetitionPartnerLinks competitionId="c1" slug="slug" participants={p as never} />;
function setup(over: Over = {}) {
  const fallback = impl(over);
  m.fetch.mockImplementation((url: string, opts?: { method?: string }) =>
    url.includes("suggestFor=") ? Promise.resolve({ data: [], hasMoreMatches: false }) : fallback(url, opts));
  return renderWithProviders(el());
}
type U = ReturnType<typeof userEvent.setup>;
async function open() {
  const u = userEvent.setup();
  await u.click(screen.getByTestId("button-link-partner-teams"));
  await u.selectOptions(await screen.findByTestId("select-partner-page"), "pg");
  await u.click(screen.getByTestId("button-next"));
  return u;
}
async function pick(u: U, slot: string, t: string) {
  await u.click(screen.getByTestId(`button-choose-team-${slot}`));
  await u.click(await screen.findByTestId(`option-team-${t}`));
  await u.click(screen.getByTestId("button-use-team"));
}
async function review(u: U) {
  await u.click(screen.getByTestId("button-review"));
}
const posts = () => m.fetch.mock.calls.filter(([, o]) => o?.method === "POST");

describe("formatGender", () => {
  it("maps codes and preserves unknown labels", async () => {
    const { formatGender } = await import("./model");
    expect(["m", "B", "Boys"].map(formatGender)).toEqual(["Boys", "Boys", "Boys"]);
    expect(["f", "G", "Girls"].map(formatGender)).toEqual(["Girls", "Girls", "Girls"]);
    expect(formatGender("mixed")).toBe("Coed");
    expect(formatGender("Open")).toBe("Open");
    expect(formatGender(null)).toBe("");
  });
});

describe("CompetitionPartnerLinks", () => {
  beforeEach(() => {
    m.fetch.mockReset(); m.who.mockReset(); m.who.mockReturnValue(admin);
    watches.length = 0;
    vi.stubGlobal("IntersectionObserver", class {
      watch: Watch;
      constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit) {
        this.watch = { callback, root: options.root ?? null, target: null, disconnected: false, observer: this as unknown as IntersectionObserver };
        watches.push(this.watch);
      }
      observe(target: Element) { this.watch.target = target; }
      disconnect() { this.watch.disconnected = true; }
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows ambiguous suggestions separately and requires selection, queueing, name acknowledgement and final confirmation", async () => {
    setup({
      teams: [],
      suggestions: [
        team("s1", "Rapids FC", { organizationName: "North Club", city: "Dallas", gender: "Girls", ageGroup: "U14" }),
        team("s2", "Rapids FC", { organizationName: "South Club" }),
      ],
      post: { ok: true, succeeded: 1, failed: 0, results: [{ participantId: "p2", teamId: "s2", ok: true }] },
    });
    const u = await open();
    await u.click(screen.getByTestId("button-choose-team-p2"));
    const first = await screen.findByTestId("suggestion-team-s1");
    expect(first).toHaveTextContent("North Club");
    expect(first).toHaveTextContent("Girls Gold U14");
    expect(first).toHaveTextContent("Dallas, TX");
    expect(screen.getByTestId("suggestion-team-s2")).toHaveTextContent("South Club");
    expect(first).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("button-use-team")).toBeDisabled();
    expect(screen.getByTestId("button-review")).toBeDisabled();
    expect(posts()).toHaveLength(0);
    await u.click(screen.getByTestId("suggestion-team-s2"));
    expect(screen.getByTestId("button-review")).toBeDisabled();
    expect(posts()).toHaveLength(0);
    await u.click(screen.getByTestId("button-use-team"));
    expect(screen.getByTestId("assignment-p2")).toHaveTextContent("South Club / Rapids FC");
    await review(u);
    await u.click(screen.getByTestId("checkbox-confirm-link"));
    expect(screen.getByTestId("button-submit-links")).toBeDisabled();
    await u.click(screen.getByTestId("checkbox-mismatch-p2"));
    await u.click(screen.getByTestId("checkbox-confirm-link"));
    await u.click(screen.getByTestId("button-submit-links"));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(JSON.parse(posts()[0][1].body)).toEqual({
      pageId: "pg", assignments: [{ participantId: "p2", teamId: "s2", nameMismatchAcknowledged: true }],
    });
  });

  it("disables unavailable and queued suggestions and keeps suggestions independent of club/search filters", async () => {
    setup({ suggestions: [
      team("t1", "Rapids"),
      team("a", "Rapids", { archived: true }),
      team("l", "Rapids", { slotStatus: "linked" }),
      team("p", "Rapids", { slotStatus: "pending" }),
    ] });
    const u = await open();
    await pick(u, "p1", "t1");
    await u.click(screen.getByTestId("button-choose-team-p2"));
    await screen.findByTestId("suggestion-team-t1");
    for (const id of ["t1", "a", "l", "p"]) expect(screen.getByTestId(`suggestion-team-${id}`)).toBeDisabled();
    await u.selectOptions(screen.getByTestId("select-club"), "ob");
    await u.type(screen.getByTestId("input-team-search"), "anything");
    const urls = m.fetch.mock.calls.map(([url]) => new URL(url, "https://test.invalid"))
      .filter((url) => url.searchParams.has("suggestedFor"));
    expect(urls.length).toBeGreaterThan(0);
    urls.forEach((url) => {
      expect(url.searchParams.get("pageId")).toBe("pg");
      expect(url.searchParams.has("organizationId")).toBe(false);
      expect(url.searchParams.has("q")).toBe(false);
      expect(url.searchParams.has("cursor")).toBe(false);
    });
  });

  it("does not show delayed suggestions from the previous directory or retain its selected destination", async () => {
    setup();
    const fallback = impl({});
    let finish!: (value: unknown) => void;
    m.fetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (url.includes("partner-pages")) return Promise.resolve({ data: [
        { id: "pg", slug: "one", officialName: "First directory" },
        { id: "pg2", slug: "two", officialName: "Second directory" },
      ] });
      if (url.includes("suggestedFor=")) {
        if (new URL(url, "https://test.invalid").searchParams.get("pageId") === "pg") {
          return new Promise((resolve) => { finish = resolve; });
        }
        return Promise.resolve({ data: [team("new", "Rapids", { organizationName: "Second club" })] });
      }
      return fallback(url, opts);
    });
    const u = await open();
    await u.click(screen.getByTestId("button-choose-team-p1"));
    await u.click(await screen.findByTestId("option-team-t1"));
    await u.click(screen.getByTestId("step-1"));
    await u.selectOptions(screen.getByTestId("select-partner-page"), "pg2");
    await u.click(screen.getByTestId("button-next"));
    await u.click(screen.getByTestId("button-choose-team-p1"));
    expect(await screen.findByTestId("suggestion-team-new")).toHaveTextContent("Second club");
    await act(async () => finish({ data: [team("old", "Rapids", { organizationName: "First club" })] }));
    expect(screen.queryByTestId("suggestion-team-old")).toBeNull();
    expect(screen.getByTestId("button-use-team")).toBeDisabled();
    expect(screen.getByTestId("button-review")).toBeDisabled();
  });

  it("lets admins search and queue manually when optional suggestions fail", async () => {
    setup();
    const fallback = impl({});
    m.fetch.mockImplementation((url: string, opts?: { method?: string }) =>
      url.includes("suggestedFor=") ? Promise.reject(new Error("Suggestions unavailable")) : fallback(url, opts));
    const u = await open();
    await pick(u, "p1", "t1");
    expect(screen.getByTestId("assignment-p1")).toHaveTextContent("Club / Rapids");
    expect(posts()).toHaveLength(0);
  });

  it("hides for non-admin, signed-out and masquerade, no requests", () => {
    m.who.mockReturnValue({ authenticated: true, realUser: { id: "u", role: "coach" } });
    const view = setup();
    expect(screen.queryByTestId("partner-links-tool")).toBeNull();
    m.who.mockReturnValue({ authenticated: false });
    view.rerender(el());
    m.who.mockReturnValue({ ...admin, isMasquerading: true, viewingAs: { id: "v", role: "admin" } });
    view.rerender(el());
    expect(screen.queryByTestId("partner-links-tool")).toBeNull();
    expect(m.fetch).not.toHaveBeenCalled();
  });

  it("shows duplicate-name suggestions separately and only queues the explicitly chosen page", async () => {
    setup();
    const fallback = impl({ post: { ok: true, succeeded: 1, failed: 0,
      results: [{ participantId: "p1", teamId: "late-b", ok: true }] } });
    m.fetch.mockImplementation((url: string, opts?: { method?: string }) =>
      url.includes("suggestedFor=") ? Promise.resolve({
        data: [team("late-a", "Rapids", { organizationName: "North Club", city: "Boston" }),
          team("late-b", "Rapids", { organizationName: "South Club", city: "Miami" })],
        hasMoreMatches: false,
      }) : fallback(url, opts));
    const u = await open();
    await u.click(screen.getByTestId("button-choose-team-p1"));
    expect(await screen.findByTestId("suggestion-team-late-a")).toHaveTextContent("North Club");
    expect(screen.getByTestId("suggestion-team-late-b")).toHaveTextContent("South Club");
    expect(screen.getByTestId("button-use-team")).toBeDisabled();
    expect(screen.queryByTestId("assignment-p1")).toBeNull();
    expect(posts()).toHaveLength(0);
    expect(screen.queryByTestId("option-team-late-b")).toBeNull();
    await u.click(screen.getByTestId("suggestion-team-late-b"));
    expect(screen.getByTestId("button-use-team")).toBeEnabled();
    expect(screen.queryByTestId("assignment-p1")).toBeNull();
    await u.click(screen.getByTestId("button-use-team"));
    expect(screen.getByTestId("assignment-p1")).toHaveTextContent("South Club / Rapids");
    expect(posts()).toHaveLength(0);
    await review(u);
    await u.click(screen.getByTestId("checkbox-confirm-link"));
    await u.click(screen.getByTestId("button-submit-links"));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(JSON.parse(posts()[0][1].body).assignments).toEqual([
      { participantId: "p1", teamId: "late-b", nameMismatchAcknowledged: false },
    ]);
  });

  it("keeps unavailable and already-queued suggestions disabled without changing name confirmation", async () => {
    setup();
    const fallback = impl({});
    m.fetch.mockImplementation((url: string, opts?: { method?: string }) =>
      url.includes("suggestedFor=") ? Promise.resolve({
        data: [team("t1", "Rapids"), team("old", "Rapids", { archived: true }),
          team("linked", "Rapids", { slotStatus: "linked" }),
          team("pending", "Rapids", { slotStatus: "pending" }), team("mismatch", "Different Name")],
        hasMoreMatches: false,
      }) : fallback(url, opts));
    const u = await open();
    await pick(u, "p1", "t1");
    await u.click(screen.getByTestId("button-choose-team-p2"));
    for (const id of ["t1", "old", "linked", "pending"]) {
      expect(await screen.findByTestId(`suggestion-team-${id}`)).toBeDisabled();
    }
    await u.click(screen.getByTestId("suggestion-team-mismatch"));
    await u.click(screen.getByTestId("button-use-team"));
    await review(u);
    await u.click(screen.getByTestId("checkbox-confirm-link"));
    expect(screen.getByTestId("button-submit-links")).toBeDisabled();
    expect(posts()).toHaveLength(0);
  });

  it("keeps directory-wide suggestions independent of club changes and preserves manual search while they load", async () => {
    setup();
    const fallback = impl({});
    let finishOld!: (data: unknown) => void;
    m.fetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (!url.includes("suggestedFor=")) return fallback(url, opts);
      const params = new URL(url, "https://test.invalid").searchParams;
      expect(params.get("pageId")).toBe("pg");
      expect(params.get("suggestedFor")).toBe("p1");
      expect(params.has("organizationId")).toBe(false);
      return new Promise((resolve) => { finishOld = resolve; });
    });
    const u = await open();
    await u.click(screen.getByTestId("button-choose-team-p1"));
    await waitFor(() => expect(finishOld).toBeTypeOf("function"));
    await u.selectOptions(screen.getByTestId("select-club"), "oa");
    await u.click(await screen.findByTestId("option-team-t1"));
    expect(screen.getByTestId("button-use-team")).toBeEnabled();
    await u.click(screen.getByTestId("button-use-team"));
    expect(screen.getByTestId("assignment-p1")).toHaveTextContent("Club / Rapids");
    await act(async () => finishOld({ data: [team("late-directory-team", "Rapids")], hasMore: false, nextCursor: null }));
    expect(screen.queryByTestId("suggestion-team-late-directory-team")).toBeNull();
  });

  it("walks the three stages with names, no default UUIDs, Unassigned default", async () => {
    setup();
    const u = await open();
    expect(screen.getByText("Assign team schedules", { selector: "h2" })).toBeTruthy();
    expect(screen.getByText("Competition team")).toBeTruthy();
    expect(screen.getByText("Existing team page")).toBeTruthy();
    expect(screen.getByTestId("filter-unassigned")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("text-progress")).toHaveTextContent("1 assigned");
    expect(screen.queryByTestId("slot-p3")).toBeNull();
    await u.click(screen.getByTestId("filter-all"));
    expect(screen.getByTestId("unavailable-slot-p3")).toBeTruthy();
    expect(screen.getByTestId("unavailable-slot-p4").textContent).toContain("Hidden");
    expect(screen.getByTestId("button-review")).toBeDisabled();
    await u.click(screen.getByTestId("button-choose-team-p1"));
    expect(screen.getByTestId("active-source").textContent).toContain("Rapids");
    const opt = await screen.findByTestId("option-team-t1");
    expect(opt.textContent).toContain("Gold");
    expect(opt.textContent).not.toContain("ot1");
    expect(screen.getByTestId("button-use-team")).toBeDisabled();
    await u.click(opt);
    await u.click(screen.getByTestId("button-use-team"));
    await review(u);
    expect(screen.getByTestId("text-review-count").textContent).toContain("1 schedule");
    expect(screen.getByTestId("review-p1").textContent).not.toContain("ot1");
    await u.click(screen.getByTestId("button-back"));
    expect(screen.getByTestId("assignment-p1")).toBeTruthy();
  });

  it("blocks archived, linked, pending and duplicate teams; requires mismatch ack; max shown", async () => {
    setup({ hasMore: true });
    const u = await open();
    await u.click(screen.getByTestId("button-choose-team-p1"));
    expect(await screen.findByTestId("text-has-more")).toBeTruthy();
    for (const t of ["t3", "t4", "t5"]) expect(screen.getByTestId(`option-team-${t}`)).toBeDisabled();
    await u.click(screen.getByTestId("option-team-t1"));
    await u.click(screen.getByTestId("button-use-team"));
    await u.click(screen.getByTestId("button-choose-team-p2"));
    expect(await screen.findByTestId("option-team-t1")).toBeDisabled();
    await u.click(screen.getByTestId("option-team-t2"));
    await u.click(screen.getByTestId("button-use-team"));
    await review(u);
    expect(screen.getByRole("button", { name: /Assign schedules to 2 teams/ })).toBeDisabled();
    await u.click(screen.getByTestId("checkbox-confirm-link"));
    expect(screen.getByTestId("button-submit-links")).toBeDisabled();
    await u.click(screen.getByTestId("checkbox-mismatch-p2"));
    await u.click(screen.getByTestId("checkbox-confirm-link"));
    expect(screen.getByTestId("button-submit-links")).toBeEnabled();
  });

  it("club filter queries by organizationId and keeps queued choices", async () => {
    setup();
    const u = await open();
    await u.click(screen.getByTestId("button-choose-team-p1"));
    await u.click(await screen.findByTestId("option-team-t1"));
    await u.click(screen.getByTestId("button-use-team"));
    await u.click(screen.getByTestId("button-choose-team-p2"));
    await screen.findByTestId("option-team-t1");
    await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(2));
    await u.selectOptions(screen.getByTestId("select-club"), "ob");
    await waitFor(() =>
      expect(m.fetch.mock.calls.some(([url]) => String(url).includes("organizationId=ob"))).toBe(true),
    );
    expect(m.fetch.mock.calls.some(([url]) => String(url).includes("partner-team-clubs?pageId=pg"))).toBe(true);
    await u.selectOptions(screen.getByTestId("select-club"), "");
    expect(screen.getByTestId("assignment-p1")).toBeTruthy();
  });

  it("loads and deduplicates more teams without disabling the pinned selected choice", async () => {
    setup();
    const fallback = impl({});
    let finish!: (value: unknown) => void;
    m.fetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (!url.includes("partner-team-options")) return fallback(url, opts);
      if (new URL(url, "https://test.invalid").searchParams.has("cursor")) {
        return new Promise((resolve) => { finish = resolve; });
      }
      return Promise.resolve({ data: [team("t1", "Rapids"), team("t2", "Comets")], hasMore: true, nextCursor: "page2" });
    });
    const u = await open();
    await u.click(screen.getByTestId("button-choose-team-p1"));
    await u.click(await screen.findByTestId("option-team-t1"));
    await scrollToMore();
    expect(await screen.findByTestId("status-more-loading")).toBeTruthy();
    expect(screen.getByTestId("button-use-team")).toBeEnabled();
    await act(async () => finish({ data: [team("t2", "Comets"), team("t9", "Later team")], hasMore: false, nextCursor: null }));
    expect(await screen.findByTestId("option-team-t9")).toBeTruthy();
    expect(screen.getAllByTestId("option-team-t2")).toHaveLength(1);
    expect(screen.getByTestId("selected-destination")).toHaveTextContent("Club / Rapids");
    await u.click(screen.getByTestId("button-use-team"));
    expect(screen.getByTestId("assignment-p1")).toHaveTextContent("Club / Rapids");
  });

  it("keeps the draft while a new club stream replaces a delayed old continuation", async () => {
    setup();
    const fallback = impl({});
    let finishOld!: (value: unknown) => void;
    m.fetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (!url.includes("partner-team-options")) return fallback(url, opts);
      const params = new URL(url, "https://test.invalid").searchParams;
      if (params.get("organizationId") === "ob") {
        expect(params.has("cursor")).toBe(false);
        return Promise.resolve({ data: [team("fresh", "Comets", { organizationId: "ob" })], hasMore: false, nextCursor: null });
      }
      if (params.has("cursor")) return new Promise((resolve) => { finishOld = resolve; });
      return Promise.resolve({ data: [team("t1", "Rapids"), team("t2", "Comets")], hasMore: true, nextCursor: "old-cursor" });
    });
    const u = await open();
    await pick(u, "p1", "t1");
    await u.click(screen.getByTestId("button-choose-team-p2"));
    await waitFor(() => expect(watches.some((w) => !w.disconnected)).toBe(true));
    await scrollToMore();
    await u.selectOptions(screen.getByTestId("select-club"), "ob");
    expect(await screen.findByTestId("option-team-fresh")).toBeTruthy();
    await act(async () => finishOld({ data: [team("stale", "Old club team")], hasMore: false, nextCursor: null }));
    expect(screen.queryByTestId("option-team-stale")).toBeNull();
    expect(screen.queryByTestId("option-team-t1")).toBeNull();
    expect(screen.getByTestId("assignment-p1")).toHaveTextContent("Club / Rapids");
  });

  it("retains loaded rows and the selected page if loading more fails, and retries that page", async () => {
    setup();
    const fallback = impl({});
    let tries = 0;
    m.fetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (!url.includes("partner-team-options")) return fallback(url, opts);
      if (new URL(url, "https://test.invalid").searchParams.has("cursor")) {
        if (++tries === 1) return Promise.reject(new Error("Offline"));
        return Promise.resolve({ data: [team("t9", "Later")], hasMore: false, nextCursor: null });
      }
      return Promise.resolve({ data: [team("t1", "Rapids")], hasMore: true, nextCursor: "page2" });
    });
    const u = await open();
    await u.click(screen.getByTestId("button-choose-team-p1"));
    await u.click(await screen.findByTestId("option-team-t1"));
    await scrollToMore();
    expect(await screen.findByTestId("error-more-options")).toHaveTextContent("Your choices are unchanged");
    expect(screen.getByTestId("option-team-t1")).toBeTruthy();
    expect(screen.getByTestId("button-use-team")).toBeEnabled();
    await u.click(screen.getByRole("button", { name: "Retry loading more" }));
    expect(await screen.findByTestId("option-team-t9")).toBeTruthy();
    expect(screen.getByTestId("selected-destination")).toHaveTextContent("Club / Rapids");
  });

  it("returns all structured failures to Match teams even when the source filter hides the team", async () => {
    setup({ post: { ok: false, succeeded: 0, failed: 1, results: [
      { participantId: "p1", teamId: "t1", ok: false, code: "PENDING_CLAIM", message: "Slot changed." },
    ] } });
    const u = await open();
    await u.click(screen.getByTestId("button-choose-team-p1"));
    await u.type(await screen.findByTestId("input-club-search"), "Twin");
    await u.selectOptions(screen.getByTestId("select-club"), "oa");
    await u.click(await screen.findByTestId("option-team-t1"));
    await u.click(screen.getByTestId("button-use-team"));
    await u.type(screen.getByTestId("input-slot-search"), "Comets");
    await review(u);
    await u.click(screen.getByTestId("checkbox-confirm-link"));
    await u.click(screen.getByTestId("button-submit-links"));
    expect(await screen.findByTestId("outcome-error-p1")).toHaveTextContent("Slot changed.");
    expect(screen.getByTestId("step-2")).toHaveAttribute("aria-current", "step");
    expect(screen.queryByTestId("slot-p1")).toBeNull();
    expect(screen.getByTestId("input-slot-search")).toHaveValue("Comets");
    await u.click(screen.getByRole("button", { name: "Change team page" }));
    expect(await screen.findByTestId("input-club-search")).toHaveValue("Twin");
    expect(screen.getByTestId("select-club")).toHaveValue("oa");
    await review(u);
    expect(screen.getByTestId("review-p1")).toBeTruthy();
    expect(screen.getByTestId("checkbox-confirm-link")).not.toBeChecked();
  });

  it("reports a cached refresh failure without losing the draft or silently using stale options", async () => {
    setup();
    const fallback = impl({});
    let fail = false;
    m.fetch.mockImplementation((url: string, opts?: { method?: string }) => {
      if (url.includes("partner-team-options") && fail) return Promise.reject(new Error("Offline"));
      return fallback(url, opts);
    });
    const u = await open();
    await pick(u, "p1", "t1");
    fail = true;
    await u.click(screen.getByTestId("button-choose-team-p2"));
    expect(await screen.findByTestId("error-refresh-options")).toHaveTextContent("Your choices are unchanged");
    await u.click(screen.getByTestId("option-team-t2"));
    expect(screen.getByTestId("button-use-team")).toBeDisabled();
    expect(screen.getByTestId("assignment-p1")).toBeTruthy();
    fail = false;
    await u.click(screen.getByRole("button", { name: "Retry refresh" }));
    await waitFor(() => expect(screen.getByTestId("button-use-team")).toBeEnabled());
  });

  it("renders continuous long lists with no page controls and a sticky use action", async () => {
    const view = setup({ teams: Array.from({ length: 12 }, (_, i) => team(`t${i + 1}`, `Team ${i + 1}`)) });
    view.rerender(el([...participants, ...Array.from({ length: 10 }, (_, i) => part(`extra${i}`, `Extra ${i}`))]));
    const u = await open();
    expect(screen.getByTestId("slot-extra9")).toBeTruthy();
    expect(screen.getByTestId("slot-extra6")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Next competition teams" })).toBeNull();
    await u.click(screen.getByTestId("button-choose-team-p1"));
    await screen.findByTestId("option-team-t1");
    expect(screen.getByTestId("option-team-t12")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Next team pages" })).toBeNull();
    expect(screen.getByTestId("matching-action-bar")).toHaveClass("sticky", "top-0", "bg-background");
    await u.click(screen.getByTestId("option-team-t9"));
    expect(screen.getByTestId("selected-destination")).toHaveTextContent("Club / Team 9");
    await u.click(screen.getByTestId("button-use-team"));
    expect(screen.getByTestId("assignment-p1")).toHaveTextContent("Club / Team 9");
  });

  it("searches the displayed gender labels as well as imported codes", async () => {
    const view = setup();
    view.rerender(el([part("p1", "Rapids", { gender: "m" }), part("p2", "Comets", { gender: "f" })]));
    const u = await open();
    await u.type(screen.getByTestId("input-slot-search"), "boys");
    expect(screen.getByTestId("slot-p1")).toHaveTextContent("Boys");
    expect(screen.queryByTestId("slot-p2")).toBeNull();
  });

  it("discards an open draft when the real admin identity changes", async () => {
    const view = setup();
    const u = await open();
    await pick(u, "p1", "t1");
    expect(screen.getByTestId("assignment-p1")).toBeTruthy();
    m.who.mockReturnValue({ ...admin, realUser: { id: "another-admin", role: "admin" } });
    view.rerender(el());
    expect(screen.queryByTestId("dialog-partner-links")).toBeNull();
    await u.click(screen.getByTestId("button-link-partner-teams"));
    expect(screen.getByTestId("select-partner-page")).toHaveValue("");
    expect(screen.queryByTestId("assignment-p1")).toBeNull();
  });

  it("partial success: Assigned state, failed-only retry, labels survive refresh", async () => {
    setup({ post: { ok: false, succeeded: 1, failed: 1, results: [
      { participantId: "p1", teamId: "t1", ok: true },
      { participantId: "p2", teamId: "t2", ok: false, message: "Slot taken" }] } });
    const u = await open();
    await pick(u, "p1", "t1");
    await pick(u, "p2", "t2");
    await review(u);
    await u.click(screen.getByTestId("checkbox-mismatch-p2"));
    await u.click(screen.getByTestId("checkbox-confirm-link"));
    await u.click(screen.getByTestId("button-submit-links"));
    expect((await screen.findByTestId("outcome-error-p2")).textContent).toContain("Slot taken");
    expect(screen.getByTestId("step-2")).toHaveAttribute("aria-current", "step");
    expect(screen.getByTestId("assigned-p1").textContent).toContain("Assigned");
    expect(screen.getByTestId("assignment-p2")).toBeTruthy();
    // parent refresh marks p1 as claimed: must still show Assigned, not Unavailable
    m.fetch.mockImplementation(impl({ post: { ok: true, succeeded: 1, failed: 0, results: [{ participantId: "p2", teamId: "t2", ok: true }] } }));
    await review(u);
    await u.click(screen.getByTestId("checkbox-confirm-link"));
    await u.click(screen.getByTestId("button-submit-links"));
    await waitFor(() => expect(screen.getByTestId("step-2")).toHaveAttribute("aria-current", "step"));
    expect(screen.queryByTestId("button-done")).toBeNull();
    expect(posts()).toHaveLength(2);
    expect(JSON.parse(posts()[1][1].body).assignments).toEqual([
      { participantId: "p2", teamId: "t2", nameMismatchAcknowledged: true },
    ]);
    expect(screen.getByTestId("assigned-p1")).toBeTruthy();
    expect(screen.getByTestId("assigned-p2")).toBeTruthy();
  });

  it("suppresses Unavailable badge for assigned team after parent refresh", async () => {
    m.fetch.mockImplementation(impl({ post: { ok: true, succeeded: 1, failed: 0, results: [{ participantId: "p1", teamId: "t1", ok: true }] } }));
    const view = renderWithProviders(el());
    const u = await open();
    await pick(u, "p1", "t1");
    await review(u);
    await u.click(screen.getByTestId("checkbox-confirm-link"));
    await u.click(screen.getByTestId("button-submit-links"));
    await screen.findByTestId("assignment-outcomes");
    view.rerender(el([part("p1", "Rapids", { claimed: true, teamId: "t1" }), ...participants.slice(1)]));
    await u.click(screen.getByTestId("step-2"));
    await u.click(screen.getByTestId("filter-all"));
    expect(screen.getByTestId("assigned-slot-p1")).toBeTruthy();
    expect(screen.queryByTestId("unavailable-slot-p1")).toBeNull();
  });

  it("blocks a reviewed choice if the competition team changes", async () => {
    const view = setup();
    const u = await open();
    await pick(u, "p1", "t1");
    await review(u);
    await u.click(screen.getByTestId("checkbox-confirm-link"));
    expect(screen.getByTestId("button-submit-links")).toBeEnabled();
    view.rerender(el([part("p1", "Rapids", { pending: true }), ...participants.slice(1)]));
    expect(screen.getByTestId("button-submit-links")).toBeDisabled();
    expect(screen.getByTestId("stale-p1")).toBeTruthy();
    await u.click(screen.getByTestId("button-review-remove-p1"));
    expect(screen.getByTestId("empty-review")).toBeTruthy();
  });

  it("surfaces submit, directory and option errors", async () => {
    setup({ post: new Error("Boom") });
    let u = await open();
    await pick(u, "p1", "t1");
    await review(u);
    await u.click(screen.getByTestId("checkbox-confirm-link"));
    await u.click(screen.getByTestId("button-submit-links"));
    await waitFor(() => expect(screen.getByTestId("error-submit").textContent).toContain("Boom"));
    expect(screen.getByTestId("review-p1")).toBeTruthy();
  });

  it("shows club and option errors with retry", async () => {
    setup({ clubsErr: true, optsErr: true });
    const u = await open();
    await u.click(screen.getByTestId("button-choose-team-p1"));
    expect(await screen.findByTestId("error-clubs")).toBeTruthy();
    expect(await screen.findByTestId("error-options")).toBeTruthy();
  });

  it("shows directory page error", async () => {
    m.fetch.mockRejectedValue(new Error("down"));
    renderWithProviders(el());
    const u = userEvent.setup();
    await u.click(screen.getByTestId("button-link-partner-teams"));
    expect(await screen.findByTestId("error-pages")).toBeTruthy();
  });

  it("blocks closing and going back while submitting", async () => {
    let release: (v: unknown) => void = () => undefined;
    m.fetch.mockImplementation(async (url: string, opts?: { method?: string }) => {
      if (opts?.method === "POST") return new Promise((r) => { release = r; });
      return impl({})(url, opts);
    });
    renderWithProviders(el());
    const u = await open();
    await pick(u, "p1", "t1");
    await review(u);
    await u.click(screen.getByTestId("checkbox-confirm-link"));
    await u.click(screen.getByTestId("button-submit-links"));
    expect(screen.getByTestId("button-back")).toBeDisabled();
    await u.keyboard("{Escape}");
    expect(screen.getByTestId("dialog-partner-links")).toBeTruthy();
    release({ ok: true, succeeded: 1, failed: 0, results: [{ participantId: "p1", teamId: "t1", ok: true }] });
    await screen.findByTestId("assignment-outcomes");
    expect(screen.getByTestId("step-2")).toHaveAttribute("aria-current", "step");
    await u.click(screen.getByRole("button", { name: /^Close$/ }));
    expect(screen.queryByTestId("dialog-partner-links")).toBeNull();
  });
});
