import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { customFetch } from "@workspace/api-client-react";
import { renderWithProviders } from "@/test";
import { parseOrganizationImportFile } from "@/lib/admin-org-import-file";
import { AdminPartnerLanding } from "./AdminPartnerLanding";

vi.mock("@workspace/api-client-react", () => ({ customFetch: vi.fn() }));
vi.mock("@/lib/admin-org-import-file", () => ({ parseOrganizationImportFile: vi.fn() }));
vi.mock("@/lib/extractBrandColors", () => ({ extractBrandColorsFromDataUrl: vi.fn(async () => null) }));

const fetchMock = vi.mocked(customFetch);
const parseMock = vi.mocked(parseOrganizationImportFile);
const summary = {
  id: "partner-import-test",
  slug: "import-test",
  officialName: "Import Test",
  associationLabel: "League",
  published: false,
  memberCount: 0,
};
let importReply: () => Promise<unknown>;
let validationError: Error | null;

beforeEach(() => {
  fetchMock.mockReset();
  parseMock.mockReset();
  validationError = null;
  importReply = async () => ({ data: { createdCount: 2, attachedCount: 0, skippedCount: 0 } });
  parseMock.mockResolvedValue({
    groups: [
      { name: "Alpha Soccer", teams: ["U12"], column: "A" },
      { name: "Bravo Soccer", teams: ["U14"], column: "B" },
    ],
    errors: [],
    warnings: [],
  } as never);
  fetchMock.mockImplementation(async (path, options) => {
    if (path === "/api/v1/admin/partner-pages") return { data: [summary] } as never;
    if (path === "/api/v1/admin/partner-pages/partner-import-test") {
      return { data: {
        ...summary, introduction: "", logoUrl: null, bannerUrl: null,
        primaryColor: "#155EEF", secondaryColor: "#06B6D4",
        competition: null, competitions: [], members: [], duplicateSwapRequests: [],
      } } as never;
    }
    if (String(path).endsWith("/import/validate")) {
      if (validationError) throw validationError;
      return { data: { rows: [
        {
          index: 0, name: "Alpha Soccer", sourceColumn: "A",
          warnings: ["Possible existing organizations found."],
          decisionRequired: true,
          candidates: [{ id: "existing-alpha", name: "Alpha Soccer", hasOwner: false }],
        },
        { index: 1, name: "Bravo Soccer", sourceColumn: "B", warnings: [], candidates: [] },
      ] } } as never;
    }
    if (String(path).endsWith("/import") && options?.method === "POST") return await importReply() as never;
    return { data: [] } as never;
  });
});

async function openImport() {
  const user = userEvent.setup();
  renderWithProviders(<AdminPartnerLanding />);
  await user.click(await screen.findByRole("button", { name: "Edit Import Test" }));
  await user.upload(screen.getByTestId("input-partner-import-file"),
    new File(["Alpha Soccer,Bravo Soccer\nU12,U14"], "clubs.csv", { type: "text/csv" }));
  await screen.findByTestId("select-import-decision-0");
  return user;
}

function importCalls() {
  return fetchMock.mock.calls.filter(([path, options]) => String(path).endsWith("/import") && options?.method === "POST");
}

function importBody(index = 0) {
  return JSON.parse(String(importCalls()[index]?.[1]?.body));
}

describe("partner spreadsheet import", () => {
  it("requires explicit collision decisions and resets correctly to undecided", async () => {
    const user = await openImport();
    const button = screen.getByTestId("btn-run-partner-import");
    const select = screen.getByTestId("select-import-decision-0");
    expect(button).toBeDisabled();
    expect(screen.getByText("Choose a decision for 1 more row before importing.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Review Alpha Soccer" }));
    expect(select).toHaveFocus();
    await user.selectOptions(select, "keep_distinct:");
    expect(button).toBeEnabled();
    await user.selectOptions(select, "");
    expect(button).toBeDisabled();
    expect(importCalls()).toHaveLength(0);
  });

  it("sends explicit creation despite a match as keep_distinct and shows completion", async () => {
    const user = await openImport();
    await user.selectOptions(screen.getByTestId("select-import-decision-0"), "keep_distinct:");
    await user.click(screen.getByTestId("btn-run-partner-import"));
    expect(await screen.findByTestId("partner-import-summary")).toHaveTextContent("Import complete");
    expect(importBody().organizations).toEqual([
      { name: "Alpha Soccer", teams: ["U12"], sourceColumn: "A", action: "keep_distinct" },
      { name: "Bravo Soccer", teams: ["U14"], sourceColumn: "B", action: "create" },
    ]);
    expect(screen.queryByTestId("btn-run-partner-import")).not.toBeInTheDocument();
  });

  it("preserves the chosen existing organization when attaching", async () => {
    const user = await openImport();
    await user.selectOptions(screen.getByTestId("select-import-decision-0"), "attach:existing-alpha");
    await user.click(screen.getByTestId("btn-run-partner-import"));
    await screen.findByTestId("partner-import-summary");
    expect(importBody().organizations[0]).toMatchObject({
      action: "attach", existingOrganizationId: "existing-alpha", candidateId: "existing-alpha",
    });
  });

  it("supports skipping a collision without creating a duplicate", async () => {
    const user = await openImport();
    await user.selectOptions(screen.getByTestId("select-import-decision-0"), "skip:");
    await user.click(screen.getByTestId("btn-run-partner-import"));
    await screen.findByTestId("partner-import-summary");
    expect(importBody().organizations[0].action).toBe("skip");
  });

  it("shows progress, prevents repeated submission, and retains rows and choices after a conflict", async () => {
    let rejectImport!: (error: Error) => void;
    importReply = () => new Promise((_, reject) => { rejectImport = reject; });
    const user = await openImport();
    await user.selectOptions(screen.getByTestId("select-import-decision-0"), "keep_distinct:");
    await user.click(screen.getByTestId("btn-run-partner-import"));
    const button = screen.getByTestId("btn-run-partner-import");
    expect(button).toHaveTextContent("Importing 2 rows");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    await user.click(button);
    expect(importCalls()).toHaveLength(1);
    await act(async () => rejectImport(new Error("Organization 1: a credible organization collision appeared")));
    expect(screen.getByTestId("partner-import-error")).toHaveTextContent("a credible organization collision appeared");
    expect(screen.getByTestId("partner-import-error")).toHaveTextContent("Your rows and choices have been kept");
    expect(screen.getByTestId("select-import-decision-0")).toHaveValue("keep_distinct:");
    expect(button).toBeEnabled();
    importReply = async () => ({ data: { createdCount: 2 } });
    await user.click(button);
    await screen.findByTestId("partner-import-summary");
    expect(importBody(1)).toEqual(importBody(0));
  });

  it("keeps the previous validated file and choices when validating a replacement file fails", async () => {
    const user = await openImport();
    await user.selectOptions(screen.getByTestId("select-import-decision-0"), "keep_distinct:");
    parseMock.mockResolvedValueOnce({
      groups: [{ name: "Wrong file", teams: [], column: "A" }], errors: [], warnings: [],
    } as never);
    validationError = new Error("Couldn't validate the new file");
    await user.upload(screen.getByTestId("input-partner-import-file"),
      new File(["Wrong file"], "replacement.csv", { type: "text/csv" }));
    expect(await screen.findByTestId("partner-import-error")).toHaveTextContent("Couldn't validate the new file");
    expect(screen.getByTestId("select-import-decision-0")).toHaveValue("keep_distinct:");
    await user.click(screen.getByTestId("btn-run-partner-import"));
    await screen.findByTestId("partner-import-summary");
    expect(importBody().organizations[0].name).toBe("Alpha Soccer");
    expect(importBody().idempotencyKey).toMatch(/^clubs\.csv:/);
  });
});
