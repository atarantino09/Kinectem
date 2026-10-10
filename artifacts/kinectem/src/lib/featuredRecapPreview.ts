import { MENTION_TOKEN_RE } from "./mentions";

type FeaturedRecapPreviewSource = {
  body: string | null;
  summary: string | null;
};

function namesOnly(text: string): string {
  return text
    .replace(new RegExp(MENTION_TOKEN_RE.source, "gi"), "$1")
    // Also clean plain-text mentions without removing @ inside email addresses.
    .replace(/(^|[^\p{L}\p{N}_@])@(?=\p{L})/gu, "$1");
}

export function featuredRecapPreviewText(
  recap: FeaturedRecapPreviewSource,
): string | null {
  const body = recap.body ? namesOnly(recap.body).trim() : "";
  if (body) {
    const paragraphs = body
      .split(/\n\s*\n/)
      .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
      .filter(Boolean);

    if (paragraphs.length > 1) {
      return paragraphs[1];
    }

    const sentences = body
      .replace(/\s+/g, " ")
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);
    if (sentences.length > 1) {
      return sentences.slice(1).join(" ");
    }

    return paragraphs[0] ?? body;
  }

  const summary = recap.summary ? namesOnly(recap.summary).trim() : "";
  return summary || null;
}