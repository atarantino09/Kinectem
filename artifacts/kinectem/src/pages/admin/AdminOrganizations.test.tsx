import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test";
import AdminOrganizations from "./AdminOrganizations";

vi.mock("@/lib/extractBrandColors", () => ({
  extractBrandColorsFromDataUrl: vi.fn(async () => ({
    primary: "#e6781e",
    secondary: "#141414",
  })),
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let validatedBody: Record<string, unknown> | null = null;
let importedBody: Record<string, unknown> | null = null;
let partnerCreateBody: Record<string, unknown> | null = null;
let partnerPages: Array<Record<string, unknown>> = [];
let partnerPublished = false;

beforeEach(() => {
  validatedBody = null;
  importedBody = null;
  partnerCreateBody = null;
  partnerPages = [];
  partnerPublished = false;
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
      if (method === "GET" && path === "/api/v1/admin/partner-pages") {
        return jsonResponse({ data: partnerPages });
      }
      if (
        method === "GET" &&
        path === "/api/v1/admin/partner-pages/partner-1"
      ) {
        return jsonResponse({
          data: {
            id: "partner-1",
            slug: "north-stars",
            officialName: "North Stars",
            associationLabel: "League / association",
            introduction: "",
            logoUrl: null,
            bannerUrl: null,
            primaryColor: "#155EEF",
            secondaryColor: "#06B6D4",
            published: partnerPublished,
            memberCount: 0,
            members: [],
          },
        });
      }
      if (method === "POST" && path === "/api/v1/admin/partner-pages") {
        partnerCreateBody = JSON.parse(String(init?.body ?? "{}"));
        return jsonResponse(
          {
            data: {
              id: "partner-1",
              slug: String(partnerCreateBody?.slug ?? ""),
              officialName: String(partnerCreateBody?.officialName ?? ""),
              associationLabel: "League / association",
              published: false,
              memberCount: 0,
            },
          },
          201,
        );
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
              promoCode:
                typeof importedBody?.promoCode === "string"
                  ? importedBody.promoCode
                  : null,
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
        [
          "North League,South League\nNorth U12,South U12\nNorth U14,\nNorth U12,",
        ],
        "partner-organizations.csv",
        { type: "text/csv" },
      ),
    );
    expect(await screen.findByTestId("bulk-import-preview")).toHaveTextContent(
      "2 organizations · 3 teams",
    );
    expect(screen.queryByTestId("bulk-import-issues")).not.toBeInTheDocument();

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

  it("validates and creates an import without a promo code", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminOrganizations />);

    await user.upload(
      await screen.findByTestId("input-org-bulk-file"),
      new File(["No Promo League\nNo Promo U12"], "no-promo.csv", {
        type: "text/csv",
      }),
    );
    await user.type(
      screen.getByTestId("input-org-bulk-list-name"),
      "No Promo Partners",
    );

    expect(
      screen.getByLabelText(/Promo code for this batch/i),
    ).toBeInTheDocument();
    expect(screen.getByTestId("btn-org-bulk-check")).toBeEnabled();
    await user.click(screen.getByTestId("btn-org-bulk-check"));

    await waitFor(() =>
      expect(screen.getByTestId("btn-org-bulk-import")).toBeEnabled(),
    );
    expect(validatedBody).toMatchObject({
      listName: "No Promo Partners",
      promoCode: null,
      organizations: [{ name: "No Promo League", teams: ["No Promo U12"] }],
    });

    await user.click(screen.getByTestId("btn-org-bulk-import"));
    expect(await screen.findByTestId("bulk-import-success")).toHaveTextContent(
      "No promo code was assigned.",
    );
    expect(importedBody?.promoCode).toBeNull();
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

  it("normalizes pasted partner URLs, blocks invalid values, and submits the canonical URL", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminOrganizations />);

    await user.click(await screen.findByTestId("tab-org-partner"));
    const slugInput = await screen.findByTestId("input-partner-slug");
    const createButton = screen.getByRole("button", {
      name: "Create partner page",
    });

    expect(createButton).toBeDisabled();
    expect(screen.getByTestId("partner-slug-error")).toHaveTextContent(
      "Enter a partner URL segment.",
    );

    await user.type(
      screen.getByLabelText("Official partner name"),
      "North Stars",
    );
    await user.click(slugInput);
    await user.paste("https://www.enysoccer.com");

    expect(slugInput).toHaveValue("www-enysoccer-com");
    expect(screen.getByTestId("partner-url-preview")).toHaveTextContent(
      "/partners/www-enysoccer-com",
    );
    expect(createButton).toBeEnabled();

    await user.clear(slugInput);
    await user.type(slugInput, "!!!");
    expect(createButton).toBeDisabled();
    expect(screen.getByTestId("partner-slug-error")).toHaveTextContent(
      "Use letters, numbers, or paste an http(s) web address.",
    );
    expect(partnerCreateBody).toBeNull();

    await user.clear(slugInput);
    await user.type(slugInput, "North -- Stars");
    await user.click(createButton);

    await waitFor(() =>
      expect(partnerCreateBody).toMatchObject({
        officialName: "North Stars",
        slug: "north-stars",
      }),
    );
    expect(
      await screen.findByText("Partner identity and branding"),
    ).toBeInTheDocument();
  });

  it("uses the canonical slug for partner preview and clipboard sharing", async () => {
    partnerPublished = true;
    partnerPages = [
      {
        id: "partner-1",
        slug: "north-stars",
        officialName: "North Stars",
        associationLabel: "League / association",
        published: true,
        memberCount: 0,
      },
    ];
    const user = userEvent.setup();
    const clipboardWrite = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
    renderWithProviders(<AdminOrganizations />);

    await user.click(await screen.findByTestId("tab-org-partner"));
    await user.click(
      await screen.findByRole("button", { name: /North Stars/ }),
    );

    const previewButton = await screen.findByRole("button", {
      name: "Preview public page",
    });
    expect(previewButton.closest("a")).toHaveAttribute(
      "href",
      "/partners/north-stars",
    );

    await user.click(
      screen.getByRole("button", { name: "Copy shareable URL" }),
    );
    expect(clipboardWrite).toHaveBeenCalledWith(
      expect.stringMatching(/\/partners\/north-stars$/),
    );
    expect(screen.getByText(/\/partners\/north-stars$/)).toBeInTheDocument();
  });

  it("picks partner branding colors from the uploaded logo", async () => {
    partnerPages = [
      {
        id: "partner-1",
        slug: "north-stars",
        officialName: "North Stars",
        associationLabel: "League / association",
        published: false,
        memberCount: 0,
      },
    ];
    const user = userEvent.setup();
    renderWithProviders(<AdminOrganizations />);

    await user.click(await screen.findByTestId("tab-org-partner"));
    await user.click(
      await screen.findByRole("button", { name: /North Stars/ }),
    );
    const logoUrl = await screen.findByTestId("input-partner-logo-url");
    await user.click(logoUrl);
    await user.paste("data:image/png;base64,partner-logo");

    await waitFor(() => {
      expect(screen.getByTestId("input-partner-primary-color")).toHaveValue(
        "#e6781e",
      );
      expect(screen.getByTestId("input-partner-secondary-color")).toHaveValue(
        "#141414",
      );
    });
  });
});
