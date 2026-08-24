import { beforeEach, describe, expect, it, vi } from "vitest";

const { lookupMock, fetchMock } = vi.hoisted(() => ({
  lookupMock: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock("node:dns/promises", () => ({
  lookup: lookupMock,
}));

import { fetchPublicNewsHtml, NewsFetchError } from "../src/lib/news-metadata";

describe("public news HTML fetch cleanup", () => {
  beforeEach(() => {
    lookupMock.mockReset();
    fetchMock.mockReset();
    lookupMock.mockResolvedValue([{ address: "93.184.216.34" }]);
    vi.stubGlobal("fetch", fetchMock);
  });

  it.each([
    ["an error response", 403, "text/html", "fetch_failed"],
    ["a non-HTML response", 200, "application/pdf", "not_html"],
  ])("cancels the body for %s", async (_, status, contentType, errorCode) => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    fetchMock.mockResolvedValue({
      status,
      ok: status >= 200 && status < 300,
      headers: new Headers({ "content-type": contentType }),
      body: { cancel },
      url: "https://paper.example/story",
    });

    await expect(
      fetchPublicNewsHtml("https://paper.example/story"),
    ).rejects.toMatchObject<Partial<NewsFetchError>>({ code: errorCode });
    await Promise.resolve();
    expect(cancel).toHaveBeenCalledOnce();
  });
});