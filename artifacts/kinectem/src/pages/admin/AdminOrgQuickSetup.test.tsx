import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "@/test";
import AdminOrgQuickSetup, { pairsToTeamRows } from "./AdminOrgQuickSetup";

// Task #829 — one-page org quick setup. The numbered two-column row editor
// IS the team list (5 rows shown, "show 5 more" expands); a single save
// shows the claim-link hand-off view. Fetch is stubbed at the global level
// (same approach as OrgSetupChecklist.test.tsx).

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let lastQuickSetupBody: unknown = null;

function installFetchMock() {
  lastQuickSetupBody = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === "string" ? input : (input as Request).url;
      const path = raw.split("?")[0];
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && path === "/api/v1/auth/whoami") {
        return jsonResponse({
          authenticated: true,
          user: { id: "admin-1", role: "admin" },
          realUser: { id: "admin-1", role: "admin" },
        });
      }
      if (method === "GET" && path === "/api/v1/admin/org-name-check") {
        return jsonResponse({ data: [] });
      }
      if (method === "POST" && path === "/api/v1/admin/org-quick-setup") {
        lastQuickSetupBody = JSON.parse(String(init?.body ?? "{}"));
        return jsonResponse(
          {
            data: {
              id: "org-1",
              name: "Quick Org",
              city: null,
              state: null,
              logoUrl: null,
              token: "tok123",
              teams: [
                { id: "t1", name: "12U Blue" },
                { id: "t2", name: "10U Gold" },
              ],
              stagedCoachCount: 1,
            },
          },
          201,
        );
      }
      return jsonResponse({ error: "Unhandled in test", method, path }, 404);
    }),
  );
  // Success path copies the claim link to the clipboard. navigator.clipboard
  // is a read-only accessor in jsdom, so defineProperty instead of assign.
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
}

beforeEach(() => {
  installFetchMock();
});

describe("AdminOrgQuickSetup", () => {
  it("saves teams typed into the row editor and shows the claim link", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminOrgQuickSetup />);

    await user.type(await screen.findByTestId("input-qs-org-name"), "Quick Org");

    // Repeat a team name on another line to add a second coach to it.
    await user.type(screen.getByTestId("input-qs-bulk-team-name-0"), "12U Blue");
    await user.type(
      screen.getByTestId("input-qs-bulk-coach-email-0"),
      "coach@example.com",
    );
    await user.type(screen.getByTestId("input-qs-bulk-team-name-1"), "12U Blue");
    await user.type(
      screen.getByTestId("input-qs-bulk-coach-email-1"),
      "coach2@example.com",
    );
    await user.type(screen.getByTestId("input-qs-bulk-team-name-2"), "10U Gold");

    await user.click(screen.getByTestId("btn-qs-save"));

    await waitFor(() =>
      expect(screen.getByTestId("quick-setup-success")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("quick-setup-claim-link").textContent).toContain(
      "/claim/tok123",
    );

    // Duplicate names merged; blank rows dropped.
    const body = lastQuickSetupBody as {
      name: string;
      teams: Array<{ name: string; coachEmails: string[] }>;
    };
    expect(body.name).toBe("Quick Org");
    expect(body.teams).toEqual([
      { name: "12U Blue", coachEmails: ["coach@example.com", "coach2@example.com"] },
      { name: "10U Gold", coachEmails: [] },
    ]);
  });

  it("shows 5 rows up front and expands 5 at a time", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminOrgQuickSetup />);
    await screen.findByTestId("input-qs-org-name");

    expect(screen.getByTestId("row-qs-bulk-input-4")).toBeInTheDocument();
    expect(screen.queryByTestId("row-qs-bulk-input-5")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("btn-qs-bulk-show-more"));
    expect(screen.getByTestId("row-qs-bulk-input-9")).toBeInTheDocument();
    expect(screen.queryByTestId("row-qs-bulk-input-10")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("btn-qs-bulk-show-more"));
    expect(screen.getByTestId("row-qs-bulk-input-14")).toBeInTheDocument();
  });

  it("surfaces bad rows as errors and blocks save", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminOrgQuickSetup />);
    await user.type(await screen.findByTestId("input-qs-org-name"), "Bulk Org");

    // Orphan coach email (no team name) + a malformed email.
    await user.type(
      screen.getByTestId("input-qs-bulk-coach-email-0"),
      "orphan@example.com",
    );
    await user.type(screen.getByTestId("input-qs-bulk-team-name-1"), "8U Red");
    await user.type(
      screen.getByTestId("input-qs-bulk-coach-email-1"),
      "not-an-email",
    );

    const errors = screen.getByTestId("qs-bulk-errors");
    expect(errors).toHaveTextContent("Line 1");
    expect(errors).toHaveTextContent("Line 2");

    await user.click(screen.getByTestId("btn-qs-save"));
    expect(await screen.findByTestId("qs-save-error")).toHaveTextContent(
      /fix the highlighted rows/i,
    );
    expect(lastQuickSetupBody).toBeNull();
  });

  it("shows a running team count against the starter cap", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminOrgQuickSetup />);
    await screen.findByTestId("input-qs-org-name");
    expect(screen.getByTestId("text-qs-team-count")).toHaveTextContent("0/15 teams");
    // A multi-line paste splits down the column; duplicate names count once.
    await user.click(screen.getByTestId("input-qs-bulk-team-name-0"));
    await user.paste("12U Blue\n12U Blue\n10U Gold");
    expect(screen.getByTestId("text-qs-team-count")).toHaveTextContent("2/15 teams");
  });

  it("swaps the exact brand colors before sending them", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminOrgQuickSetup />);
    await user.type(await screen.findByTestId("input-qs-org-name"), "Quick Org");
    fireEvent.input(screen.getByTestId("input-qs-color-primary"), {
      target: { value: "#112233" },
    });
    fireEvent.input(screen.getByTestId("input-qs-color-secondary"), {
      target: { value: "#aabbcc" },
    });
    await user.click(screen.getByTestId("btn-swap-qs-brand-colors"));

    expect(screen.getByTestId("input-qs-color-primary")).toHaveValue("#aabbcc");
    expect(screen.getByTestId("input-qs-color-secondary")).toHaveValue("#112233");

    await user.click(screen.getByTestId("btn-qs-save"));
    await waitFor(() =>
      expect(screen.getByTestId("quick-setup-success")).toBeInTheDocument(),
    );
    const body = lastQuickSetupBody as {
      brandPrimaryColor?: string;
      brandSecondaryColor?: string;
    };
    expect(body.brandPrimaryColor).toBe("#aabbcc");
    expect(body.brandSecondaryColor).toBe("#112233");
  });
});

describe("bulk parsing helpers", () => {
  it("pairsToTeamRows merges duplicate teams, dedupes emails, reports errors", () => {
    const { teams, errors } = pairsToTeamRows([
      { line: 1, name: "Blue", email: "a@x.com" },
      { line: 2, name: "blue", email: "A@X.com" }, // dup team + dup email
      { line: 3, name: "Blue", email: "b@x.com" },
      { line: 4, name: "", email: "orphan@x.com" },
      { line: 5, name: "Red", email: "bad-email" },
    ]);
    expect(teams).toEqual([{ name: "Blue", coachEmails: ["a@x.com", "b@x.com"] }]);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain("Line 4");
    expect(errors[1]).toContain("Line 5");
  });
});
