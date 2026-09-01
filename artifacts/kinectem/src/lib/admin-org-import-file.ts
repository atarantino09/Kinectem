import { parseCsv } from "@/components/BulkPairEditor";
import type { WorkBook } from "@e965/xlsx";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_IMPORT_COLUMNS = 200;
export const MAX_IMPORT_ROWS = 501;

export type OrgImportGroup = {
  column: string;
  name: string;
  teams: string[];
  duplicateTeams: string[];
};

export type OrgImportParseResult = {
  groups: OrgImportGroup[];
  warnings: string[];
  errors: string[];
  rowCount: number;
  columnCount: number;
  totalTeams: number;
};

function readAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === "function") return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(reader.error ?? new Error("Couldn't read the Excel workbook."));
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new Error("Couldn't read the Excel workbook."));
    };
    reader.readAsArrayBuffer(file);
  });
}

function readAsText(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(reader.error ?? new Error("Couldn't read the CSV file."));
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Couldn't read the CSV file."));
    };
    reader.readAsText(file);
  });
}

function columnLabel(index: number): string {
  let n = index + 1;
  let label = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

function isXlsx(file: File): boolean {
  return /\.(xlsx|xls)$/i.test(file.name) ||
    file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    file.type === "application/vnd.ms-excel";
}

async function readRows(file: File): Promise<string[][]> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("That file is too large. Choose a CSV or Excel file under 10 MB.");
  }
  if (isXlsx(file)) {
    const XLSX = await import("@e965/xlsx");
    let workbook: WorkBook;
    try {
      workbook = XLSX.read(await readAsArrayBuffer(file), {
        type: "array",
        cellDates: false,
        cellNF: false,
      });
    } catch {
      throw new Error("That Excel workbook couldn't be opened.");
    }
    const sheetName = workbook.SheetNames.find((name: string) => {
      const sheet = workbook.Sheets[name];
      if (!sheet) return false;
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        blankrows: false,
        defval: "",
        raw: false,
      });
      return rows.some((row) =>
        row.some((cell) => String(cell ?? "").trim() !== ""),
      );
    });
    if (!sheetName) throw new Error("That Excel workbook is empty.");
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) throw new Error("That Excel workbook couldn't be read.");
    return XLSX.utils
      .sheet_to_json<unknown[]>(sheet, {
        header: 1,
        blankrows: false,
        defval: "",
        raw: false,
      })
      .map((row) => row.map((cell) => String(cell ?? "")));
  }
  if (file.name.toLowerCase().endsWith(".csv") || file.type === "text/csv") {
    return parseCsv(await readAsText(file));
  }
  throw new Error("Choose a CSV or Excel (.xlsx) file.");
}

export async function parseOrganizationImportFile(
  file: File,
): Promise<OrgImportParseResult> {
  const rows = await readRows(file);
  if (rows.length === 0) throw new Error("That file is empty.");
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new Error(`That file has too many rows. Use ${MAX_IMPORT_ROWS - 1} rows or fewer.`);
  }

  const columnCount = Math.max(...rows.map((row) => row.length), 0);
  if (columnCount === 0) throw new Error("That file is empty.");
  if (columnCount > MAX_IMPORT_COLUMNS) {
    throw new Error(`That file has too many columns. Use ${MAX_IMPORT_COLUMNS} organizations or fewer.`);
  }

  const groups: OrgImportGroup[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  let totalTeams = 0;

  for (let column = 0; column < columnCount; column++) {
    const cells = rows.map((row) => (row[column] ?? "").trim());
    const firstValue = cells.findIndex(Boolean);
    if (firstValue === -1) {
      if (column < columnCount - 1) {
        warnings.push(`Column ${columnLabel(column)} is blank and will be skipped.`);
      }
      continue;
    }
    const name = cells[firstValue];
    const rawTeams = cells.slice(firstValue + 1).filter(Boolean);
    const teams: string[] = [];
    const duplicateTeams: string[] = [];
    const seen = new Set<string>();
    for (const team of rawTeams) {
      const key = team.toLowerCase();
      if (seen.has(key)) {
        if (!duplicateTeams.some((item) => item.toLowerCase() === key)) {
          duplicateTeams.push(team);
        }
        continue;
      }
      seen.add(key);
      teams.push(team);
    }
    if (duplicateTeams.length > 0) {
      warnings.push(
        `Column ${columnLabel(column)} (“${name}”) repeats team name${duplicateTeams.length === 1 ? "" : "s"}; repeated names will be imported once: ${duplicateTeams.join(", ")}.`,
      );
    }
    if (teams.length === 0) {
      warnings.push(`Column ${columnLabel(column)} (“${name}”) has no teams.`);
    }
    groups.push({
      column: columnLabel(column),
      name,
      teams,
      duplicateTeams,
    });
    totalTeams += teams.length;
  }

  if (groups.length === 0) throw new Error("No organizations were found in that file.");

  const seenOrganizations = new Map<string, string>();
  for (const group of groups) {
    const key = group.name.toLowerCase();
    const previous = seenOrganizations.get(key);
    if (previous) {
      errors.push(
        `Columns ${previous} and ${group.column} use the same organization name (“${group.name}”).`,
      );
    } else {
      seenOrganizations.set(key, group.column);
    }
  }

  return {
    groups,
    warnings,
    errors,
    rowCount: rows.length,
    columnCount,
    totalTeams,
  };
}
