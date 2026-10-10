import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test";
import AdminPromoCodes from "./AdminPromoCodes";

vi.mock("@/components/AdminLayout", () => ({ AdminLayout: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("./PromoUsageReport", () => ({ PromoUsageReport: () => <div>Usage history</div> }));
const code = "ref-1234567890abcdef";
let previews: Record<string, unknown>[];
let applications: Record<string, unknown>[];
let blocked: boolean;
let failReferral: boolean;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
beforeEach(() => {
  previews = []; applications = []; blocked = false; failReferral = false;
  vi.stubGlobal("fetch", vi.fn(async (input: string | Request, options?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/free2027/organizations")) return json({ data: [] });
    if (url.includes("/admin/promo-codes")) return json({ data: [] });
    if (url.includes("/admin/competitions?")) return json({ data: [
      { id: "comp-a", name: "Fall Cup", startDate: "2026-10-10", endDate: "2026-10-11" },
      { id: "comp-b", name: "Fall League", startDate: "2026-09-01", endDate: "2026-11-30" },
    ] });
    if (url.endsWith("/referrals")) return failReferral ? json({ error: "Unavailable", code: "ERROR" }, 500)
      : json({ referralCode: code, competitionName: "Fall Cup", data: [] });
    if (url.endsWith("/admin/organizations")) return json({ data: [
      { organizationId: "org-a", organizationName: "Sample Club" },
      { organizationId: "org-b", organizationName: "Another Club" },
    ] });
    if (url.endsWith("/admin/org-lists")) return json({ data: [{ id: "list-a", name: "Fall Clubs", orgCount: 2 }] });
    if (url.endsWith("/free2027/targets")) {
      const body = JSON.parse(String(options?.body));
      return json({ data: (body.listId ? ["org-a", "org-b"] : body.organizationIds).map((id: string) =>
        ({ organizationId: id, organizationName: id === "org-a" ? "Sample Club" : "Another Club" })) });
    }
    if (url.endsWith("/free2027/preview") || url.endsWith("/free2027/apply")) {
      const body = JSON.parse(String(options?.body));
      const preview = url.endsWith("/preview");
      (preview ? previews : applications).push(body);
      return json({ data: body.organizationIds.map((id: string) => ({
        organizationId: id, organizationName: id === "org-a" ? "Sample Club" : "Another Club",
        status: blocked ? "blocked" : preview ? "eligible" : "staged",
        reason: blocked ? "Already credited to Original Cup. Its referral was not replaced." : preview ? "Eligible" : "FREE2027 and competition credit saved",
      })) });
    }
    throw new Error(`Unexpected request ${url}`);
  }));
});
async function chooseCompetition(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Find a competition"), "Fall");
  await screen.findByRole("option", { name: /Fall Cup/ });
  await user.selectOptions(screen.getByLabelText("Competition to credit"), "comp-a");
  await screen.findByTestId("free2027-preset-referral");
}
describe("Platform admin referrals from Promo codes", () => {
  it("selects a competition, copies its link, and applies its credit to selected orgs without pasting a tag", async () => {
    const user = userEvent.setup();
    const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    renderWithProviders(<AdminPromoCodes />);
    await chooseCompetition(user);
    expect(screen.queryByTestId("input-competition-referral-tag")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Copy FREE2027 signup link" }));
    expect(copy).toHaveBeenCalledWith(expect.stringContaining(`/referrals/${code}`));
    await user.click(await screen.findByRole("checkbox", { name: "Sample Club" }));
    await user.click(screen.getByTestId("btn-free2027-selected"));
    await screen.findByText("Eligible");
    expect(previews[0]).toEqual({ organizationIds: ["org-a"], referralCode: code });
    expect(applications).toHaveLength(0);
    await user.click(screen.getByTestId("btn-confirm-free2027"));
    await screen.findByText("FREE2027 and competition credit saved");
    expect(applications[0]).toEqual({ organizationIds: ["org-a"], referralCode: code });
  });
  it("reviews and applies an entire saved list with the chosen competition tag", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminPromoCodes />);
    await chooseCompetition(user);
    await user.selectOptions(screen.getByTestId("select-free2027-list"), "list-a");
    await user.click(screen.getByTestId("btn-free2027-list"));
    await waitFor(() => expect(previews).toHaveLength(1));
    expect(previews[0]).toEqual({ organizationIds: ["org-a", "org-b"], referralCode: code });
    await user.click(screen.getByTestId("btn-confirm-free2027"));
    await waitFor(() => expect(applications).toHaveLength(1));
    expect(applications[0]).toEqual({ organizationIds: ["org-a", "org-b"], referralCode: code });
  });
  it("does not let the admin apply a blocked attribution or silently replace another competition", async () => {
    blocked = true;
    const user = userEvent.setup();
    renderWithProviders(<AdminPromoCodes />);
    await chooseCompetition(user);
    await user.click(await screen.findByRole("checkbox", { name: "Sample Club" }));
    await user.click(screen.getByTestId("btn-free2027-selected"));
    await screen.findByText(/Already credited to Original Cup/);
    expect(screen.getByTestId("btn-confirm-free2027")).toBeDisabled();
    expect(applications).toHaveLength(0);
  });
  it("clears selected orgs when the competition changes", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminPromoCodes />);
    await chooseCompetition(user);
    await user.click(await screen.findByRole("checkbox", { name: "Sample Club" }));
    await user.selectOptions(screen.getByLabelText("Competition to credit"), "comp-b");
    await waitFor(() => expect(screen.getByTestId("btn-free2027-selected")).toHaveTextContent("Review selected (0)"));
    expect(screen.getByTestId("btn-free2027-selected")).toBeDisabled();
  });
  it("fails visibly when a competition referral cannot load", async () => {
    failReferral = true;
    const user = userEvent.setup();
    renderWithProviders(<AdminPromoCodes />);
    await user.type(screen.getByLabelText("Find a competition"), "Fall");
    await screen.findByRole("option", { name: /Fall Cup/ });
    await user.selectOptions(screen.getByLabelText("Competition to credit"), "comp-a");
    await screen.findByRole("alert");
    expect(screen.queryByTestId("btn-confirm-free2027")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy FREE2027 signup link" })).not.toBeInTheDocument();
  });
});
