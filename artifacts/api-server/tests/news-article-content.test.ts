import { describe, expect, it } from "vitest";
import {
  extractNewsArticleText,
  fetchNewsArticleContext,
  MAX_NEWS_CONTEXT_CHARS,
} from "../src/lib/news-article-content";

describe("news article context extraction", () => {
  it("keeps readable article paragraphs and removes page chrome", () => {
    const html = `
      <html><body>
        <nav>Subscribe now and visit the home page</nav>
        <article>
          <h1>Wolves rally in the fourth quarter</h1>
          <p>The Wolves found their rhythm after halftime and kept their focus.</p>
          <p>Coaches praised the group for their teamwork and composure.</p>
          <footer>Share this story everywhere</footer>
        </article>
      </body></html>
    `;

    const text = extractNewsArticleText(html);
    expect(text).toContain("Wolves rally in the fourth quarter");
    expect(text).toContain("Coaches praised the group");
    expect(text).not.toContain("Subscribe now");
    expect(text).not.toContain("Share this story");
  });

  it("caps article text before it reaches the AI prompt", () => {
    const html = `<article>${Array.from(
      { length: 200 },
      (_, index) =>
        `<p>Paragraph ${index}: ${"A detailed game report. ".repeat(30)}</p>`,
    ).join("")}</article>`;

    expect(extractNewsArticleText(html)).toHaveLength(MAX_NEWS_CONTEXT_CHARS);
  });

  it("uses metadata fallback rather than touching private addresses", async () => {
    await expect(
      fetchNewsArticleContext("http://127.0.0.1/internal-story"),
    ).resolves.toEqual({
      status: "metadata_fallback",
      reason: "blocked_host",
    });
  });
});