import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  shrinkImageToDataUrl: vi.fn(),
  mutateAsync: vi.fn(),
  invalidateQueries: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

vi.mock("@workspace/api-client-react", () => ({
  useCreateOrgPost: () => ({
    mutateAsync: mocks.mutateAsync,
    isPending: false,
  }),
  getListOrgPostsQueryKey: (orgId: string) => ["org-posts", orgId],
  getListFeedQueryKey: () => ["feed"],
}));

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

vi.mock("@/components/ui/dialog", () => {
  const Wrapper = ({ children }: { children: ReactNode }) => <>{children}</>;
  return {
    Dialog: Wrapper,
    DialogContent: Wrapper,
    DialogHeader: Wrapper,
    DialogTitle: Wrapper,
    DialogDescription: Wrapper,
    DialogFooter: Wrapper,
  };
});

import { NewOrgPostDialog } from "./NewOrgPostDialog";

describe("NewOrgPostDialog photo processing", () => {
  beforeEach(() => {
    mocks.toast.mockReset();
    mocks.shrinkImageToDataUrl.mockReset();
    mocks.mutateAsync.mockReset().mockResolvedValue({});
    mocks.invalidateQueries.mockReset().mockResolvedValue(undefined);
  });

  it("compresses files over 5 MB, preserves order, and keeps successful photos", async () => {
    mocks.shrinkImageToDataUrl.mockImplementation(async (file: File) => {
      if (file.name === "unreadable.jpg") throw new Error("decode failed");
      return file.name === "first.jpg" ? "first" : "third";
    });
    render(
      <NewOrgPostDialog
        orgId="org-1"
        orgName="Kinectem"
        open
        onOpenChange={vi.fn()}
      />,
    );

    const files = [
      new File([new Uint8Array(5 * 1024 * 1024 + 1)], "first.jpg", {
        type: "image/jpeg",
      }),
      new File(["bad"], "unreadable.jpg", { type: "image/jpeg" }),
      new File(["small"], "third.jpg", { type: "image/jpeg" }),
    ];
    fireEvent.change(screen.getByTestId("input-org-post-photos"), {
      target: { files },
    });

    await waitFor(() =>
      expect(screen.getByAltText("Photo 2")).toHaveAttribute("src", "third"),
    );
    expect(mocks.shrinkImageToDataUrl).toHaveBeenCalledTimes(3);
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Couldn't read that photo",
        description: expect.stringMatching(/selecting the photo again/i),
      }),
    );
    expect(screen.getByAltText("Photo 1")).toHaveAttribute("src", "first");
  });

  it("serializes overlapping selections before enforcing the aggregate limit", async () => {
    let resolveFirst!: (value: string) => void;
    mocks.shrinkImageToDataUrl.mockImplementation((file: File) => {
      if (file.name === "first.jpg") {
        return new Promise<string>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve("s".repeat(60));
    });
    render(
      <NewOrgPostDialog
        orgId="org-1"
        orgName="Kinectem"
        open
        onOpenChange={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByTestId("input-org-post-photos"), {
      target: {
        files: [new File(["first"], "first.jpg", { type: "image/jpeg" })],
      },
    });
    fireEvent.change(screen.getByTestId("input-org-post-photos"), {
      target: {
        files: [new File(["second"], "second.jpg", { type: "image/jpeg" })],
      },
    });
    await waitFor(() =>
      expect(mocks.shrinkImageToDataUrl).toHaveBeenCalledTimes(1),
    );
    resolveFirst("f".repeat(60));

    await waitFor(() =>
      expect(screen.getByAltText("Photo 1")).toHaveAttribute(
        "src",
        "f".repeat(60),
      ),
    );
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Photo too large to add" }),
      ),
    );
    expect(screen.queryByAltText("Photo 2")).not.toBeInTheDocument();
  });
});