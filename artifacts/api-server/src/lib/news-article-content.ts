import {
  fetchPublicNewsHtml,
  NewsFetchError,
} from "./news-metadata";

export const MAX_NEWS_CONTEXT_CHARS = 9_000;
export const NEWS_CONTEXT_CACHE_TTL_MS = 15 * 60 * 1_000;
const MAX_CACHED_NEWS_CONTEXTS = 100;

const articleContextCache = new Map<
  string,
  { expiresAt: number; context: Extract<NewsArticleContext, { status: "analyzed" }> }
>();

export type NewsArticleContext =
  | {
      status: "analyzed";
      text: string;
    }
  | {
      status: "metadata_fallback";
      reason:
        | "fetch_failed"
        | "blocked_host"
        | "not_html"
        | "no_article_text";
    };

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;|&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(parseInt(code, 16)),
    );
}

function removeNoise(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(
      /<(script|style|noscript|svg|template|nav|aside|footer|header|form|iframe|canvas)\b[^>]*>[\s\S]*?<\/\1>/gi,
      " ",
    );
}

function findPreferredContainer(html: string): string {
  for (const tag of ["article", "main"]) {
    const match = html.match(
      new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"),
    );
    if (match?.[1]) return match[1];
  }
  return html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
}

function textFromHtml(html: string): string {
  const blocks: string[] = [];
  const blockPattern =
    /<(h[1-6]|p|li|blockquote|pre)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  for (const match of html.matchAll(blockPattern)) {
    const text = decodeEntities(
      match[2]
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, " "),
    )
      .replace(/\s+/g, " ")
      .trim();
    if (text.length >= 25) blocks.push(text);
  }

  // Some article pages use divs instead of paragraphs. This fallback still
  // removes markup, but only runs when semantic blocks yielded no content.
  if (blocks.length === 0) {
    return decodeEntities(
      html
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, " "),
    )
      .replace(/\s+/g, " ")
      .trim();
  }
  return Array.from(new Set(blocks)).join("\n");
}

export function extractNewsArticleText(html: string): string | null {
  const cleanHtml = removeNoise(html);
  const articleText = textFromHtml(findPreferredContainer(cleanHtml));
  if (articleText.length < 120) return null;
  return articleText.slice(0, MAX_NEWS_CONTEXT_CHARS).trim();
}

export async function fetchNewsArticleContext(
  rawUrl: string,
): Promise<NewsArticleContext> {
  const now = Date.now();
  const cached = articleContextCache.get(rawUrl);
  if (cached && cached.expiresAt > now) return cached.context;
  if (cached) articleContextCache.delete(rawUrl);

  try {
    const { html } = await fetchPublicNewsHtml(rawUrl);
    const text = extractNewsArticleText(html);
    if (!text) {
      return { status: "metadata_fallback", reason: "no_article_text" };
    }
    const context = { status: "analyzed" as const, text };
    articleContextCache.set(rawUrl, {
      expiresAt: now + NEWS_CONTEXT_CACHE_TTL_MS,
      context,
    });
    if (articleContextCache.size > MAX_CACHED_NEWS_CONTEXTS) {
      const oldestKey = articleContextCache.keys().next().value;
      if (oldestKey) articleContextCache.delete(oldestKey);
    }
    return context;
  } catch (error) {
    if (error instanceof NewsFetchError) {
      const reason =
        error.code === "blocked_host"
          ? "blocked_host"
          : error.code === "not_html"
            ? "not_html"
            : "fetch_failed";
      return { status: "metadata_fallback", reason };
    }
    return { status: "metadata_fallback", reason: "fetch_failed" };
  }
}