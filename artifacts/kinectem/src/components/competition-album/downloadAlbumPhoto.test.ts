import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadAlbumPhoto } from "./downloadAlbumPhoto";

const photo = { id: "photo-1", url: "/api/v1/competitions/cup/album/photos/photo-1/data", fileName: "final.png" };
const create = vi.fn(() => "blob:photo-download");
const revoke = vi.fn();

describe("authenticated competition photo file downloads", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    create.mockClear();
    revoke.mockClear();
    const OriginalURL = URL;
    vi.stubGlobal("URL", class extends OriginalURL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    });
  });
  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("fetches with credentials and saves image bytes under the photo filename", async () => {
    const blob = new Blob(["test-photo"], { type: "image/png" });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: async () => blob });
    vi.stubGlobal("fetch", fetchMock);
    let saved: { href: string; name: string } | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function(this: HTMLAnchorElement) {
      saved = { href: this.href, name: this.download };
    });
    await downloadAlbumPhoto(photo);
    expect(fetchMock).toHaveBeenCalledWith(photo.url, { credentials: "include", cache: "no-store" });
    expect(create).toHaveBeenCalledWith(blob);
    expect(saved).toEqual({ href: "blob:photo-download", name: "final.png" });
    expect(document.querySelector("a[download]")).toBeNull();
    vi.advanceTimersByTime(60_000);
    expect(revoke).toHaveBeenCalledWith("blob:photo-download");
  });

  it.each([
    [401, "Please sign in again to download photos."],
    [404, "This photo is no longer available."],
    [503, "The photo couldn’t be downloaded. Please try again."],
  ])("does not save an error response (%s) as a photo", async (status, message) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status }));
    await expect(downloadAlbumPhoto(photo)).rejects.toThrow(message);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects an HTML response rather than downloading it as an image", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, blob: async () => new Blob(["login"], { type: "text/html" }),
    }));
    await expect(downloadAlbumPhoto(photo)).rejects.toThrow("couldn’t be downloaded");
    expect(create).not.toHaveBeenCalled();
  });
});
