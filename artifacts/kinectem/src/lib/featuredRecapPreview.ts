type FeaturedRecapPreviewSource = {
  body: string | null;
  summary: string | null;
};

export function featuredRecapPreviewText(
  recap: FeaturedRecapPreviewSource,
): string | null {
  const body = recap.body?.trim();
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

  const summary = recap.summary?.trim();
  return summary || null;
}