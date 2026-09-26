import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test";
import { PromoUsageReport, quarterDates } from "./PromoUsageReport";

const urls: string[] = [];
beforeEach(() => {
  urls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(JSON.stringify({ data: [], total: 0, pageSize: 25, legacyExcluded: false }), {
      headers: { "content-type": "application/json" },
    });
  }));
});

describe("promo usage controls", () => {
  it("uses inclusive UTC quarter ends, including year rollover and leap years", () => {
    expect(quarterDates(2026, 4)).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(quarterDates(2027, 1)).toEqual({ from: "2027-01-01", to: "2027-03-31" });
    expect(quarterDates(2024, 1)).toEqual({ from: "2024-01-01", to: "2024-03-31" });
  });

  it("uses the same selected range for the visible report and export and explains empty results", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PromoUsageReport />);
    await user.clear(screen.getByLabelText("From (UTC)"));
    await user.type(screen.getByLabelText("From (UTC)"), "2026-04-01");
    await user.clear(screen.getByLabelText("Through (UTC)"));
    await user.type(screen.getByLabelText("Through (UTC)"), "2026-06-30");
    await waitFor(() => expect(urls.some((url) =>
      url.includes("from=2026-04-01") && url.includes("to=2026-06-30"),
    )).toBe(true));
    expect(await screen.findByText(/No applications in this range/)).toBeTruthy();
  });
});