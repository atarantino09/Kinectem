import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/renderWithProviders";
import { CompetitionPartnerLinks } from "./CompetitionPartnerLinks";

const m = vi.hoisted(() => ({ fetch: vi.fn(), who: vi.fn() }));
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
type Over = { post?: unknown; hasMore?: boolean; teams?: unknown[]; clubsErr?: boolean; optsErr?: boolean };

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
    return {
      data: over.teams ?? [team("t1", "Rapids"), team("t2", "Other Name"), team("t3", "Old", { archived: true }),
        team("t4", "Linked", { slotStatus: "linked" }), team("t5", "Wait", { slotStatus: "pending" })],
      hasMore: !!over.hasMore,
    };
  };
}
const el = (p = participants) => <CompetitionPartnerLinks competitionId="c1" slug="slug" participants={p as never} />;
function setup(over: Over = {}) {
  m.fetch.mockImplementation(impl(over));
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
  beforeEach(() => { m.fetch.mockReset(); m.who.mockReset(); m.who.mockReturnValue(admin); });

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

  it("pages long lists without nested scrolling and shows the selected team beside the use action", async () => {
    const view = setup({ teams: Array.from({ length: 12 }, (_, i) => team(`t${i + 1}`, `Team ${i + 1}`)) });
    view.rerender(el([...participants, ...Array.from({ length: 10 }, (_, i) => part(`extra${i}`, `Extra ${i}`))]));
    const u = await open();
    expect(screen.queryByTestId("slot-extra6")).toBeNull();
    await u.click(screen.getByRole("button", { name: "Next competition teams" }));
    expect(screen.getByTestId("slot-extra6")).toBeTruthy();
    await u.click(screen.getByRole("button", { name: "Previous competition teams" }));
    await u.click(screen.getByTestId("button-choose-team-p1"));
    await screen.findByTestId("option-team-t1");
    expect(screen.queryByTestId("option-team-t9")).toBeNull();
    await u.click(screen.getByRole("button", { name: "Next team pages" }));
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
    expect((await screen.findByTestId("review-error-p2")).textContent).toContain("Slot taken");
    expect(screen.getByTestId("assigned-p1").textContent).toContain("Assigned");
    expect(screen.queryByTestId("review-p1")).toBeNull();
    expect(screen.getByTestId("review-p2")).toBeTruthy();
    // parent refresh marks p1 as claimed: must still show Assigned, not Unavailable
    m.fetch.mockImplementation(impl({ post: { ok: true, succeeded: 1, failed: 0, results: [{ participantId: "p2", teamId: "t2", ok: true }] } }));
    await u.click(screen.getByTestId("checkbox-confirm-link"));
    await u.click(screen.getByTestId("button-submit-links"));
    await waitFor(() => expect(screen.getByTestId("button-done")).toBeTruthy());
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
    await screen.findByTestId("button-done");
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
    await screen.findByTestId("button-done");
  });
});
