import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test";
import AdminOrganizations from "./AdminOrganizations";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let validatedBody: Record<string, unknown> | null = null;
let importedBody: Record<string, unknown> | null = null;

beforeEach(() => {
  validatedBody = null;
  importedBody = null;
  Object.defineProperties(HTMLElement.prototype, {
    hasPointerCapture: { configurable: true, value: () => false },
    setPointerCapture: { configurable: true, value: () => undefined },
    releasePointerCapture: { configurable: true, value: () => undefined },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === "string" ? input : (input as Request).url;
      const path = new URL(raw, "http://localhost").pathname;
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && path === "/api/v1/auth/whoami") {
        return jsonResponse({
          authenticated: true,
          user: { id: "admin-1", role: "admin" },
          realUser: { id: "admin-1", role: "admin" },
        });
      }
      if (method === "GET" && path === "/api/v1/admin/organizations") {
        return jsonResponse({ data: [] });
      }
      if (method === "GET" && path === "/api/v1/admin/promo-codes") {
        return jsonResponse({
          data: [
            {
              id: "promo-1",
              code: "bulk20",
              description: "Partner import",
              discountType: "percent",
              discountValue: 20,
              active: true,
              maxRedemptions: null,
              redemptionCount: 0,
              expiresAt: null,
            },
          ],
        });
      }
      if (method === "GET" && path === "/api/v1/admin/org-lists") {
        return jsonResponse({ data: [] });
      }
      if (method === "GET" && path === "/api/v1/admin/org-claim-links") {
        return jsonResponse({ data: [] });
      }
      if (method === "GET" && path === "/api/v1/admin/org-name-check") {
        return jsonResponse({ data: [] });
      }
      if (
        method === "POST" &&
        path === "/api/v1/admin/org-bulk-import/validate"
      ) {
        validatedBody = JSON.parse(String(init?.body ?? "{}"));
        return jsonResponse({
          data: {
            valid: true,
            list: null,
            promo: {
              code: "bulk20",
              discountType: "percent",
              discountValue: 20,
            },
            organizations: (validatedBody?.organizations as unknown[]) ?? [],
            issues: [],
          },
        });
      }
      if (method === "POST" && path === "/api/v1/admin/org-bulk-import") {
        importedBody = JSON.parse(String(init?.body ?? "{}"));
        return jsonResponse(
          {
            data: {
              list: { id: "list-1", name: "Fall Partners" },
              promoCode: "bulk20",
              organizationCount: 2,
              teamCount: 3,
              organizations: [
                {
                  id: "org-1",
                  name: "North League",
                  token: "token-north",
                  teams: [
                    { id: "team-1", name: "North U12" },
                    { id: "team-2", name: "North U14" },
                  ],
                },
                {
                  id: "org-2",
                  name: "South League",
                  token: "token-south",
                  teams: [{ id: "team-3", name: "South U12" }],
                },
              ],
            },
          },
          201,
        );
      }
      return jsonResponse({ error: "Unhandled in test", method, path }, 404);
    }),
  );
});

describe("AdminOrganizations bulk import", () => {
  it("previews, validates, and imports every organization into one list", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminOrganizations />);

    const fileInput = await screen.findByTestId("input-org-bulk-file");
    await user.upload(
      fileInput,
      new File(
        ["North League,South League\nNorth U12,South U12\nNorth U14,"],
        "partner-organizations.csv",
        { type: "text/csv" },
      ),
    );
    expect(await screen.findByTestId("bulk-import-preview")).toHaveTextContent(
      "2 organizations · 3 teams",
    );

    await user.type(
      screen.getByTestId("input-org-bulk-list-name"),
      "Fall Partners",
    );
    await user.click(screen.getByTestId("select-org-bulk-promo"));
    await user.click(await screen.findByText(/BULK20/));
    await user.click(screen.getByTestId("btn-org-bulk-check"));

    await waitFor(() =>
      expect(screen.getByTestId("btn-org-bulk-import")).toBeEnabled(),
    );
    expect(validatedBody).toMatchObject({
      listName: "Fall Partners",
      promoCode: "bulk20",
      organizations: [
        { name: "North League", teams: ["North U12", "North U14"] },
        { name: "South League", teams: ["South U12"] },
      ],
    });

    await user.click(screen.getByTestId("btn-org-bulk-import"));
    expect(await screen.findByTestId("bulk-import-success")).toHaveTextContent(
      "2 organizations created",
    );
    expect(importedBody).toEqual(validatedBody);
    expect(screen.getByText(/org-claim\/token-north/)).toBeInTheDocument();
  });

  it("opens the claim links and setup workflow inside Organizations", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminOrganizations />);

    expect(await screen.findByTestId("admin-org-overview")).toBeInTheDocument();
    await user.click(screen.getByTestId("tab-org-claim-links"));

    expect(screen.queryByTestId("admin-org-overview")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Claim links & setup" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("btn-org-quick-setup")).toBeInTheDocument();
    expect(screen.getByTestId("input-add-org-name")).toBeInTheDocument();
    expect(screen.getByTestId("claim-links-count")).toHaveTextContent(
      "0 ownerless pages",
    );
  });
});
