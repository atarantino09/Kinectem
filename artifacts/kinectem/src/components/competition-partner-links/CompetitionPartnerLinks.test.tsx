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
const participants = [part("p1", "Rapids"), part("p2", "Comets"), part("p3", "Taken", { claimed: true })];
const team = (id: string, name: string, extra = {}) => ({
  id, name, organizationId: `o${id}`, organizationName: "Club", city: "Austin", state: "TX",
  gender: "Boys", ageGroup: "U10", archived: false, slotStatus: null, ...extra,
});
const admin = { authenticated: true, realUser: { id: "u", role: "admin" } };

function setup(over: Record<string, unknown> = {}) {
  m.fetch.mockImplementation(async (url: string, opts?: { method?: string }) => {
    if (opts?.method === "POST") return over.post;
    if (url.includes("partner-pages")) return { data: [{ id: "pg", slug: "s", officialName: "Page", linked: true, published: true }] };
    return { data: [team("t1", "Rapids"), team("t2", "Other Name"), team("t3", "Old", { archived: true })], hasMore: !!over.hasMore };
  });
  return renderWithProviders(
    <CompetitionPartnerLinks competitionId="c1" slug="slug" participants={participants as never} />,
  );
}
async function open() {
  const u = userEvent.setup();
  await u.click(screen.getByTestId("button-link-partner-teams"));
  await u.selectOptions(await screen.findByTestId("select-partner-page"), "pg");
  return u;
}
async function pick(u: ReturnType<typeof userEvent.setup>, slot: string, t: string) {
  await u.click(screen.getByTestId(`button-choose-team-${slot}`));
  await u.click(await screen.findByTestId(`option-team-${t}`));
}

describe("CompetitionPartnerLinks", () => {
  beforeEach(() => { m.fetch.mockReset(); m.who.mockReset(); m.who.mockReturnValue(admin); });

  it("hides for non-admin and unauthenticated, no requests", () => {
    m.who.mockReturnValue({ authenticated: true, realUser: { id: "u", role: "coach" } });
    setup();
    expect(screen.queryByTestId("partner-links-tool")).toBeNull();
    expect(m.fetch).not.toHaveBeenCalled();
  });

  it("uses effective masquerade role", () => {
    m.who.mockReturnValue({ authenticated: true, isMasquerading: true, realUser: { id: "u", role: "admin" }, viewingAs: { id: "v", role: "parent" } });
    setup();
    expect(screen.queryByTestId("partner-links-tool")).toBeNull();
  });

  it("hides for signed-out visitors and for any active masquerade", () => {
    m.who.mockReturnValue({ authenticated: false });
    const view = setup();
    expect(screen.queryByTestId("partner-links-tool")).toBeNull();
    expect(m.fetch).not.toHaveBeenCalled();
    m.who.mockReturnValue({ ...admin, isMasquerading: true, viewingAs: { id: "v", role: "admin" } });
    view.rerender(<CompetitionPartnerLinks competitionId="c1" slug="slug" participants={participants as never} />);
    expect(screen.queryByTestId("partner-links-tool")).toBeNull();
    expect(m.fetch).not.toHaveBeenCalled();
  });

  it("shows tool for admin and never autoselects; unavailable slots flagged", async () => {
    setup();
    await open();
    expect(screen.getByTestId("empty-review")).toBeTruthy();
    expect(screen.getByTestId("unavailable-slot-p3")).toBeTruthy();
    expect(screen.getByTestId("button-submit-links")).toBeDisabled();
  });

  it("blocks archived and duplicate teams, requires mismatch ack", async () => {
    setup({ hasMore: true });
    const u = await open();
    await u.click(screen.getByTestId("button-choose-team-p1"));
    expect(await screen.findByTestId("text-has-more")).toBeTruthy();
    expect(screen.getByTestId("option-team-t3")).toBeDisabled();
    await u.click(screen.getByTestId("option-team-t1"));
    await u.click(screen.getByTestId("button-choose-team-p2"));
    expect(await screen.findByTestId("option-team-t1")).toBeDisabled();
    await u.click(screen.getByTestId("option-team-t2"));
    await u.click(screen.getByTestId("checkbox-confirm-link"));
    expect(screen.getByTestId("button-submit-links")).toBeDisabled();
    await u.click(screen.getByTestId("checkbox-mismatch-p2"));
    await u.click(screen.getByTestId("checkbox-confirm-link"));
    expect(screen.getByTestId("button-submit-links")).toBeEnabled();
  });

  it("shows mixed results and keeps failures editable", async () => {
    setup({ post: { ok: false, succeeded: 1, failed: 1, results: [
      { participantId: "p1", teamId: "t1", ok: true },
      { participantId: "p2", teamId: "t2", ok: false, message: "Slot taken" } ] } });
    const u = await open();
    await pick(u, "p1", "t1");
    await pick(u, "p2", "t2");
    await u.click(screen.getByTestId("checkbox-mismatch-p2"));
    await u.click(screen.getByTestId("checkbox-confirm-link"));
    await u.click(screen.getByTestId("button-submit-links"));
    expect((await screen.findByTestId("result-p1")).textContent).toContain("Linked");
    expect(screen.getByTestId("result-p2").textContent).toContain("Slot taken");
    expect(screen.queryByTestId("assignment-p1")).toBeNull();
    expect(screen.getByTestId("assignment-p2")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("checkbox-confirm-link")).toBeEnabled());
    m.fetch.mockImplementation(async (url: string, opts?: { method?: string }) => {
      if (opts?.method === "POST") return {
        ok: true, succeeded: 1, failed: 0, results: [{ participantId: "p2", teamId: "t2", ok: true }],
      };
      if (url.includes("partner-pages")) return { data: [{ id: "pg", slug: "s", officialName: "Page" }] };
      return { data: [team("t2", "Other Name")], hasMore: false };
    });
    await u.click(screen.getByTestId("checkbox-confirm-link"));
    await u.click(screen.getByTestId("button-submit-links"));
    await waitFor(() => expect(screen.getByTestId("result-p2").textContent).toContain("Linked"));
    const posts = m.fetch.mock.calls.filter(([, opts]) => opts?.method === "POST");
    expect(posts).toHaveLength(2);
    expect(JSON.parse(posts[1][1].body).assignments).toEqual([
      { participantId: "p2", teamId: "t2", nameMismatchAcknowledged: true },
    ]);
    expect(screen.getByTestId("result-p1").textContent).toContain("Linked");
  });

  it("blocks a reviewed match if the competition slot changes before submitting", async () => {
    const view = setup();
    const u = await open();
    await pick(u, "p1", "t1");
    await u.click(screen.getByTestId("checkbox-confirm-link"));
    expect(screen.getByTestId("button-submit-links")).toBeEnabled();
    view.rerender(<CompetitionPartnerLinks competitionId="c1" slug="slug" participants={[
      part("p1", "Rapids", { pending: true }), participants[1], participants[2],
    ] as never} />);
    expect(screen.getByTestId("button-submit-links")).toBeDisabled();
    expect(screen.getByTestId("assignment-p1")).toBeTruthy();
  });

  it("surfaces request errors without fallback", async () => {
    setup();
    m.fetch.mockImplementation(async (url: string, opts?: { method?: string }) => {
      if (opts?.method === "POST") throw new Error("Boom");
      if (url.includes("partner-pages")) return { data: [{ id: "pg", slug: "s", officialName: "Page" }] };
      return { data: [team("t1", "Rapids")], hasMore: false };
    });
    const u = await open();
    await pick(u, "p1", "t1");
    await u.click(screen.getByTestId("checkbox-confirm-link"));
    await u.click(screen.getByTestId("button-submit-links"));
    await waitFor(() => expect(screen.getByTestId("error-submit").textContent).toContain("Boom"));
    expect(screen.getByTestId("assignment-p1")).toBeTruthy();
  });
});
