import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test";
import { AdminFree2027Organizations } from "./AdminFree2027Organizations";
import { AdminFree2027 } from "./AdminFree2027";

const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
const rows = Array.from({ length: 55 }, (_, i) => ({
  organizationId: `o${i}`, organizationName: `Club ${String(i).padStart(2, "0")}`, claimed: i < 50,
  ownerName: i === 54 ? null : `Owner ${i}`, ownerLastSignInAt: i === 0 ? "2026-01-01T00:00:00Z" : null, hasFree2027: i === 1,
}));
let bodies: any[];
beforeEach(() => {
  bodies = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | Request, o?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/free2027/organizations")) return json({ data: rows });
    if (url.endsWith("/free2027/targets")) return json({ data: JSON.parse(String(o?.body)).organizationIds.map((id: string) => ({ organizationId: id, organizationName: id })) });
    if (url.endsWith("/free2027/preview") || url.endsWith("/free2027/apply")) {
      const body = JSON.parse(String(o?.body));
      bodies.push(body);
      return json({ data: body.organizationIds.map((id: string) => ({ organizationId: id, organizationName: id, status: url.endsWith("/apply") ? "staged" : "eligible", reason: "ok" })) });
    }
    return json({ data: [] });
  }));
});

describe("AdminFree2027Organizations", () => {
  it("shows all rows in API order with truthful labels and no competition fields", async () => {
    renderWithProviders(<AdminFree2027Organizations />);
    const list = await screen.findByTestId("f27-list");
    expect(within(list).getAllByRole("checkbox")).toHaveLength(55);
    expect(within(list).getAllByRole("checkbox")[0]).toHaveAccessibleName("Select Club 00");
    expect(screen.getByTestId("f27-counts")).toHaveTextContent("55 organizations");
    expect(within(list).getByText(/No owner/)).toBeInTheDocument();
    expect(within(list).getAllByText(/Never recorded/).length).toBeGreaterThan(0);
    expect(within(list).getByText("FREE2027 assigned")).toBeInTheDocument();
    expect(screen.getByTestId("free2027-no-competition")).toBeInTheDocument();
    expect(screen.queryByText(/saved list/i)).toBeNull();
    expect(screen.queryByText(/Competition to credit/i)).toBeNull();
  });
  it("selects all >40, preserves selection across filters, omits referralCode", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminFree2027Organizations />);
    await screen.findByTestId("f27-list");
    await user.click(screen.getByRole("button", { name: "Select all matching" }));
    expect(screen.getByTestId("f27-counts")).toHaveTextContent("55 selected");
    await user.selectOptions(screen.getByLabelText("Claimed status"), "unclaimed");
    expect(screen.getByTestId("f27-counts")).toHaveTextContent("5 shown");
    expect(screen.getByTestId("f27-counts")).toHaveTextContent("50 selected hidden");
    await user.click(screen.getByRole("button", { name: "Clear selection" }));
    await user.selectOptions(screen.getByLabelText("Claimed status"), "all");
    await user.type(screen.getByLabelText(/Search organization/), "owner 3");
    await user.click(screen.getByRole("button", { name: "Select claimed matching" }));
    expect(screen.getByTestId("f27-counts")).toHaveTextContent("11 selected");
    await user.click(screen.getByTestId("btn-free2027-org-selected"));
    await screen.findByTestId("btn-confirm-free2027-org");
    expect(bodies[0].organizationIds).toHaveLength(10);
    expect(bodies[0]).not.toHaveProperty("referralCode");
    await waitFor(() => expect(screen.getByTestId("btn-confirm-free2027-org")).toBeEnabled());
    expect(bodies[1].organizationIds).toHaveLength(1);
    await user.click(screen.getByTestId("btn-confirm-free2027-org"));
    await screen.findByText("FREE2027 application results");
    expect(bodies).toHaveLength(4);
    expect(bodies.every((body) => !("referralCode" in body))).toBe(true);
    expect(screen.getByTestId("f27-counts")).toHaveTextContent("0 selected");
  });
  it("resolves selections larger than 2,000 without exceeding the target endpoint's batch limit", async () => {
    const scopes: Array<{ organizationIds: string[] }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: string | Request, init?: RequestInit) => {
      scopes.push(JSON.parse(String(init?.body)));
      return json({ data: [] });
    }));
    const user = userEvent.setup();
    const ids = Array.from({ length: 2001 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    renderWithProviders(<AdminFree2027 selectedIds={ids} lists={[]} withoutReferral />);
    await user.click(screen.getByTestId("btn-free2027-org-selected"));
    await screen.findByText("No selected organizations are available.");
    expect(scopes.map((scope) => scope.organizationIds.length)).toEqual([2000, 1]);
    expect(scopes.flatMap((scope) => scope.organizationIds)).toEqual(ids);
  });
});
