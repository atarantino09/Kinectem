import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test";
import { PromoFree2027Conversion } from "./PromoFree2027Conversion";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("@workspace/api-client-react", async (o) => ({ ...await o<typeof import("@workspace/api-client-react")>(), customFetch: fetchMock }));
const settings = { description: null, maxRedemptions: null, expiresAt: null };
const promo = { id: "p1", code: "coach", discountType: "percent", discountValue: 100 };
const row = (id: string, status = "pending") => ({ organizationId: id, organizationName: `Org ${id}`, status, reason: "r" });

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, o: { body: string }) => {
    if (url.endsWith("/review")) return { reviewId: "r1", terms: "T", data: [row("a"), row("b")] };
    if (url.endsWith("/preview")) return { data: JSON.parse(o.body).organizationIds.map((id: string) => row(id, id === "a" ? "eligible" : "skipped")) };
    if (url.endsWith("/confirm")) return { saved: true };
    return { data: JSON.parse(o.body).organizationIds.map((id: string) => row(id, "applied")) };
  });
});

describe("FREE2027 conversion", () => {
  it("requires explicit choice, then reviews, confirms and applies frozen ids", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PromoFree2027Conversion promo={promo} settings={settings} onDone={() => {}} />);
    expect(screen.getByTestId("btn-free2027-review")).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: /Charge full price/ }));
    await user.click(screen.getByTestId("btn-free2027-review"));
    await user.click(await screen.findByTestId("btn-free2027-confirm"));
    await screen.findByTestId("btn-free2027-done");
    const apply = fetchMock.mock.calls.find(([u]) => u.endsWith("/apply"))!;
    expect(JSON.parse(apply[1].body)).toEqual({ organizationIds: ["a"] });
    expect(screen.getByTestId("text-code-saved")).toBeInTheDocument();
  });
  it("disables keep_discount when no prior discount", () => {
    renderWithProviders(<PromoFree2027Conversion promo={{ ...promo, discountType: "free_until" }} settings={settings} onDone={() => {}} />);
    expect(screen.getByRole("radio", { name: /Keep the discount/ })).toBeDisabled();
  });
  it("does not confirm an interrupted preview and resumes the same frozen review", async () => {
    const normal = fetchMock.getMockImplementation()!;
    let interrupted = true;
    fetchMock.mockImplementation(async (url: string, options: { body: string }) => {
      if (url.endsWith("/preview") && interrupted) { interrupted = false; throw new Error("network"); }
      return normal(url, options);
    });
    const user = userEvent.setup();
    renderWithProviders(<PromoFree2027Conversion promo={promo} settings={settings} onDone={() => {}} />);
    await user.click(screen.getByRole("radio", { name: /Charge full price/ }));
    await user.click(screen.getByTestId("btn-free2027-review"));
    await screen.findByTestId("btn-free2027-resume");
    expect(screen.getByTestId("btn-free2027-confirm")).toBeDisabled();
    expect(fetchMock.mock.calls.some(([u]) => u.endsWith("/confirm"))).toBe(false);
    await user.click(screen.getByTestId("btn-free2027-resume"));
    expect(screen.getByTestId("btn-free2027-confirm")).toBeEnabled();
    expect(fetchMock.mock.calls.filter(([u]) => u.endsWith("/review"))).toHaveLength(1);
  });
  it("saves only future defaults when every current org is excluded", async () => {
    const normal = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, options: { body: string }) =>
      url.endsWith("/preview") ? { data: [row("a", "skipped"), row("b", "blocked")] } : normal(url, options));
    const user = userEvent.setup();
    renderWithProviders(<PromoFree2027Conversion promo={promo} settings={settings} onDone={() => {}} />);
    await user.click(screen.getByRole("radio", { name: /Charge full price/ }));
    await user.click(screen.getByTestId("btn-free2027-review"));
    await user.click(await screen.findByTestId("btn-free2027-confirm"));
    await screen.findByTestId("text-code-saved");
    expect(fetchMock.mock.calls.some(([u]) => u.endsWith("/apply"))).toBe(false);
  });
  it("retries only a failed original eligible org without reapplying successful rows", async () => {
    const normal = fetchMock.getMockImplementation()!;
    let failed = false;
    fetchMock.mockImplementation(async (url: string, options: { body: string }) => {
      if (url.endsWith("/preview")) return { data: [row("a", "eligible"), row("b", "eligible")] };
      if (url.endsWith("/apply")) {
        if (!failed) { failed = true; return { data: [row("a", "applied"), row("b", "blocked")] }; }
        return { data: [row("b", "staged")] };
      }
      return normal(url, options);
    });
    const user = userEvent.setup();
    renderWithProviders(<PromoFree2027Conversion promo={promo} settings={settings} onDone={() => {}} />);
    await user.click(screen.getByRole("radio", { name: /Charge full price/ }));
    await user.click(screen.getByTestId("btn-free2027-review"));
    await user.click(await screen.findByTestId("btn-free2027-confirm"));
    await user.click(await screen.findByTestId("btn-free2027-retry"));
    await screen.findByTestId("btn-free2027-done");
    const calls = fetchMock.mock.calls.filter(([u]) => u.endsWith("/apply"));
    expect(calls.map(([, o]) => JSON.parse(o.body).organizationIds)).toEqual([["a", "b"], ["b"]]);
  });
});
