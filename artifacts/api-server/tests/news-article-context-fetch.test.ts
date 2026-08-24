import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchPublicNewsHtmlMock } = vi.hoisted(() => ({
  fetchPublicNewsHtmlMock: vi.fn(),
}));

vi.mock("../src/lib/news-metadata", () => ({
  fetchPublicNewsHtml: fetchPublicNewsHtmlMock,
  NewsFetchError: class NewsFetchError extends Error {},
}));

import { fetchNewsArticleContext } from "../src/lib/news-article-content";

describe("news article context fetch cache", () => {
  beforeEach(() => {
    fetchPublicNewsHtmlMock.mockReset();
  });

  it("briefly reuses successful article extraction for the same URL", async () => {
    fetchPublicNewsHtmlMock.mockResolvedValue({
      html: `<article><p>${"Wolves story ".repeat(20)}</p></article>`,
      finalUrl: "https://paper.example/wolves",
    });

    const url = `https://paper.example/wolves?test=${crypto.randomUUID()}`;
    await expect(fetchNewsArticleContext(url)).resolves.toMatchObject({
      status: "analyzed",
    });
    await expect(fetchNewsArticleContext(url)).resolves.toMatchObject({
      status: "analyzed",
    });

    expect(fetchPublicNewsHtmlMock).toHaveBeenCalledTimes(1);
  });
});