import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AlbumViewer } from "./AlbumViewer";

const { download, toast } = vi.hoisted(() => ({ download: vi.fn(), toast: vi.fn() }));
vi.mock("./downloadAlbumPhoto", () => ({ downloadAlbumPhoto: download }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

const competition = {
  id: "cup", name: "City Cup", slug: "city-cup", logoUrl: null, brandColor: null,
};
const photo = {
  id: "photo-1", batchId: "batch-1",
  url: "/api/v1/competitions/cup/album/photos/photo-1/data",
  fileName: "City Cup final.jpg", status: "approved" as const,
  uploadedByName: "Coach", createdAt: new Date().toISOString(),
  teamIds: [], teamNames: [], canDelete: false,
};

describe("competition photo downloads", () => {
  beforeEach(() => {
    download.mockReset().mockResolvedValue(undefined);
    toast.mockReset();
  });

  it("downloads the photo without requiring delete or admin rights", async () => {
    render(<AlbumViewer photos={[photo]} index={0} competition={competition} onIndex={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Download photo" }));
    await waitFor(() => expect(download).toHaveBeenCalledWith(photo));
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("uses the displayed photo's download URL and filename when navigating", async () => {
    const props = { competition, onIndex: vi.fn(), onClose: vi.fn() };
    const second = { ...photo, id: "photo-2", url: "/api/v1/competitions/cup/album/photos/photo-2/data", fileName: "second.png" };
    const { rerender } = render(<AlbumViewer {...props} photos={[photo, second]} index={0} />);
    rerender(<AlbumViewer {...props} photos={[photo, second]} index={1} />);
    fireEvent.click(screen.getByRole("button", { name: "Download photo" }));
    await waitFor(() => expect(download).toHaveBeenCalledWith(second));
    rerender(<AlbumViewer {...props} photos={[photo, second]} index={null} />);
    expect(screen.queryByRole("button", { name: "Download photo" })).not.toBeInTheDocument();
  });

  it("shows a clear error if the file is unavailable", async () => {
    download.mockRejectedValue(new Error("This photo is no longer available."));
    render(<AlbumViewer photos={[photo]} index={0} competition={competition} onIndex={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Download photo" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Couldn’t download photo", description: "This photo is no longer available.", variant: "destructive",
    })));
    expect(screen.getByRole("button", { name: "Download photo" })).toBeEnabled();
  });
});
