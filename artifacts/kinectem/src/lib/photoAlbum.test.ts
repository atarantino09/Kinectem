import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AlbumQuotaError, writeStore } from "./photoAlbum";

describe("writeStore", () => {
  const realSetItem = Storage.prototype.setItem;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    Storage.prototype.setItem = realSetItem;
    vi.restoreAllMocks();
  });

  it("throws AlbumQuotaError when setItem raises QuotaExceededError", () => {
    Storage.prototype.setItem = vi.fn(() => {
      const err = new Error("quota");
      err.name = "QuotaExceededError";
      throw err;
    });

    expect(() => writeStore({ post1: [] })).toThrow(AlbumQuotaError);
  });

  it("rethrows non-quota errors unchanged", () => {
    const boom = new Error("disk on fire");
    Storage.prototype.setItem = vi.fn(() => {
      throw boom;
    });

    expect(() => writeStore({ post1: [] })).toThrow(boom);
  });

  it("writes and dispatches change event on success", () => {
    const spy = vi.fn();
    window.addEventListener("kinectem.album.changed", spy);
    writeStore({ post1: [] });
    expect(localStorage.getItem("kinectem.photoAlbums.v1")).toBe(
      JSON.stringify({ post1: [] }),
    );
    expect(spy).toHaveBeenCalledTimes(1);
    window.removeEventListener("kinectem.album.changed", spy);
  });
});
