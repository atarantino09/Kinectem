import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "@/test";
import AdminOrgQuickSetup from "./AdminOrgQuickSetup";

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
    const body = lastQuickSetupBody as {
      name: string;
      teams: Array<{ name: string; coachEmails: string[] }>;
    };
    expect(body.name).toBe("Quick Org");
    expect(body.teams.map((t) => t.name)).toEqual(["12U Blue", "10U Gold"]);
    expect(body.teams[0].coachEmails).toEqual(["coach@example.com"]);
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
