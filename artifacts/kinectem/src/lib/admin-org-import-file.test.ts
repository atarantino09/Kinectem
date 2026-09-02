import { describe, expect, it } from "vitest";
import * as XLSX from "@e965/xlsx";
import { parseOrganizationImportFile } from "./admin-org-import-file";

function xlsxFile(rows: unknown[][], name = "partner-orgs.xlsx") {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Organizations");
  const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  return new File([buffer], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

describe("organization import file parser", () => {
  it("treats each column as an organization and ignores blank cells", async () => {
    const parsed = await parseOrganizationImportFile(
      new File(
        ["North League,South League\nNorth U12,South U12\n,South U14\nNorth U14,"],
        "orgs.csv",
        { type: "text/csv" },
      ),
    );
    expect(parsed.groups).toEqual([
      {
        column: "A",
        name: "North League",
        teams: ["North U12", "North U14"],
        duplicateTeams: [],
      },
      {
        column: "B",
        name: "South League",
        teams: ["South U12", "South U14"],
        duplicateTeams: [],
      },
    ]);
    expect(parsed.totalTeams).toBe(4);
  });

  it("reads the first populated sheet in an Excel workbook", async () => {
    const parsed = await parseOrganizationImportFile(
      xlsxFile([
        ["", ""],
        ["", "East Association"],
        ["", "East U10"],
      ]),
    );
    expect(parsed.groups[0]).toMatchObject({
      column: "B",
      name: "East Association",
      teams: ["East U10"],
    });
  });

  it("collapses repeated team names but still blocks repeated organization names", async () => {
    const parsed = await parseOrganizationImportFile(
      new File(
        ["Same Org,Same Org\nBlue,Green\nblue,Yellow"],
        "duplicates.csv",
        { type: "text/csv" },
      ),
    );
    expect(parsed.groups[0]).toMatchObject({
      teams: ["Blue"],
      duplicateTeams: ["blue"],
    });
    expect(parsed.totalTeams).toBe(3);
    expect(parsed.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("same organization name")]),
    );
    expect(parsed.errors).not.toEqual(
      expect.arrayContaining([expect.stringContaining("repeats team name")]),
    );
    expect(parsed.warnings).toEqual([]);
  });
});
