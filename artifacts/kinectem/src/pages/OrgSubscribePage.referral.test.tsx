import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test";
import { REFERRAL_STORAGE_KEY } from "@/components/CompetitionReferralField";
import OrgSubscribePage from "./OrgSubscribePage";

const { fetchMock, navigate, toast } = vi.hoisted(() => ({ fetchMock: vi.fn(), navigate: vi.fn(), toast: vi.fn() }));
vi.mock("@workspace/api-client-react", async (original) => ({ ...await original<typeof import("@workspace/api-client-react")>(), customFetch: fetchMock }));
vi.mock("wouter", async (original) => ({ ...await original<typeof import("wouter")>(), useParams: () => ({ orgId: "test-org" }), useLocation: () => ["/organizations/test-org/subscribe", navigate] }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
const code = "ref-1234567890abcdef";
const promo = { code: "free2027", linkedOffer: null as string | null, discountType: "free_until", discountValue: 0, freeUntil: "2027-08-01T04:00:00.000Z" };
let credited: { referralCode: string; competitionName: string } | null;
let failSave: boolean;
let hasCard: boolean;
beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.clear(); credited = null; failSave = false; hasCard = false;
  promo.code = "free2027"; promo.linkedOffer = null;
  fetchMock.mockImplementation(async (url: string, options?: { method?: string; body?: string }) => {
    if (url.endsWith("/subscription") && options?.method === "PUT") {
      if (failSave) throw new Error("Competition referral code not found.");
      const body = JSON.parse(options.body ?? "{}");
      credited = { referralCode: body.referralCode, competitionName: "Test Cup" };
      return { subscription: { plan: body.plan, promo } };
    }
    if (url.endsWith("/subscription")) return { subscription: hasCard ? { plan: "starter", promo: null, hasCardOnFile: true } : null, billingStartsAt: "2026-12-01T00:00:00Z" };
    if (url.endsWith("/competition-referral")) return { referral: credited };
    if (url.includes("/resolve/")) return { competitionName: "Test Cup", referralCode: code };
    if (url.endsWith("/validate")) return { valid: true, promo };
    throw new Error(`Unexpected test request: ${url}`);
  });
});
describe("FREE2027 referral plan setup", () => {
  it("accepts a single custom linked code with a saved card and keeps separate referral credit", async () => {
    hasCard = true; promo.code = "club-source"; promo.linkedOffer = "free2027";
    renderWithProviders(<OrgSubscribePage />);
    await screen.findByTestId("input-promo");
    const user = userEvent.setup();
    await user.type(screen.getByTestId("input-promo"), "CLUB-SOURCE");
    await user.click(screen.getByTestId("btn-apply-promo"));
    await screen.findByText(/club-source/i, { selector: "span.uppercase" });
    const save = fetchMock.mock.calls.find(([url, options]) => url.endsWith("/subscription") && options?.method === "PUT");
    expect(JSON.parse(save![1].body)).toMatchObject({ promoCode: "club-source", plan: "starter" });
    expect(screen.getByText("Credit a competition")).toBeVisible();
  });
  it("auto-fills the separate offer and referral, submits both, and clears pending attribution only after success", async () => {
    sessionStorage.setItem(REFERRAL_STORAGE_KEY, code);
    renderWithProviders(<OrgSubscribePage />);
    await waitFor(() => expect(screen.getByTestId("input-competition-referral-tag")).toHaveValue(code));
    await screen.findByText(/Referral credit: Test Cup/);
    await screen.findByText(/FREE2027/i, { selector: "span.uppercase" });
    await userEvent.setup().click(screen.getByTestId("btn-continue-org"));
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    const save = fetchMock.mock.calls.find(([url, options]) => url.endsWith("/subscription") && options?.method === "PUT");
    expect(JSON.parse(save![1].body)).toMatchObject({ promoCode: "free2027", referralCode: code });
    expect(sessionStorage.getItem(REFERRAL_STORAGE_KEY)).toBeNull();
    await screen.findByText("Test Cup", { selector: "strong" });
  });
  it("does not navigate or clear the tag when the server rejects saving", async () => {
    failSave = true; sessionStorage.setItem(REFERRAL_STORAGE_KEY, code);
    renderWithProviders(<OrgSubscribePage />);
    await screen.findByText(/Referral credit: Test Cup/);
    await screen.findByText(/FREE2027/i, { selector: "span.uppercase" });
    await userEvent.setup().click(screen.getByTestId("btn-continue-org"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" })));
    expect(navigate).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(REFERRAL_STORAGE_KEY)).toBe(code);
  });
  it("keeps persisted first attribution visible and cannot silently replace it with a new link", async () => {
    credited = { referralCode: code, competitionName: "Original Cup" };
    sessionStorage.setItem(REFERRAL_STORAGE_KEY, "ref-0000000000000000");
    renderWithProviders(<OrgSubscribePage />);
    await screen.findByText("Original Cup", { selector: "strong" });
    expect(screen.queryByTestId("input-competition-referral-tag")).not.toBeInTheDocument();
  });
  it("preserves the existing plan and includes the referral when a saved-card org continues", async () => {
    hasCard = true; sessionStorage.setItem(REFERRAL_STORAGE_KEY, code);
    renderWithProviders(<OrgSubscribePage />);
    await screen.findByText(/FREE2027/i, { selector: "span.uppercase" });
    const user = userEvent.setup();
    await user.click(screen.getByTestId("btn-continue-org"));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, options]) => url.endsWith("/subscription") && options?.method === "PUT")).toBe(true));
    const save = fetchMock.mock.calls.find(([url, options]) => url.endsWith("/subscription") && options?.method === "PUT");
    expect(JSON.parse(save![1].body)).toMatchObject({ plan: "starter", promoCode: "free2027", referralCode: code });
    await screen.findByText("Test Cup", { selector: "strong" });
  });
});
