import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AlbumPhotoResponse } from "@workspace/api-client-react";

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  createAlbumPhoto: vi.fn(),
  deleteAlbumPhoto: vi.fn(),
  requestUpload: vi.fn(),
  confirmUpload: vi.fn(),
  albumData: {
    data: [] as Array<AlbumPhotoResponse & { canDelete?: boolean }>,
    canUpload: true,
  },
}));

vi.mock("@workspace/api-client-react", async () => {
  const actual = await vi.importActual<
    typeof import("@workspace/api-client-react")
  >("@workspace/api-client-react");
  return {
    ...actual,
    useGetLoggedInUser: () => ({
      data: {
        id: "user-1",
        firstName: "Pat",
        lastName: "Parent",
        isMinor: false,
      },
    }),
    useListAlbumPhotos: () => ({
      data: mocks.albumData,
      refetch: vi.fn(),
    }),
    createAlbumPhoto: mocks.createAlbumPhoto,
    deleteAlbumPhoto: mocks.deleteAlbumPhoto,
    requestUpload: mocks.requestUpload,
    confirmUpload: mocks.confirmUpload,
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/lib/shrinkImage", () => ({
  shrinkImage: (file: File) => Promise.resolve(file),
  isUnsupportedHeicImage: () => false,
  classifyImageFile: (file: File) =>
    file.type.startsWith("image/") ? "supported" : "not-image",
}));

import {
  ALBUM_UPLOAD_MAX_BYTES,
  GamePhotoAlbum,
} from "./GamePhotoAlbum";

function item(
  overrides: Partial<AlbumPhotoResponse & { canDelete?: boolean }>,
): AlbumPhotoResponse & { canDelete?: boolean } {
  return {
    id: "media-1",
    postId: "article-post-1",
    assetId: "asset-1",
    fileType: "image/png",
    url: "data:image/png;base64,iVBORw0KGgo=",
    uploaderUserId: "user-1",
    uploaderName: "Pat Parent",
    caption: "Great play",
    createdAt: new Date().toISOString(),
    canDelete: true,
    ...overrides,
  };
}

function renderAlbum() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <GamePhotoAlbum postId="article-post-1" />
    </QueryClientProvider>,
  );
}

describe("GamePhotoAlbum mixed media", () => {
  beforeEach(() => {
    mocks.toast.mockReset();
    mocks.createAlbumPhoto.mockReset();
    mocks.deleteAlbumPhoto.mockReset();
    mocks.requestUpload.mockReset();
    mocks.confirmUpload.mockReset();
    mocks.albumData = { data: [], canUpload: true };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: vi.fn(),
      }),
    );
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:video-preview"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
  });

  it("shows phone-specific picker guidance and the per-file limit", async () => {
    renderAlbum();
    await userEvent.click(screen.getByRole("button", { name: "Add Media" }));
    expect(screen.getByText(/iPhone:/)).toBeInTheDocument();
    expect(screen.getByText(/\.MOV is okay/)).toBeInTheDocument();
    expect(screen.getByText(/Android:/)).toBeInTheDocument();
    expect(screen.getByText(/10 MB per photo or video/)).toBeInTheDocument();
    expect(screen.getByText(/trim it in your phone’s Photos\/Gallery app/)).toBeInTheDocument();
    expect(screen.getByTestId("input-album-files")).toHaveAttribute(
      "accept",
      expect.stringContaining("video/quicktime"),
    );
  });

  it("previews a mixed PNG and MOV selection without dropping the video", async () => {
    renderAlbum();
    await userEvent.click(screen.getByRole("button", { name: "Add Media" }));
    const photo = new File([new Uint8Array([137, 80, 78, 71])], "play.png", {
      type: "image/png",
    });
    const video = new File([new Uint8Array([0, 0, 0, 24])], "play.mov", {
      type: "video/quicktime",
    });
    fireEvent.change(screen.getByTestId("input-album-files"), {
      target: { files: [photo, video] },
    });
    expect(
      await screen.findByAltText("Photo preview: play.png"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Video preview: play.mov"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("button-submit-media")).toHaveTextContent(
      "Add 2 items",
    );
  });

  it("gives specific remedies for oversized and unsupported camera-roll files", async () => {
    renderAlbum();
    await userEvent.click(screen.getByRole("button", { name: "Add Media" }));
    const huge = new File(
      [new Uint8Array(ALBUM_UPLOAD_MAX_BYTES + 1)],
      "long.mov",
      { type: "video/quicktime" },
    );
    fireEvent.change(screen.getByTestId("input-album-files"), {
      target: { files: [huge] },
    });
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Video too large",
        description: expect.stringMatching(/shorter clip|trim it/),
      }),
    );

    const avi = new File([new Uint8Array([1])], "old.avi", {
      type: "video/x-msvideo",
    });
    fireEvent.change(screen.getByTestId("input-album-files"), {
      target: { files: [avi] },
    });
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "That file format isn’t supported",
        description: expect.stringMatching(/MP4\/MOV/),
      }),
    );
  });

  it("renders a distinct video tile and opens a controllable inline player", async () => {
    mocks.albumData = {
      canUpload: true,
      data: [
        item({
          id: "video-1",
          fileType: "video/mp4",
          url: "data:video/mp4;base64,AAAA",
        }),
      ],
    };
    renderAlbum();
    expect(screen.getByText("VIDEO")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: /Open video from Pat Parent/ }),
    );
    const player = screen.getByTestId("album-video-player-video-1");
    expect(player).toHaveAttribute("controls");
    expect(player).not.toHaveAttribute("autoplay");
    expect(player.querySelector("source")).toHaveAttribute("type", "video/mp4");
  });

  it("keeps photo viewing and media deletion behavior intact", async () => {
    mocks.albumData = { canUpload: true, data: [item({ id: "photo-1" })] };
    mocks.deleteAlbumPhoto.mockResolvedValue(undefined);
    renderAlbum();
    await userEvent.click(
      screen.getByRole("button", { name: /Open photo from Pat Parent/ }),
    );
    expect(screen.getAllByAltText("Great play")).toHaveLength(2);
    await userEvent.click(screen.getByTestId("button-remove-photo-photo-1"));
    await waitFor(() =>
      expect(mocks.deleteAlbumPhoto).toHaveBeenCalledWith(
        "article-post-1",
        "photo-1",
      ),
    );
  });

  it("does not show the upload control when album permissions deny it", () => {
    mocks.albumData = { data: [], canUpload: false };
    renderAlbum();
    expect(
      screen.queryByRole("button", { name: "Add Media" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/haven’t added any media yet/)).toBeInTheDocument();
  });
});