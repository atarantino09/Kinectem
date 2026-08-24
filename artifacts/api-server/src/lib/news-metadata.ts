// "In the News" — fetch a newspaper article's page ONCE at add time and
// extract Open Graph / meta metadata (headline, source name, preview image,
// description). The stored copy is what feeds render; we never re-fetch the
// paper on reads.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const FETCH_TIMEOUT_MS = 10_000;
export const MAX_HTML_BYTES = 1_000_000; // head + bounded article content

export class NewsFetchError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "invalid_url"
      | "blocked_host"
      | "fetch_failed"
      | "not_html"
      | "no_title",
  ) {
    super(message);
  }
}

function isPrivateIp(ip: string): boolean {
  if (ip === "::1") return true;
  const v4 = ip.replace(/^::ffff:/i, "");
  if (isIP(v4) === 4) {
    const [a, b] = v4.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  // IPv6: unique-local fc00::/7 and link-local fe80::/10
  return /^f[cd]/i.test(ip) || /^fe[89ab]/i.test(ip);
}

// SSRF guard: only public http(s) hosts. We resolve the hostname and refuse
// private/loopback ranges so a pasted "article URL" can't probe internal
// services. (DNS re-resolution between check and fetch is a theoretical
// gap, acceptable for a coach-facing paste-a-newspaper-link feature.)
async function assertPublicHttpUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new NewsFetchError("That doesn't look like a valid link.", "invalid_url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new NewsFetchError("Only http(s) links are supported.", "invalid_url");
  }
  const host = url.hostname;
  if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new NewsFetchError("That address can't be reached.", "blocked_host");
  }
  try {
    const addrs = isIP(host)
      ? [{ address: host }]
      : await lookup(host, { all: true });
    if (addrs.some((a) => isPrivateIp(a.address))) {
      throw new NewsFetchError("That address can't be reached.", "blocked_host");
    }
  } catch (err) {
    if (err instanceof NewsFetchError) throw err;
    throw new NewsFetchError("We couldn't reach that website.", "fetch_failed");
  }
  return url;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .trim();
}

// Pull <meta property|name="key" content="..."> regardless of attribute
// order. Regex-based on purpose: no HTML-parser dependency, and OG tags
// are flat single tags in <head>.
function metaContent(html: string, key: string): string | null {
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${k}["'][^>]*content=["']([^"']+)["']`,
      "i",
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${k}["']`,
      "i",
    ),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return decodeEntities(m[1]);
  }
  return null;
}

export interface NewsMetadata {
  url: string;
  title: string;
  sourceName: string | null;
  description: string | null;
  imageUrl: string | null;
}

const MAX_REDIRECTS = 5;

function discardResponseBody(response: Response): void {
  // When a publisher returns a paywall/error page or a non-HTML resource,
  // release the connection before turning it into a safe metadata fallback.
  void response.body?.cancel().catch(() => undefined);
}

export async function fetchPublicNewsHtml(rawUrl: string): Promise<{
  html: string;
  finalUrl: string;
}> {
  // Follow redirects MANUALLY so every hop's hostname is re-validated —
  // an allowed public URL must not be able to bounce the server-side
  // fetch into a private/loopback/metadata address.
  let current = await assertPublicHttpUrl(rawUrl);
  let resp: Response | null = null;
  const deadline = Date.now() + FETCH_TIMEOUT_MS;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new NewsFetchError("We couldn't reach that website.", "fetch_failed");
    }
    let r: Response;
    try {
      r = await fetch(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(remaining),
        headers: {
          // Some news CDNs serve bot-blocking pages to unknown agents; a
          // browsery UA gets the same OG tags social crawlers see.
          "User-Agent":
            "Mozilla/5.0 (compatible; KinectemBot/1.0; +https://www.kinectem.com)",
          Accept: "text/html,application/xhtml+xml",
        },
      });
    } catch {
      throw new NewsFetchError("We couldn't reach that website.", "fetch_failed");
    }
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get("location");
      discardResponseBody(r);
      if (!loc || hop === MAX_REDIRECTS) {
        throw new NewsFetchError("We couldn't reach that website.", "fetch_failed");
      }
      // Re-validate the redirect target exactly like the original URL.
      current = await assertPublicHttpUrl(new URL(loc, current).toString());
      continue;
    }
    resp = r;
    break;
  }
  if (!resp) {
    throw new NewsFetchError("We couldn't reach that website.", "fetch_failed");
  }
  if (!resp.ok) {
    discardResponseBody(resp);
    throw new NewsFetchError(
      "That page couldn't be loaded (it may be behind a paywall or removed).",
      "fetch_failed",
    );
  }
  const ctype = resp.headers.get("content-type") ?? "";
  if (!/text\/html|application\/xhtml/i.test(ctype)) {
    discardResponseBody(resp);
    throw new NewsFetchError("That link isn't a web article.", "not_html");
  }
  // Stream-read with a byte cap so a huge page can't balloon memory.
  const reader = resp.body?.getReader();
  let html = "";
  if (reader) {
    const decoder = new TextDecoder("utf-8", { fatal: false });
    let bytes = 0;
    let completed = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          completed = true;
          break;
        }
        bytes += value.byteLength;
        html += decoder.decode(value, { stream: true });
        if (bytes >= MAX_HTML_BYTES) break;
      }
    } finally {
      if (!completed) {
        void reader.cancel().catch(() => undefined);
      }
    }
  } else {
    html = (await resp.text()).slice(0, MAX_HTML_BYTES);
  }

  const finalUrl = resp.url || current.toString();
  return { html, finalUrl };
}

export async function fetchNewsMetadata(rawUrl: string): Promise<NewsMetadata> {
  const { html, finalUrl } = await fetchPublicNewsHtml(rawUrl);
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const title =
    metaContent(html, "og:title") ??
    metaContent(html, "twitter:title") ??
    (titleTag ? decodeEntities(titleTag) : null);
  if (!title) {
    throw new NewsFetchError(
      "We couldn't read a headline from that page.",
      "no_title",
    );
  }
  const sourceName =
    metaContent(html, "og:site_name") ??
    new URL(finalUrl).hostname.replace(/^www\./, "");
  const description =
    metaContent(html, "og:description") ??
    metaContent(html, "twitter:description") ??
    metaContent(html, "description");
  let imageUrl =
    metaContent(html, "og:image") ??
    metaContent(html, "og:image:url") ??
    metaContent(html, "twitter:image");
  if (imageUrl) {
    try {
      imageUrl = new URL(imageUrl, finalUrl).toString();
      if (!/^https?:$/.test(new URL(imageUrl).protocol)) imageUrl = null;
    } catch {
      imageUrl = null;
    }
  }
  return {
    url: finalUrl,
    title: title.slice(0, 300),
    sourceName: sourceName?.slice(0, 120) ?? null,
    description: description?.slice(0, 600) ?? null,
    imageUrl,
  };
}
