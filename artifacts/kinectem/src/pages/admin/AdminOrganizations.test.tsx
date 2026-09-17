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
let partnerCompetitionBody: Record<string, unknown> | null = null;
let partnerOrgListBody: Record<string, unknown> | null = null;
let partnerImportBody: Record<string, unknown> | null = null;
let partnerValidateResponse: Record<string, unknown> | null = null;
let partnerDetailMembers: Array<Record<string, unknown>> = [];
let partnerReplacementPreviewBody: Record<string, unknown> | null = null;
let partnerReplacementBody: Record<string, unknown> | null = null;
let partnerReplacementKeys: string[] = [];
let partnerTeamBulkBody: Record<string, unknown> | null = null;
let partnerPages: Array<Record<string, unknown>> = [];
let partnerPublished = false;
let claimLinkRows: Array<Record<string, unknown>> = [];
let orgLists: Array<Record<string, unknown>> = [];
let bulkDeleteBody: Record<string, unknown> | null = null;
let ownerInviteBody: Record<string, unknown> | null = null;
let simulateDuplicateIssue = false;

beforeEach(() => {
  validatedBody = null;
  importedBody = null;
  partnerCreateBody = null;
  partnerCompetitionBody = null;
  partnerOrgListBody = null;
  partnerImportBody = null;
  partnerValidateResponse = null;
  partnerDetailMembers = [];
  partnerReplacementPreviewBody = null;
  partnerReplacementBody = null;
  partnerReplacementKeys = [];
  partnerTeamBulkBody = null;
  partnerPages = [];
  partnerPublished = false;
  claimLinkRows = [];
  orgLists = [];
  bulkDeleteBody = null;
  ownerInviteBody = null;
  simulateDuplicateIssue = false;
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
        return jsonResponse({ data: orgLists });
      }
      if (method === "GET" && path === "/api/v1/admin/org-claim-links") {
        return jsonResponse({ data: claimLinkRows });
      }
      if (method === "GET" && path === "/api/v1/admin/org-name-check") {
        return jsonResponse({ data: [] });
      }
      if (
        method === "POST" &&
        path === "/api/v1/admin/org-claim-links/org-1/email-owner-invite"
      ) {
        ownerInviteBody = JSON.parse(String(init?.body ?? "{}"));
        return jsonResponse({
          data: { sent: true, sentAt: "2026-09-04T13:00:00.000Z" },
        });
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
            competition: null,
            members: partnerDetailMembers,
          },
        });
      }
      if (
        method === "GET" &&
        path === "/api/v1/admin/partner-pages/partner-1/competition-search"
      ) {
        return jsonResponse({
          data: [
            {
              id: "competition-1",
              slug: "fall-classic",
              name: "Fall Classic",
              type: "tournament",
              startDate: "2026-10-03",
              endDate: "2026-10-04",
              location: "Riverside",
              linkedToPage: false,
            },
          ],
        });
      }
      if (
        method === "PUT" &&
        path === "/api/v1/admin/partner-pages/partner-1/competition"
      ) {
        partnerCompetitionBody = JSON.parse(String(init?.body ?? "{}"));
        return jsonResponse({
          data: { id: "partner-1", competitionId: "competition-1" },
          competition: {
            id: "competition-1",
            slug: "fall-classic",
            name: "Fall Classic",
            type: "tournament",
            startDate: "2026-10-03",
            endDate: "2026-10-04",
            location: "Riverside",
          },
        });
      }
      if (
        method === "POST" &&
        path === "/api/v1/admin/partner-pages/partner-1/lists/list-1"
      ) {
        partnerOrgListBody = JSON.parse(String(init?.body ?? "{}"));
        return jsonResponse({
          data: {
            list: { id: "list-1", name: "Fall Partners" },
            addedCount: 2,
            skippedCount: 0,
            organizationCount: 2,
          },
        }, 201);
      }
      if (
        method === "POST" &&
        path === "/api/v1/admin/partner-pages/partner-1/import/validate"
      ) {
        const body = JSON.parse(String(init?.body ?? "{}"));
        const rows = (body.organizations as Array<Record<string, unknown>>) ?? [];
        return jsonResponse({
          data: partnerValidateResponse ?? {
            valid: true,
            rows: rows.map((row, index) => ({
              index,
              sourceColumn: row.sourceColumn ?? `Column ${index + 1}`,
              name: row.name,
              warnings: [],
              possibleMatches: [],
            })),
          },
        });
      }
      if (
        method === "POST" &&
        path === "/api/v1/admin/partner-pages/partner-1/import"
      ) {
        partnerImportBody = JSON.parse(String(init?.body ?? "{}"));
        return jsonResponse({
          data: {
            createdCount: 0,
            attachedCount: 1,
            skippedCount: 0,
          },
        }, 201);
      }
      if (
        method === "POST" &&
        path === "/api/v1/admin/partner-pages/partner-1/members/member-1/replace/preview"
      ) {
        partnerReplacementPreviewBody = JSON.parse(String(init?.body ?? "{}"));
        return jsonResponse({
          data: {
            canReplace: true,
            summary: "One team and two posts will move.",
            affectedTeams: 1,
            affectedPosts: 2,
            warnings: ["Review the team names before confirming."],
          },
        });
      }
      if (
        method === "POST" &&
        path === "/api/v1/admin/partner-pages/partner-1/members/member-1/replace"
      ) {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        partnerReplacementBody = body;
        if (typeof body.idempotencyKey !== "string") {
          return jsonResponse({ error: "idempotencyKey is required" }, 400);
        }
        partnerReplacementKeys.push(body.idempotencyKey);
        if (partnerReplacementKeys.length === 1 && !partnerDetailMembers[0]?.protected) {
          return jsonResponse({ error: "retry this replacement" }, 500);
        }
        return jsonResponse({
          data: {
            summary: "One organization replaced.",
            affectedTeams: 1,
            affectedPosts: 2,
          },
        });
      }
      if (
        method === "POST" &&
        path === "/api/v1/admin/partner-pages/partner-1/teams/bulk-action"
      ) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          action: "delete" | "move";
          teamIds: string[];
          targetOrganizationId?: string;
        };
        partnerTeamBulkBody = body;
        return jsonResponse({
          data: {
            deleted: body.action === "delete" ? body.teamIds.length : 0,
            moved: body.action === "move" ? body.teamIds.length : 0,
            protected: [],
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
        const duplicateBlocked =
          simulateDuplicateIssue &&
          validatedBody?.allowDuplicateNames !== true;
        return jsonResponse({
          data: {
            valid: !duplicateBlocked,
            list: null,
            promo: {
              code: "bulk20",
              discountType: "percent",
              discountValue: 20,
            },
            organizations: (validatedBody?.organizations as unknown[]) ?? [],
            issues: duplicateBlocked
              ? [
                  {
                    scope: "organization",
                    organizationIndex: 0,
                    teamIndex: null,
                    message:
                      'Organization "Existing League" already exists. Imports never merge into an existing organization.',
                  },
                ]
              : [],
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
      if (
        method === "POST" &&
        path === "/api/v1/admin/org-claim-links/bulk-delete"
      ) {
        bulkDeleteBody = JSON.parse(String(init?.body ?? "{}"));
        const ids = Array.isArray(bulkDeleteBody.organizationIds)
          ? (bulkDeleteBody.organizationIds as string[])
          : claimLinkRows
              .filter((row) => row.listId === bulkDeleteBody?.listId)
              .map((row) => String(row.id));
        claimLinkRows = claimLinkRows.filter(
          (row) => !ids.includes(String(row.id)),
        );
        if (bulkDeleteBody.deleteList) {
          orgLists = orgLists.filter(
            (list) => list.id !== bulkDeleteBody?.listId,
          );
        }
        return jsonResponse({
          data: {
            requestedCount: ids.length,
            deletedCount: ids.length,
            deleted: [],
            protectedCount: 0,
            protected: [],
            missingCount: 0,
            listDeleted: Boolean(bulkDeleteBody.deleteList),
            list: bulkDeleteBody.listId
              ? { id: bulkDeleteBody.listId, name: "Fall Partners" }
              : null,
          },
        });
      }
      return jsonResponse({ error: "Unhandled in test", method, path }, 404);
    }),
  );
});

describe("AdminOrganizations bulk import", () => {
  function partnerMember(
    id: string,
    organizationId: string,
    name: string,
    importOperationId: string | null,
    teams: Array<{ id: string; name: string }>,
    hasOwner = false,
  ) {
    return {
      id,
      visible: true,
      sourceColumn: name,
      importOperationId,
      hasOwner,
      teamCount: teams.length,
      contentCount: 0,
      duplicateName: false,
      canDeleteStaleImport: !hasOwner,
      teams: teams.map((team) => ({
        ...team,
        organizationId,
        importOperationId,
        provenance: {
          teamImportOperationId: importOperationId,
          membershipImportOperationId: importOperationId,
          organizationCreatedByImportOperationId: importOperationId,
        },
        canDelete: !hasOwner,
      })),
      provenance: {
        membershipImportOperationId: importOperationId,
        organizationCreatedByImportOperationId: importOperationId,
      },
      organization: {
        id: organizationId,
        name,
        city: null,
        state: null,
        location: null,
        logoUrl: null,
        brandPrimaryColor: null,
        brandSecondaryColor: null,
      },
    };
  }

  async function openPartnerDirectory() {
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("tab-org-partner"));
    await user.click(await screen.findByRole("button", { name: /North Stars/ }));
    return user;
  }

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
      allowDuplicateNames: false,
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
    expect(screen.getByText(/\/claim\/token-north/)).toBeInTheDocument();
  });

  it("sends the explicit duplicate-name override to validation and import", async () => {
    simulateDuplicateIssue = true;
    const user = userEvent.setup();
    renderWithProviders(<AdminOrganizations />);

    await user.upload(
      await screen.findByTestId("input-org-bulk-file"),
      new File(["Existing League\nImported U12"], "duplicates.csv", {
        type: "text/csv",
      }),
    );
    await user.type(
      screen.getByTestId("input-org-bulk-list-name"),
      "Duplicate Partners",
    );
    await user.click(screen.getByTestId("btn-org-bulk-check"));

    await user.click(
      await screen.findByTestId("btn-org-bulk-override-duplicates"),
    );
    await waitFor(() =>
      expect(screen.getByTestId("btn-org-bulk-import")).toBeEnabled(),
    );
    expect(validatedBody?.allowDuplicateNames).toBe(true);

    await user.click(screen.getByTestId("btn-org-bulk-import"));
    await screen.findByTestId("bulk-import-success");
    expect(importedBody?.allowDuplicateNames).toBe(true);
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

  it("emails an unclaimed organization's secure owner invitation", async () => {
    claimLinkRows = [
      {
        id: "org-1",
        name: "North League",
        city: "Northville",
        state: "NY",
        logoUrl: null,
        token: "north-token",
        messagedAt: null,
        facebookAddedAt: null,
        quickSetupAt: null,
        listId: null,
        listName: null,
      },
    ];
    const user = userEvent.setup();
    renderWithProviders(<AdminOrganizations />);
    await user.click(await screen.findByTestId("tab-org-claim-links"));

    await user.click(screen.getByTestId("btn-email-owner-invite-org-1"));
    expect(screen.getByTestId("dialog-email-owner-invite")).toHaveTextContent(
      "North League",
    );
    await user.type(
      screen.getByLabelText("Owner email address"),
      "director@northleague.org",
    );
    await user.click(screen.getByTestId("btn-send-owner-invite"));

    await waitFor(() =>
      expect(ownerInviteBody).toEqual({
        email: "director@northleague.org",
      }),
    );
    expect(
      screen.queryByTestId("dialog-email-owner-invite"),
    ).not.toBeInTheDocument();
  });

  it("selects individual and all visible rows and requires typed bulk confirmation", async () => {
    claimLinkRows = [
      {
        id: "org-1",
        name: "North League",
        city: "Northville",
        state: "NY",
        logoUrl: null,
        token: "north-token",
        messagedAt: null,
        facebookAddedAt: null,
        quickSetupAt: null,
        listId: null,
        listName: null,
      },
      {
        id: "org-2",
        name: "South League",
        city: "Southville",
        state: "NJ",
        logoUrl: null,
        token: "south-token",
        messagedAt: null,
        facebookAddedAt: null,
        quickSetupAt: null,
        listId: null,
        listName: null,
      },
    ];
    const user = userEvent.setup();
    renderWithProviders(<AdminOrganizations />);
    await user.click(await screen.findByTestId("tab-org-claim-links"));

    await user.click(screen.getByTestId("checkbox-delete-org-org-2"));
    expect(screen.getByTestId("checkbox-delete-org-org-2")).toBeChecked();
    await user.click(screen.getByTestId("checkbox-delete-org-org-2"));
    expect(screen.getByTestId("checkbox-delete-org-org-2")).not.toBeChecked();

    await user.type(screen.getByTestId("input-claim-links-search"), "North");
    const selectAll = screen.getAllByTestId(
      "checkbox-delete-select-all-visible",
    )[0];
    await user.click(selectAll);
    expect(screen.getByTestId("checkbox-delete-org-org-1")).toBeChecked();
    expect(
      screen.queryByTestId("checkbox-delete-org-org-2"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("btn-delete-selected-orgs")).toHaveTextContent(
      "1 selected",
    );

    await user.click(screen.getByTestId("btn-delete-selected-orgs"));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(bulkDeleteBody).toBeNull();
    await user.click(screen.getByTestId("btn-delete-selected-orgs"));
    const confirmButton = screen.getByTestId(
      "button-confirm-delete-organizations",
    );
    expect(confirmButton).toBeDisabled();
    await user.type(
      screen.getByTestId("input-delete-organizations-confirmation"),
      "DELETE UNCLAIMED ORGANIZATIONS",
    );
    expect(confirmButton).toBeEnabled();
    await user.click(confirmButton);
    await waitFor(() =>
      expect(bulkDeleteBody).toEqual({
        organizationIds: ["org-1"],
        confirm: "DELETE UNCLAIMED ORGANIZATIONS",
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByTestId("row-claim-link-org-1"),
      ).not.toBeInTheDocument(),
    );
  });

  it("keeps list-only deletion distinct and requires the exact list name to delete its organizations", async () => {
    orgLists = [
      {
        id: "list-1",
        name: "Fall Partners",
        orgCount: 1,
        createdAt: "2026-09-01T00:00:00.000Z",
      },
    ];
    claimLinkRows = [
      {
        id: "org-1",
        name: "North League",
        city: null,
        state: null,
        logoUrl: null,
        token: "north-token",
        messagedAt: null,
        facebookAddedAt: null,
        quickSetupAt: null,
        listId: "list-1",
        listName: "Fall Partners",
      },
    ];
    const user = userEvent.setup();
    renderWithProviders(<AdminOrganizations />);
    await user.click(await screen.findByTestId("tab-org-claim-links"));

    expect(screen.getByTestId("btn-delete-list-list-1")).toHaveAccessibleName(
      "Delete list Fall Partners",
    );
    await user.click(screen.getByTestId("btn-delete-list-and-orgs-list-1"));
    const confirmation = screen.getByTestId(
      "input-delete-organizations-confirmation",
    );
    const submit = screen.getByTestId("button-confirm-delete-organizations");
    await user.type(confirmation, "fall partners");
    expect(submit).toBeDisabled();
    await user.clear(confirmation);
    await user.type(confirmation, "Fall Partners");
    await user.click(submit);

    await waitFor(() =>
      expect(bulkDeleteBody).toEqual({
        listId: "list-1",
        deleteList: true,
        confirm: "Fall Partners",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("list-chip-list-1")).not.toBeInTheDocument(),
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

  it("filters existing partner pages and keeps the filtered selection workflow", async () => {
    partnerPages = [
      {
        id: "partner-1",
        slug: "north-stars",
        officialName: "North Stars",
        associationLabel: "East Coast Soccer",
        published: false,
        memberCount: 4,
      },
      {
        id: "partner-2",
        slug: "river-city-fc",
        officialName: "River City FC",
        associationLabel: "Metro League",
        published: true,
        memberCount: 7,
      },
    ];
    const user = userEvent.setup();
    renderWithProviders(<AdminOrganizations />);

    await user.click(await screen.findByTestId("tab-org-partner"));
    const searchInput = await screen.findByTestId("input-partner-page-search");
    expect(
      screen.getByLabelText("Search existing partner pages"),
    ).toBe(searchInput);
    expect(screen.getByRole("button", { name: /North Stars/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /River City FC/ })).toBeInTheDocument();

    await user.type(searchInput, "METRO");
    expect(screen.getByRole("button", { name: /River City FC/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /North Stars/ })).not.toBeInTheDocument();

    await user.clear(searchInput);
    await user.type(searchInput, "NORTH");
    expect(screen.getByRole("button", { name: /North Stars/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /River City FC/ })).not.toBeInTheDocument();

    await user.clear(searchInput);
    expect(screen.getByRole("button", { name: /North Stars/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /River City FC/ })).toBeInTheDocument();

    await user.type(searchInput, "north-stars");
    await user.click(screen.getByRole("button", { name: /North Stars/ }));
    expect(await screen.findByText("Partner identity and branding")).toBeInTheDocument();
  });

  it("shows a clear empty state when no partner page matches the search", async () => {
    partnerPages = [
      {
        id: "partner-1",
        slug: "north-stars",
        officialName: "North Stars",
        associationLabel: "East Coast Soccer",
        published: false,
        memberCount: 0,
      },
    ];
    const user = userEvent.setup();
    renderWithProviders(<AdminOrganizations />);

    await user.click(await screen.findByTestId("tab-org-partner"));
    const searchInput = await screen.findByTestId("input-partner-page-search");
    await user.type(searchInput, "does-not-exist");

    expect(screen.queryByRole("button", { name: /North Stars/ })).not.toBeInTheDocument();
    expect(screen.getByTestId("partner-page-search-empty")).toHaveTextContent(
      "No existing partner pages match “does-not-exist”.",
    );
    expect(screen.getByRole("button", { name: "Create partner page" })).toBeInTheDocument();
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

  it("generates and copies a partnership-specific outreach message", async () => {
    partnerPages = [
      {
        id: "partner-1",
        slug: "north-stars",
        officialName: "North Stars",
        associationLabel: "East Coast Soccer",
        published: false,
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

    const message = await screen.findByTestId(
      "textarea-partner-outreach-message",
    );
    expect((message as HTMLTextAreaElement).value).toContain(
      "North Stars has partnered with Kinectem",
    );
    expect((message as HTMLTextAreaElement).value).toContain(
      "/partners/north-stars",
    );
    expect((message as HTMLTextAreaElement).value).toContain(
      "As a North Stars club",
    );
    expect((message as HTMLTextAreaElement).value).toContain(
      "AI Assist is built into the game recap composer",
    );

    await user.click(
      screen.getByRole("button", { name: "Copy outreach message" }),
    );
    expect(clipboardWrite).toHaveBeenCalledWith(
      expect.stringContaining("The North Stars team"),
    );
    expect(
      screen.getByRole("button", { name: "Copied!" }),
    ).toBeInTheDocument();
  });

  it("searches and attaches a featured competition with a path to its console", async () => {
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
    await user.type(
      await screen.findByTestId("input-partner-competition-search"),
      "Fall",
    );
    await user.click(await screen.findByRole("button", { name: "Feature" }));

    await waitFor(() =>
      expect(partnerCompetitionBody).toEqual({
        competitionId: "competition-1",
      }),
    );
    expect(
      screen.getByTestId("featured-competition-current"),
    ).toHaveTextContent("Fall Classic");
    expect(
      screen.getByRole("button", { name: "Open console" }).closest("a"),
    ).toHaveAttribute("href", "/competitions/competition-1");
  });

  it("adds all organizations from a saved list to the partner page", async () => {
    orgLists = [
      {
        id: "list-1",
        name: "Fall Partners",
        orgCount: 2,
        createdAt: "2026-09-01T00:00:00.000Z",
      },
    ];
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
    const listSelect = await screen.findByTestId("select-partner-org-list");
    await user.selectOptions(listSelect, "list-1");
    await user.click(screen.getByTestId("btn-add-partner-org-list"));

    await waitFor(() =>
      expect(partnerOrgListBody).toEqual({}),
    );
    await waitFor(() =>
      expect(screen.getByTestId("btn-add-partner-org-list")).toBeEnabled(),
    );
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

    await user.click(screen.getByTestId("btn-swap-partner-brand-colors"));
    expect(screen.getByTestId("input-partner-primary-color")).toHaveValue(
      "#141414",
    );
    expect(screen.getByTestId("input-partner-secondary-color")).toHaveValue(
      "#e6781e",
    );
  });

  it("requires an explicit decision for a credible import collision", async () => {
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
    partnerValidateResponse = {
      valid: true,
      rows: [
        {
          index: 0,
          sourceColumn: "North Stars",
          name: "North Stars",
          warnings: ["Possible existing organization found."],
          requiresDecision: true,
          rememberedDecision: "attach",
          candidates: [
            {
              id: "org-existing",
              name: "North Stars",
              city: "Riverside",
              state: "NY",
              location: "Riverside, NY",
              hasOwner: true,
              claimed: true,
              matchKind: "exact_name",
              evidence: ["Exact organization name"],
              teamNames: ["North U12"],
              partnerPages: [{ name: "North Stars League" }],
              alreadyIncluded: false,
            },
          ],
        },
      ],
    };
    const user = userEvent.setup();
    renderWithProviders(<AdminOrganizations />);

    await user.click(await screen.findByTestId("tab-org-partner"));
    await user.click(await screen.findByRole("button", { name: /North Stars/ }));
    await user.upload(
      await screen.findByTestId("input-partner-import-file"),
      new File(["North Stars\nNorth U12"], "north-stars.csv", { type: "text/csv" }),
    );

    expect(await screen.findByTestId("candidate-comparison-0")).toHaveTextContent(
      "Exact Name",
    );
    expect(screen.getByTestId("import-review-row-0")).toHaveTextContent(
      "Remembered: attach",
    );
    expect(screen.getByTestId("btn-run-partner-import")).toBeDisabled();

    await user.selectOptions(
      screen.getByTestId("select-import-decision-0"),
      "attach:org-existing",
    );
    expect(screen.getByTestId("btn-run-partner-import")).toBeEnabled();
    await user.click(screen.getByTestId("btn-run-partner-import"));
    await waitFor(() =>
      expect(partnerImportBody?.organizations).toEqual([
        expect.objectContaining({
          action: "attach",
          candidateId: "org-existing",
          existingOrganizationId: "org-existing",
          teams: ["North U12"],
        }),
      ]),
    );
    expect(await screen.findByTestId("partner-import-summary")).toHaveTextContent(
      "1 attached",
    );
  });

  it("previews a protected duplicate replacement before confirmation", async () => {
    partnerPages = [
      {
        id: "partner-1",
        slug: "north-stars",
        officialName: "North Stars",
        associationLabel: "League / association",
        published: false,
        memberCount: 1,
      },
    ];
    partnerDetailMembers = [
      {
        id: "member-1",
        visible: true,
        sourceColumn: "North Stars",
        importOperationId: "import-1",
        hasOwner: false,
        teamCount: 1,
        contentCount: 2,
        duplicateName: true,
        canDeleteStaleImport: true,
        protected: false,
        protection: [],
        cleanup: { allowed: true, summary: "Safe after replacement" },
        organization: {
          id: "org-old",
          name: "North Stars",
          city: "Riverside",
          state: "NY",
          location: "Riverside, NY",
          logoUrl: null,
        },
        duplicateCandidates: [
          {
            id: "org-new",
            name: "North Stars Soccer",
            city: "Riverside",
            state: "NY",
            location: "Riverside, NY",
            hasOwner: false,
            alreadyIncluded: false,
            matchKind: "same_location",
          },
        ],
      },
    ];
    const user = userEvent.setup();
    renderWithProviders(<AdminOrganizations />);
    await user.click(await screen.findByTestId("tab-org-partner"));
    await user.click(await screen.findByRole("button", { name: /North Stars/ }));

    const previewButton = await screen.findByTestId(
      "btn-preview-replace-member-1-org-new",
    );
    expect(previewButton).toBeEnabled();
    await user.click(previewButton);
    const dialog = await screen.findByTestId("dialog-partner-replacement");
    expect(dialog).toHaveTextContent("One team and two posts will move.");
    expect(screen.getByTestId("btn-confirm-partner-replacement")).toBeEnabled();
    expect(partnerReplacementPreviewBody).toEqual({
      candidateId: "org-new",
      organizationId: "org-new",
    });
    await user.click(screen.getByTestId("btn-confirm-partner-replacement"));
    expect(partnerReplacementBody).toEqual({
      action: "attach",
      candidateId: "org-new",
      organizationId: "org-new",
      confirmed: true,
      idempotencyKey: expect.any(String),
    });
    expect(partnerReplacementKeys).toHaveLength(1);
    expect(screen.queryByTestId("partner-replacement-summary")).not.toBeInTheDocument();
    expect(screen.getByTestId("btn-confirm-partner-replacement")).toBeEnabled();
    await user.click(screen.getByTestId("btn-confirm-partner-replacement"));
    expect(partnerReplacementKeys).toHaveLength(2);
    expect(partnerReplacementKeys[1]).toBe(partnerReplacementKeys[0]);
    expect(await screen.findByTestId("partner-replacement-summary")).toHaveTextContent(
      "One organization replaced.",
    );
  });

  it("allows protected members to replace directory membership only", async () => {
    partnerPages = [
      {
        id: "partner-1",
        slug: "north-stars",
        officialName: "North Stars",
        associationLabel: "League / association",
        published: false,
        memberCount: 1,
      },
    ];
    partnerDetailMembers = [
      {
        id: "member-1",
        visible: true,
        sourceColumn: "North Stars",
        importOperationId: "import-1",
        hasOwner: false,
        teamCount: 1,
        contentCount: 0,
        duplicateName: true,
        canDeleteStaleImport: false,
        protected: true,
        protection: ["has_owner"],
        cleanup: { allowed: true },
        organization: {
          id: "org-old",
          name: "North Stars",
          city: "Riverside",
          state: "NY",
          location: "Riverside, NY",
          logoUrl: null,
        },
        duplicateCandidates: [
          {
            id: "org-new",
            name: "North Stars Soccer",
            city: "Riverside",
            state: "NY",
            location: "Riverside, NY",
            hasOwner: false,
            alreadyIncluded: false,
          },
        ],
      },
    ];
    const user = userEvent.setup();
    renderWithProviders(<AdminOrganizations />);
    await user.click(await screen.findByTestId("tab-org-partner"));
    await user.click(await screen.findByRole("button", { name: /North Stars/ }));

    const previewButton = await screen.findByTestId(
      "btn-preview-replace-member-1-org-new",
    );
    expect(previewButton).toBeEnabled();
    await user.click(previewButton);
    const dialog = await screen.findByTestId("dialog-partner-replacement");
    expect(dialog).toHaveTextContent("source organization and its protected data remain in place");
    await user.click(screen.getByTestId("btn-confirm-partner-replacement"));
    expect(await screen.findByTestId("partner-replacement-summary")).toHaveTextContent(
      "One organization replaced.",
    );
  });

  it("selects multiple teams and only offers ownerless organizations from the same upload", async () => {
    partnerPages = [
      {
        id: "partner-1",
        slug: "north-stars",
        officialName: "North Stars",
        associationLabel: "League / association",
        published: false,
        memberCount: 4,
      },
    ];
    partnerDetailMembers = [
      partnerMember("member-source", "org-source", "Imported North", "import-1", [
        { id: "team-1", name: "North U12" },
        { id: "team-2", name: "North U14" },
      ]),
      partnerMember("member-target", "org-target", "Imported South", "import-1", [
        { id: "team-3", name: "South U12" },
      ]),
      partnerMember("member-other-batch", "org-other", "Other Batch", "import-2", [
        { id: "team-4", name: "Other U12" },
      ]),
      partnerMember("member-claimed", "org-claimed", "Claimed Club", "import-1", [
        { id: "team-5", name: "Claimed U12" },
      ], true),
    ];
    const user = userEvent.setup();
    renderWithProviders(<AdminOrganizations />);
    await user.click(await screen.findByTestId("tab-org-partner"));
    await user.click(await screen.findByRole("button", { name: /North Stars/ }));

    const first = await screen.findByTestId("checkbox-team-team-1");
    const second = screen.getByTestId("checkbox-team-team-2");
    expect(first).toBeEnabled();
    expect(screen.getByTestId("checkbox-team-team-5")).toBeDisabled();
    await user.click(first);
    await user.click(second);

    const targetSelect = screen.getByTestId("select-move-selected-teams-target");
    expect(targetSelect).toBeEnabled();
    expect(screen.getByRole("option", { name: "Imported South" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Other Batch" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Claimed Club" })).not.toBeInTheDocument();
  });

  it("sends move and delete team bulk payloads only after delete confirmation", async () => {
    partnerPages = [
      {
        id: "partner-1",
        slug: "north-stars",
        officialName: "North Stars",
        associationLabel: "League / association",
        published: false,
        memberCount: 2,
      },
    ];
    partnerDetailMembers = [
      partnerMember("member-source", "org-source", "Imported North", "import-1", [
        { id: "team-1", name: "North U12" },
        { id: "team-2", name: "North U14" },
      ]),
      partnerMember("member-target", "org-target", "Imported South", "import-1", []),
    ];
    const user = userEvent.setup();
    renderWithProviders(<AdminOrganizations />);
    await user.click(await screen.findByTestId("tab-org-partner"));
    await user.click(await screen.findByRole("button", { name: /North Stars/ }));
    await user.click(await screen.findByTestId("checkbox-team-team-1"));
    await user.selectOptions(
      screen.getByTestId("select-move-selected-teams-target"),
      "org-target",
    );
    await user.click(screen.getByTestId("button-move-selected-teams"));

    await waitFor(() =>
      expect(partnerTeamBulkBody).toEqual({
        teamIds: ["team-1"],
        action: "move",
        targetOrganizationId: "org-target",
      }),
    );
    expect(screen.getByTestId("checkbox-team-team-1")).not.toBeChecked();

    await user.click(screen.getByTestId("checkbox-team-team-2"));
    await user.click(screen.getByTestId("button-delete-selected-teams"));
    const deleteDialog = screen.getByTestId("dialog-delete-selected-teams");
    expect(deleteDialog).toHaveTextContent(
      "Permanently delete 1 selected team?",
    );
    expect(deleteDialog).toHaveTextContent(
      "rosters, schedules, recaps/highlights, invitations, followers",
    );
    expect(partnerTeamBulkBody).toMatchObject({ action: "move" });

    await user.click(screen.getByTestId("button-cancel-delete-selected-teams"));
    expect(screen.queryByTestId("dialog-delete-selected-teams")).not.toBeInTheDocument();
    expect(partnerTeamBulkBody).toMatchObject({ action: "move" });
    await user.click(screen.getByTestId("button-delete-selected-teams"));
    await user.click(screen.getByTestId("button-confirm-delete-selected-teams"));
    await waitFor(() =>
      expect(partnerTeamBulkBody).toEqual({
        teamIds: ["team-2"],
        action: "delete",
      }),
    );
  });

  it("keeps delete available but disables move for a team without uploaded-batch provenance", async () => {
    partnerPages = [
      {
        id: "partner-1",
        slug: "north-stars",
        officialName: "North Stars",
        associationLabel: "League / association",
        published: false,
        memberCount: 2,
      },
    ];
    partnerDetailMembers = [
      partnerMember("member-source", "org-source", "Imported North", "import-1", [
        { id: "team-unstamped", name: "Legacy U12" },
      ]),
      partnerMember("member-target", "org-target", "Imported South", "import-1", []),
    ];
    // This team exists on an imported organization, but was not created by
    // that upload operation.
    (partnerDetailMembers[0].teams as Array<Record<string, unknown>>)[0] = {
      id: "team-unstamped",
      name: "Legacy U12",
      organizationId: "org-source",
      importOperationId: null,
      provenance: {
        teamImportOperationId: null,
        membershipImportOperationId: "import-1",
        organizationCreatedByImportOperationId: "import-1",
      },
      canDelete: true,
    };
    const user = userEvent.setup();
    renderWithProviders(<AdminOrganizations />);
    await user.click(await screen.findByTestId("tab-org-partner"));
    await user.click(await screen.findByRole("button", { name: /North Stars/ }));
    await user.click(await screen.findByTestId("checkbox-team-team-unstamped"));

    expect(screen.getByTestId("button-delete-selected-teams")).toBeEnabled();
    expect(screen.getByTestId("select-move-selected-teams-target")).toBeDisabled();
    expect(screen.getByTestId("team-bulk-move-help")).toHaveTextContent(
      "not created by the uploaded batch",
    );
  });
});
