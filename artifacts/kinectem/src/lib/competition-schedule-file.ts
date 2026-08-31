import type { WorkBook, WorkSheet } from "@e965/xlsx";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MAX_SCHEDULE_FILE_BYTES = 10 * 1024 * 1024;

function isXlsxFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(".xlsx") || file.type === XLSX_MIME;
}

function readAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === "function") {
    return file.arrayBuffer();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Couldn't read the file."));
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
      } else {
        reject(new Error("Couldn't read the Excel workbook."));
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

function readAsText(file: File): Promise<string> {
  if (typeof file.text === "function") {
    return file.text();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Couldn't read the file."));
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Couldn't read the CSV file."));
      }
    };
    reader.readAsText(file);
  });
}

function isoDate(value: unknown): string | null {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function canonicalizeExcelDates(sheet: WorkSheet) {
  for (const address of Object.keys(sheet)) {
    if (address.startsWith("!")) continue;
    const cell = sheet[address];
    if (cell?.t !== "d") continue;
    const formatted = isoDate(cell.v);
    if (formatted) cell.w = formatted;
  }
}

async function workbookToCsv(buffer: ArrayBuffer): Promise<string> {
  const XLSX = await import("@e965/xlsx");
  let workbook: WorkBook;
  try {
    workbook = XLSX.read(buffer, {
      type: "array",
      cellDates: true,
      cellNF: true,
    });
  } catch {
    throw new Error("That Excel workbook couldn't be opened.");
  }

  const sheetName = workbook.SheetNames.find((name) => {
    const sheet = workbook.Sheets[name];
    if (!sheet) return false;
    canonicalizeExcelDates(sheet);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      blankrows: false,
      defval: "",
    });
    return rows.some((row) =>
      row.some((cell) => String(cell ?? "").trim() !== ""),
    );
  });
  if (!sheetName) {
    throw new Error("That Excel workbook is empty.");
  }

  const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName], {
    blankrows: false,
    dateNF: "yyyy-mm-dd",
  });
  if (!csv.trim()) {
    throw new Error("That Excel workbook is empty.");
  }
  return csv;
}

export async function readCompetitionScheduleFile(file: File): Promise<string> {
  if (isXlsxFile(file)) {
    if (file.size > MAX_SCHEDULE_FILE_BYTES) {
      throw new Error("That Excel workbook is too large. Choose one under 10 MB.");
    }
    return workbookToCsv(await readAsArrayBuffer(file));
  }
  if (file.name.toLowerCase().endsWith(".csv") || file.type === "text/csv") {
    if (file.size > MAX_SCHEDULE_FILE_BYTES) {
      throw new Error("That CSV file is too large. Choose one under 10 MB.");
    }
    return readAsText(file);
  }
  throw new Error("Choose a CSV or Excel (.xlsx) schedule file.");
}