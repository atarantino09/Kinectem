import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/renderWithProviders";
import { AlbumUploadDialog } from "./AlbumUploadDialog";

const uploadMocks = vi.hoisted(() => ({
  createBatch: vi.fn(),
  completeBatch: vi.fn(),
  invalidateAlbums: vi.fn(async () => undefined),
  newClientId: vi.fn(() => `client-id-${Math.random()}`),
  uploadOne: vi.fn(),
}));

vi.mock("@/lib/competitionAlbum", () => ({
  ALBUM_MAX_BATCH: 100,
  completeBatch: uploadMocks.completeBatch,
  createBatch: uploadMocks.createBatch,
  errText: (error: unknown) => error instanceof Error ? error.message : "Please try again.",
  invalidateAlbums: uploadMocks.invalidateAlbums,
  newClientId: uploadMocks.newClientId,
  uploadOne: uploadMocks.uploadOne,
}));

vi.mock("@/lib/shrinkImage", () => ({
  classifyImageFile: () => "supported",
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

describe("competition album upload dialog", () => {
  let restoreCreateObjectUrl: PropertyDescriptor | undefined;
  let restoreRevokeObjectUrl: PropertyDescriptor | undefined;
  let releaseUpload!: () => void;

  beforeEach(() => {
    uploadMocks.createBatch.mockReset().mockResolvedValue({ id: "batch-1" });
    uploadMocks.completeBatch.mockReset().mockResolvedValue({ submittedCount: 1 });
    uploadMocks.invalidateAlbums.mockClear();
    uploadMocks.newClientId.mockReset();
    let id = 0;
    uploadMocks.newClientId.mockImplementation(() => `client-id-${++id}`);
    uploadMocks.uploadOne.mockReset().mockImplementation(async (...args) => {
      const patch = args[5] as (updates: Record<string, unknown>) => void;
      patch({ status: "uploading" });
      await new Promise<void>((resolve) => {
        releaseUpload = resolve;
      });
      patch({
        status: "done",
        progress: 100,
        batchKey: args[2],
        uploaded: true,
      });
      return true;
    });

    restoreCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
    restoreRevokeObjectUrl = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:test-preview"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    if (restoreCreateObjectUrl) {
      Object.defineProperty(URL, "createObjectURL", restoreCreateObjectUrl);
    } else {
      delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
    }
    if (restoreRevokeObjectUrl) {
      Object.defineProperty(URL, "revokeObjectURL", restoreRevokeObjectUrl);
    } else {
      delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
    }
  });

  it("shows contributor-only pending approval copy before any files are uploaded", () => {
    renderWithProviders(
      <AlbumUploadDialog
        open
        onOpenChange={vi.fn()}
        competitionId="competition-1"
        teams={[]}
        isAdmin={false}
      />,
    );

    expect(screen.getAllByText(
      "Your photos will be pending until a competition admin approves them.",
    ).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId("text-pending-copy")).toBeVisible();
  });

  it("submits a single upload batch once and prevents duplicate completion while busy", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <AlbumUploadDialog
        open
        onOpenChange={vi.fn()}
        competitionId="competition-1"
        teams={[{ id: "team-1", name: "Riverside", canTag: true }]}
        isAdmin={false}
      />,
    );

    const file = new File(["photo"], "game.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByTestId("input-album-bulk-files"), {
      target: { files: [file] },
    });
    const start = screen.getByTestId("button-start-upload");
    await user.click(start);

    await waitFor(() => expect(uploadMocks.uploadOne).toHaveBeenCalledTimes(1));
    expect(start).toBeDisabled();
    await user.click(start);
    expect(uploadMocks.createBatch).toHaveBeenCalledTimes(1);
    expect(uploadMocks.uploadOne).toHaveBeenCalledTimes(1);
    expect(uploadMocks.completeBatch).not.toHaveBeenCalled();

    releaseUpload();
    expect(await screen.findByTestId("text-batch-complete")).toHaveTextContent(
      "1 photos submitted for approval.",
    );
    expect(uploadMocks.completeBatch).toHaveBeenCalledTimes(1);
    expect(uploadMocks.createBatch).toHaveBeenCalledTimes(1);
  });
});