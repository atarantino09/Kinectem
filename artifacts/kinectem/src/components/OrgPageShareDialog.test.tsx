import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "@/test";
import { toastSpy, useToastMock } from "@/test/mocks/toast";
import {
  buildOrganizationPageUrl,
  buildOrganizationShareMessage,
  OrgPageShareDialog,
} from "./OrgPageShareDialog";

vi.mock("@/hooks/use-toast", () => useToastMock);

const onOpenChange = vi.fn();

function renderDialog() {
  return renderWithProviders(
    <OrgPageShareDialog
      orgId="org-1"
      organizationName="Westfield Athletic Club"
      open
      onOpenChange={onOpenChange}
    />,
  );
}

beforeEach(() => {
  onOpenChange.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("OrgPageShareDialog", () => {
  it("builds a path-prefixed organization URL and personalized message", () => {
    const pageUrl = buildOrganizationPageUrl("org-1");
    expect(pageUrl).toMatch(/\/organizations\/org-1$/);
    expect(
      buildOrganizationShareMessage("Westfield Athletic Club", pageUrl),
    ).toContain("Follow Westfield Athletic Club on Kinectem");
  });

  it("copies the prepared message and organization link", async () => {
    const user = userEvent.setup();
    const clipboardWriteText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
    renderDialog();

    const message = (screen.getByTestId("text-org-share-message") as HTMLTextAreaElement)
      .value;
    const link = (screen.getByTestId("input-org-share-link") as HTMLInputElement).value;

    await user.click(screen.getByTestId("btn-copy-org-share-message"));
    await waitFor(() =>
      expect(clipboardWriteText).toHaveBeenCalledWith(message),
    );
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Message copied" }),
    );

    await user.click(screen.getByTestId("btn-copy-org-share-link"));
    await waitFor(() =>
      expect(clipboardWriteText).toHaveBeenLastCalledWith(link),
    );
  });

  it("explains how to recover when copying is blocked", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
      new Error("Permission denied"),
    );
    renderDialog();

    await user.click(screen.getByTestId("btn-copy-org-share-message"));

    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Couldn't copy",
          variant: "destructive",
        }),
      ),
    );
    expect(
      screen.getByTestId("btn-copy-org-share-message"),
    ).toHaveTextContent("Copy message & link");
  });

  it("opens Facebook with an encoded organization page URL", async () => {
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    renderDialog();

    const link = (screen.getByTestId("input-org-share-link") as HTMLInputElement).value;
    await user.click(screen.getByTestId("btn-facebook-share-org-page"));

    expect(openSpy).toHaveBeenCalledWith(
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`,
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("keeps copy controls and Instagram guidance available without native sharing", () => {
    renderDialog();

    expect(screen.getByTestId("btn-copy-org-share-message")).toBeInTheDocument();
    expect(screen.getByTestId("btn-copy-org-share-link")).toBeInTheDocument();
    expect(screen.getByTestId("org-share-instagram-note")).toHaveTextContent(
      "does not support pre-filled web posts",
    );
    expect(
      screen.queryByTestId("btn-native-share-org-page"),
    ).not.toBeInTheDocument();
  });

  it("uses the native share sheet when the browser supports it", async () => {
    const user = userEvent.setup();
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", {
      value: share,
      configurable: true,
    });
    renderDialog();

    await user.click(screen.getByTestId("btn-native-share-org-page"));

    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Follow Westfield Athletic Club on Kinectem",
        url: expect.stringMatching(/\/organizations\/org-1$/),
      }),
    );
  });
});