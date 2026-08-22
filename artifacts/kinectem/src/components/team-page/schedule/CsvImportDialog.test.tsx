import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { CsvImportDialog } from "./CsvImportDialog";

const mocks = vi.hoisted(() => ({
  importSchedule: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("./scheduleApi", () => ({
  importSchedule: mocks.importSchedule,
  scheduleQueryKey: (teamId: string) => ["schedule", teamId],
  IMPORT_CSV_HEADER:
    "event_type,date,start_time,end_time,opponent,home_away,location_name,location_address,notes",
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

const CSV = [
  "event_type,date,start_time,end_time,opponent,home_away,location_name,location_address,notes",
  "game,2026-09-12,10:00,11:30,Eagles,home,Central Park Field 2,123 Park Ave,Bring water",
].join("\n");

const VALID_PREVIEW = {
  validCount: 1,
  errorCount: 0,
  rows: [
    {
      line: 2,
      eventType: "game",
      date: "2026-09-12",
      startTime: "10:00",
      endTime: "11:30",
      opponent: "Eagles",
      homeAway: "home",
      locationName: "Central Park Field 2",
      startAt: "2026-09-12T10:00:00.000Z",
      error: null,
    },
  ],
};

describe("CsvImportDialog file upload", () => {
  beforeEach(() => {
    mocks.importSchedule.mockReset();
    mocks.toast.mockReset();
  });

  it("loads the selected file, previews it, and keeps import available", async () => {
    const user = userEvent.setup();
    mocks.importSchedule.mockResolvedValueOnce(VALID_PREVIEW);
    mocks.importSchedule.mockResolvedValueOnce({ createdCount: 1, data: [] });

    renderWithProviders(
      <CsvImportDialog teamId="team-1" open onOpenChange={vi.fn()} />,
    );

    const file = new File([CSV], "schedule.csv", { type: "text/csv" });
    const fileInput = screen.getByTestId("input-csv-file");
    await user.upload(fileInput, file);

    await waitFor(() => {
      expect(mocks.importSchedule).toHaveBeenCalledWith("team-1", CSV, false);
    });
    expect(screen.getByTestId("input-csv")).toHaveValue(CSV);
    expect(await screen.findByTestId("row-import-2")).toHaveTextContent("Eagles");
    expect(screen.getByTestId("btn-csv-import")).toBeEnabled();

    await user.click(screen.getByTestId("btn-csv-import"));

    await waitFor(() => {
      expect(mocks.importSchedule).toHaveBeenLastCalledWith(
        "team-1",
        CSV,
        true,
      );
    });
  });

  it("allows the same file to be selected again after a failed preview", async () => {
    const user = userEvent.setup();
    mocks.importSchedule
      .mockRejectedValueOnce(new Error("Invalid schedule"))
      .mockResolvedValueOnce(VALID_PREVIEW);

    renderWithProviders(
      <CsvImportDialog teamId="team-1" open onOpenChange={vi.fn()} />,
    );

    const file = new File([CSV], "schedule.csv", { type: "text/csv" });
    const fileInput = screen.getByTestId("input-csv-file");
    await user.upload(fileInput, file);
    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Couldn't read that CSV" }),
      );
    });

    await user.upload(fileInput, file);

    await waitFor(() => {
      expect(mocks.importSchedule).toHaveBeenCalledTimes(2);
      expect(mocks.importSchedule).toHaveBeenLastCalledWith(
        "team-1",
        CSV,
        false,
      );
    });
    expect(screen.getByTestId("btn-csv-import")).toBeEnabled();
  });
});