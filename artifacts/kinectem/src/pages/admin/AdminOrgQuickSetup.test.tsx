import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "@/test";
import AdminOrgQuickSetup, { pairsToTeamRows } from "./AdminOrgQuickSetup";

// Task #829 — one-page org quick setup: add/remove team + coach rows and a
// single save that shows the claim-link hand-off view. Fetch is stubbed at
// the global level (same approach as OrgSetupChecklist.test.tsx).

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
  it("adds/removes rows and saves everything once, then shows the claim link", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminOrgQuickSetup />);

    await user.type(await screen.findByTestId("input-qs-org-name"), "Quick Org");

    // First team + coach email.
    await user.type(screen.getByTestId("input-qs-team-name-0"), "12U Blue");
    await user.type(
      screen.getByTestId("input-qs-coach-email-0-0"),
      "coach@example.com",
    );

    // Second team row.
    await user.click(screen.getByTestId("btn-qs-add-team"));
    await user.type(screen.getByTestId("input-qs-team-name-1"), "10U Gold");

    // Third row added then removed again.
    await user.click(screen.getByTestId("btn-qs-add-team"));
    expect(screen.getByTestId("qs-team-row-2")).toBeInTheDocument();
    await user.click(screen.getByTestId("btn-qs-remove-team-2"));
    expect(screen.queryByTestId("qs-team-row-2")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("btn-qs-save"));

    await waitFor(() =>
      expect(screen.getByTestId("quick-setup-success")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("quick-setup-claim-link").textContent).toContain(
      "/claim/tok123",
    );

    // Payload contained both teams and the coach email; blank rows dropped.
    // Task #831 — gender/website are gone from the payload.
    const body = lastQuickSetupBody as {
      name: string;
      teams: Array<{ name: string; coachEmails: string[]; gender?: unknown }>;
    };
    expect(body.name).toBe("Quick Org");
    expect(body.teams.map((t) => t.name)).toEqual(["12U Blue", "10U Gold"]);
    expect(body.teams[0].coachEmails).toEqual(["coach@example.com"]);
    expect(body.teams[0]).not.toHaveProperty("gender");
    expect(body.teams[0]).not.toHaveProperty("website");
  });

  it("fills team rows from the bulk row editor, keeping bad rows behind", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminOrgQuickSetup />);
    await user.type(await screen.findByTestId("input-qs-org-name"), "Bulk Org");

    // Multi-line paste into the name column splits down that column
    // (row 4 gets no name — its email will make it a flagged row).
    await user.click(screen.getByTestId("input-qs-bulk-team-name-0"));
    await user.paste("12U Blue\n12U Blue\n10U Gold\n\n8U Red");
    // Coach emails on rows 1, 2, 4 (line 4 has email but no name), and a
    // bad email on row 5.
    await user.type(
      screen.getByTestId("input-qs-bulk-coach-email-0"),
      "coach1@example.com",
    );
    await user.type(
      screen.getByTestId("input-qs-bulk-coach-email-1"),
      "coach2@example.com",
    );
    await user.type(
      screen.getByTestId("input-qs-bulk-coach-email-3"),
      "orphan@example.com",
    );
    await user.type(
      screen.getByTestId("input-qs-bulk-coach-email-4"),
      "not-an-email",
    );
    await user.click(screen.getByTestId("btn-qs-bulk-apply"));

    // Two coach emails merged onto one 12U Blue row; blank starter dropped.
    expect(screen.getByTestId("input-qs-team-name-0")).toHaveValue("12U Blue");
    expect(screen.getByTestId("input-qs-coach-email-0-0")).toHaveValue(
      "coach1@example.com",
    );
    expect(screen.getByTestId("input-qs-coach-email-0-1")).toHaveValue(
      "coach2@example.com",
    );
    expect(screen.getByTestId("input-qs-team-name-1")).toHaveValue("10U Gold");
    // The bad rows stayed in the editor (renumbered) with errors listed.
    const errors = screen.getByTestId("qs-bulk-errors");
    expect(errors).toHaveTextContent("Line 1");
    expect(errors).toHaveTextContent("Line 2");
    expect(screen.getByTestId("input-qs-bulk-coach-email-0")).toHaveValue(
      "orphan@example.com",
    );
    expect(screen.getByTestId("input-qs-bulk-team-name-1")).toHaveValue("8U Red");
    // The team on the bad-email row was NOT added (whole row flagged).
    expect(screen.queryByTestId("input-qs-team-name-2")).not.toBeInTheDocument();
  });

  it("shows a running team count against the starter cap", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminOrgQuickSetup />);
    await screen.findByTestId("input-qs-org-name");
    expect(screen.getByTestId("text-qs-team-count")).toHaveTextContent("0/15 teams");
    await user.type(screen.getByTestId("input-qs-team-name-0"), "12U Blue");
    // A NEW name in the bulk editor counts; a duplicate of an existing row
    // does not.
    await user.click(screen.getByTestId("input-qs-bulk-team-name-0"));
    await user.paste("12U Blue\n10U Gold");
    expect(screen.getByTestId("text-qs-team-count")).toHaveTextContent("2/15 teams");
  });

  it("sends brand colors when set", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminOrgQuickSetup />);
    await user.type(await screen.findByTestId("input-qs-org-name"), "Quick Org");
    fireEvent.input(screen.getByTestId("input-qs-color-primary"), {
      target: { value: "#112233" },
    });
    await user.click(screen.getByTestId("btn-qs-save"));
    await waitFor(() =>
      expect(screen.getByTestId("quick-setup-success")).toBeInTheDocument(),
    );
    const body = lastQuickSetupBody as {
      brandPrimaryColor?: string;
      brandSecondaryColor?: string;
    };
    expect(body.brandPrimaryColor).toBe("#112233");
    expect(body.brandSecondaryColor).toBeUndefined();
  });

  it("blocks save when a coach email sits on a blank team row", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminOrgQuickSetup />);
    await user.type(await screen.findByTestId("input-qs-org-name"), "Quick Org");
    await user.type(
      screen.getByTestId("input-qs-coach-email-0-0"),
      "coach@example.com",
    );
    await user.click(screen.getByTestId("btn-qs-save"));
    expect(await screen.findByTestId("qs-save-error")).toHaveTextContent(
      /no team name/i,
    );
    expect(lastQuickSetupBody).toBeNull();
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
