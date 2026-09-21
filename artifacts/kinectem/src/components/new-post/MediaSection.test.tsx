import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  requestUpload: vi.fn(),
  confirmUpload: vi.fn(),
  shrinkImageToDataUrl: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@workspace/api-client-react", async () => {
  const actual = await vi.importActual<
    typeof import("@workspace/api-client-react")
  >("@workspace/api-client-react");
  return {
    ...actual,
    requestUpload: mocks.requestUpload,
    confirmUpload: mocks.confirmUpload,
  };
});

vi.mock("@/lib/shrinkImage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/shrinkImage")>(
    "@/lib/shrinkImage",
  );
  return {
    ...actual,
    DATA_URL_MAX_LENGTH: 60,
    POST_IMAGES_TOTAL_MAX_LENGTH: 100,
    shrinkImageToDataUrl: mocks.shrinkImageToDataUrl,
  };
});

import {
  HIGHLIGHT_VIDEO_MAX_BYTES,
  MediaSection,
} from "./MediaSection";
import {
  IMAGE_UPLOAD_MAX_BYTES,
  UnsupportedImageFormatError,
} from "@/lib/shrinkImage";

function renderHighlight(
  overrides: Partial<React.ComponentProps<typeof MediaSection>> = {},
) {
  return render(
    <MediaSection
      photos={[]}
      onPhotosChange={vi.fn()}
      videoUrl=""
      onVideoUrlChange={vi.fn()}
      isHighlight
      videoAssetId=""
      onVideoAssetIdChange={vi.fn()}
      {...overrides}
    />,
  );
}

function renderPhotos(
  overrides: Partial<React.ComponentProps<typeof MediaSection>> = {},
) {
  return render(
    <MediaSection
      photos={[]}
      onPhotosChange={vi.fn()}
      videoUrl=""
      onVideoUrlChange={vi.fn()}
      {...overrides}
    />,
  );
}

describe("MediaSection phone photo processing", () => {
  beforeEach(() => {
    mocks.toast.mockReset();
    mocks.shrinkImageToDataUrl.mockReset();
    mocks.shrinkImageToDataUrl.mockResolvedValue(
      "data:image/jpeg;base64,compressed",
    );
  });

  it("compresses and attaches a phone photo larger than 5 MB", async () => {
    const onPhotosChange = vi.fn();
    renderPhotos({ onPhotosChange });
    const photo = new File(
      [new Uint8Array(IMAGE_UPLOAD_MAX_BYTES + 1)],
      "game-day.jpg",
      { type: "image/jpeg" },
    );

    fireEvent.change(screen.getByTestId("input-post-photos"), {
      target: { files: [photo] },
    });

    await waitFor(() =>
      expect(onPhotosChange).toHaveBeenCalledWith([
        "data:image/jpeg;base64,compressed",
      ]),
    );
    expect(mocks.shrinkImageToDataUrl).toHaveBeenCalledWith(photo);
    expect(mocks.toast).not.toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringMatching(/under 5 MB/i),
      }),
    );
  });

  it("shows format guidance for an unsupported iPhone photo", async () => {
    renderPhotos();
    mocks.shrinkImageToDataUrl.mockRejectedValue(
      new UnsupportedImageFormatError(),
    );
    const photo = new File(["heic"], "game-day.heic", {
      type: "image/heic",
    });

    fireEvent.change(screen.getByTestId("input-post-photos"), {
      target: { files: [photo] },
    });

    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringMatching(/format isn't supported/i),
          description: expect.stringMatching(/HEIC.*JPG/i),
        }),
      ),
    );
  });

  it("keeps the combined post-photo limit after compression", async () => {
    const onPhotosChange = vi.fn();
    renderPhotos({
      photos: ["x".repeat(90)],
      onPhotosChange,
    });
    mocks.shrinkImageToDataUrl.mockResolvedValue("y".repeat(20));
    const photo = new File(["photo"], "extra.jpg", { type: "image/jpeg" });

    fireEvent.change(screen.getByTestId("input-post-photos"), {
      target: { files: [photo] },
    });

    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Photo too large to add",
          description: expect.stringMatching(/this post/i),
        }),
      ),
    );
    expect(onPhotosChange).not.toHaveBeenCalled();
  });
});

describe("MediaSection highlight video upload", () => {
  beforeEach(() => {
    mocks.toast.mockReset();
    mocks.requestUpload.mockReset();
    mocks.confirmUpload.mockReset();
    mocks.requestUpload.mockResolvedValue({
      assetId: "asset-video-1",
      uploadUrl: "/api/v1/assets/asset-video-1/data",
      uploadHeaders: { "Content-Type": "video/quicktime" },
      expiresIn: 3600,
    });
    mocks.confirmUpload.mockResolvedValue({ id: "asset-video-1" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 204 }),
    );
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:highlight-preview"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
  });

  it("uploads and previews a MOV selected from a phone", async () => {
    const onVideoAssetIdChange = vi.fn();
    const onVideoUrlChange = vi.fn();
    renderHighlight({ onVideoAssetIdChange, onVideoUrlChange });

    expect(screen.queryByText("Photos")).not.toBeInTheDocument();
    expect(screen.getByTestId("input-highlight-video")).toHaveAttribute(
      "accept",
      "video/mp4,video/quicktime",
    );

    const video = new File([new Uint8Array([0, 0, 0, 24])], "save.mov", {
      type: "video/quicktime",
    });
    fireEvent.change(screen.getByTestId("input-highlight-video"), {
      target: { files: [video] },
    });

    await waitFor(() =>
      expect(onVideoAssetIdChange).toHaveBeenCalledWith("asset-video-1"),
    );
    expect(mocks.requestUpload).toHaveBeenCalledWith({
      fileName: "save.mov",
      fileType: "video/quicktime",
      fileSize: 4,
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/assets/asset-video-1/data",
      expect.objectContaining({
        method: "PUT",
        credentials: "include",
        body: video,
      }),
    );
    expect(mocks.confirmUpload).toHaveBeenCalledWith("asset-video-1");
    expect(onVideoUrlChange).toHaveBeenCalledWith("");
    expect(
      screen.getByLabelText("Video preview: save.mov"),
    ).toBeInTheDocument();
  });

  it("rejects an oversized phone video with trimming guidance", () => {
    renderHighlight();
    const video = new File(
      [new Uint8Array(HIGHLIGHT_VIDEO_MAX_BYTES + 1)],
      "long.mp4",
      { type: "video/mp4" },
    );
    fireEvent.change(screen.getByTestId("input-highlight-video"), {
      target: { files: [video] },
    });

    expect(mocks.requestUpload).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Video too large",
        description: expect.stringMatching(/trim it/i),
      }),
    );
  });
});