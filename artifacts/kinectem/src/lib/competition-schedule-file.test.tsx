import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as XLSX from "@e965/xlsx";
import { readCompetitionScheduleFile } from "./competition-schedule-file";
import { ScheduleFilePicker } from "@/pages/CompetitionConsolePage";

function xlsxFile(rows: unknown[][], name = "fall-2026-matches.xlsx") {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Schedule");
  const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  return new File([buffer], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

describe("competition schedule file reading", () => {
  it("converts an Excel schedule to the CSV contract used by preview", async () => {
    const csv = await readCompetitionScheduleFile(
      xlsxFile([
        ["Game #", "Date", "Group", "Home Team", "Away Team", "Field"],
        [1, "2026-09-12", "U12 Boys", "North FC", "South FC", "Field 4"],
      ]),
    );

    expect(csv).toContain("Game #,Date,Group,Home Team,Away Team,Field");
    expect(csv).toContain("North FC,South FC,Field 4");
  });

  it.each(["m/d/yy", "dd/mm/yyyy", "dd-mmm-yyyy"])(
    "canonicalizes native Excel dates displayed as %s",
    async (dateFormat) => {
      const sheet = XLSX.utils.aoa_to_sheet([
        ["Match #", "Date", "Home Team", "Away Team"],
        [
          "1",
          new Date(Date.UTC(2026, 8, 12)),
          "North FC",
          "South FC",
        ],
      ]);
      sheet.B2.z = dateFormat;
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, "Schedule");
      const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });

      await expect(
        readCompetitionScheduleFile(
          new File([buffer], "localized-date.xlsx", {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          }),
        ),
      ).resolves.toContain("1,2026-09-12,North FC,South FC");
    },
  );

  it("rejects an empty workbook without invoking the importer", async () => {
    await expect(
      readCompetitionScheduleFile(xlsxFile([[]])),
    ).rejects.toThrow("Excel workbook is empty");
  });

  it("rejects oversized workbooks before parsing", async () => {
    const file = new File(
      [new Uint8Array(5 * 1024 * 1024 + 1)],
      "oversized.xlsx",
      { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    );
    await expect(readCompetitionScheduleFile(file)).rejects.toThrow(
      "under 5 MB",
    );
  });

  it("routes an Excel selection through the picker callback", async () => {
    const onCsv = vi.fn();
    const onError = vi.fn();
    render(<ScheduleFilePicker onCsv={onCsv} onError={onError} />);

    fireEvent.change(screen.getByTestId("input-csv-file"), {
      target: {
        files: [
          xlsxFile([
            ["Match #", "Date", "Division", "Home Team", "Away Team"],
            ["1", "2026-09-12", "U12", "North FC", "South FC"],
          ]),
        ],
      },
    });

    await waitFor(() => expect(onCsv).toHaveBeenCalledTimes(1));
    expect(onCsv.mock.calls[0][0]).toContain("North FC,South FC");
    expect(onError).not.toHaveBeenCalled();
    expect(screen.getByTestId("input-csv-file")).toHaveAttribute(
      "accept",
      expect.stringContaining(".xlsx"),
    );
  });

  it("clears the input and lets the same workbook be selected after an error", async () => {
    const onCsv = vi.fn();
    const onError = vi.fn();
    render(<ScheduleFilePicker onCsv={onCsv} onError={onError} />);
    const input = screen.getByTestId("input-csv-file");

    fireEvent.change(input, {
      target: { files: [xlsxFile([[]], "schedule.xlsx")] },
    });
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(input).toHaveValue("");

    fireEvent.change(input, {
      target: {
        files: [
          xlsxFile(
            [
              ["Match #", "Date", "Division", "Home Team", "Away Team"],
              ["1", "2026-09-12", "U12", "North FC", "South FC"],
            ],
            "schedule.xlsx",
          ),
        ],
      },
    });
    await waitFor(() => expect(onCsv).toHaveBeenCalledTimes(1));
  });

  it("keeps the CSV path unchanged", async () => {
    const csv =
      "Match #,Date,Division,Home Team,Away Team\n1,2026-09-12,U12,North FC,South FC";
    await expect(
      readCompetitionScheduleFile(
        new File([csv], "schedule.csv", { type: "text/csv" }),
      ),
    ).resolves.toBe(csv);
  });
});