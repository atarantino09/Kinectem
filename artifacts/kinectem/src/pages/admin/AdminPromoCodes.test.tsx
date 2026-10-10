import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test";
import AdminPromoCodes from "./AdminPromoCodes";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("@workspace/api-client-react", async (original) => ({ ...await original<typeof import("@workspace/api-client-react")>(), customFetch: fetchMock }));
vi.mock("@/components/AdminLayout", () => ({ AdminLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("./PromoUsageReport", () => ({ PromoUsageReport: () => null }));
vi.mock("./AdminCompetitionReferrals", () => ({ AdminCompetitionReferrals: () => null }));
let rows: Array<Record<string, unknown>>;
beforeEach(() => {
  vi.clearAllMocks(); rows = [];
  fetchMock.mockImplementation(async (_url: string, options?: { method?: string; body?: string }) => {
    if (options?.method === "POST") {
      const body = JSON.parse(options.body ?? "{}");
      rows.push({ ...body, id: "new-promo", code: body.code.toLowerCase(), active: true, redemptionCount: 0,
        discountType: body.linkedOffer ? "free_until" : body.discountType, discountValue: body.linkedOffer ? 0 : body.discountValue,
        freeUntil: body.linkedOffer ? "2027-08-01T04:00:00.000Z" : null });
      return { promo: rows.at(-1) };
    }
    return { data: rows };
  });
});

describe("promo offer mode", () => {
  it("puts the choice before the code, removes all discount controls, creates with code alone and reopens linked terms", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminPromoCodes />);
    await user.click(screen.getByTestId("btn-new-promo"));
    const mode = screen.getByTestId("promo-offer-mode");
    const code = screen.getByTestId("input-new-code");
    expect(mode.compareDocumentPosition(code) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.click(screen.getByRole("radio", { name: "Link to FREE2027" }));
    expect(screen.queryByTestId("select-discount-type")).not.toBeInTheDocument();
    expect(screen.queryByTestId("input-new-value")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("linked-offer-terms")).getByText(/Free through July 31, 2027/)).toBeVisible();
    expect(screen.queryByText(/0%|100%/)).not.toBeInTheDocument();
    await user.type(code, "SOURCE-COACH");
    await user.click(screen.getByTestId("btn-save-promo"));
    await screen.findByTestId("promo-row-source-coach");
    const post = fetchMock.mock.calls.find(([, opts]) => opts?.method === "POST");
    expect(JSON.parse(post![1].body)).toMatchObject({ code: "SOURCE-COACH", linkedOffer: "free2027" });
    expect(JSON.parse(post![1].body)).not.toHaveProperty("discountValue");
    expect(JSON.parse(post![1].body)).not.toHaveProperty("discountType");
    expect(JSON.parse(post![1].body)).not.toHaveProperty("freeUntil");
    expect(screen.getByText("Linked to FREE2027")).toBeVisible();
    await user.click(screen.getByTestId("btn-edit-source-coach"));
    expect(screen.getByTestId("linked-offer-terms")).toBeVisible();
    expect(screen.queryByTestId("select-edit-discount-type")).not.toBeInTheDocument();
    expect(screen.queryByTestId("input-edit-value")).not.toBeInTheDocument();
  });

  it("switches modes without validating or submitting stale discount values", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminPromoCodes />);
    await user.click(screen.getByTestId("btn-new-promo"));
    await user.clear(screen.getByTestId("input-new-value"));
    await user.type(screen.getByTestId("input-new-value"), "999");
    await user.click(screen.getByRole("radio", { name: "Link to FREE2027" }));
    await user.click(screen.getByRole("radio", { name: "Standard discount code" }));
    expect(screen.getByTestId("input-new-value")).toHaveValue(999);
    await user.click(screen.getByRole("radio", { name: "Link to FREE2027" }));
    await user.type(screen.getByTestId("input-new-code"), "ONLY-CODE");
    await user.click(screen.getByTestId("btn-save-promo"));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, opts]) => opts?.method === "POST")).toBe(true));
    const post = fetchMock.mock.calls.find(([, opts]) => opts?.method === "POST");
    expect(JSON.parse(post![1].body)).not.toHaveProperty("discountValue");
  });

  it("retains standard discount creation without linkage", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminPromoCodes />);
    await user.click(screen.getByTestId("btn-new-promo"));
    await user.type(screen.getByTestId("input-new-code"), "STANDARD10");
    await user.click(screen.getByTestId("btn-save-promo"));
    await screen.findByTestId("promo-row-standard10");
    const post = fetchMock.mock.calls.find(([, opts]) => opts?.method === "POST");
    expect(JSON.parse(post![1].body)).toMatchObject({ discountType: "percent", discountValue: 10 });
    expect(JSON.parse(post![1].body)).not.toHaveProperty("linkedOffer");
  });
});
