export type HistoricalMeta = {
  gameDate: string | null;
  year: number | null;
  newspaper: string | null;
  byline: string | null;
  publicationDate: string | null;
  rightsConfirmed: boolean;
  reviewed: boolean;
};

export const ALLOWED_CLIP_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const MAX_CLIP_BYTES = 5 * 1024 * 1024;
export const MAX_CLIP_EDGE = 8000;
export const MAX_CLIP_PIXELS = 32_000_000;

export function getHistorical(post: unknown): HistoricalMeta | null {
  const p = post as {
    historical?: HistoricalMeta | null;
    recapKind?: string | null;
  };
  if (p?.recapKind === "historical" && p.historical) return p.historical;
  return null;
}

/** Exact date wins; otherwise the year; never defaults to today. */
export function historicalDateLabel(h: HistoricalMeta): string | null {
  if (h.gameDate) {
    const [y, m, d] = h.gameDate.split("-").map(Number);
    if (y && m && d) {
      return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
        timeZone: "UTC",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    }
  }
  return h.year ? String(h.year) : null;
}

export function historicalSourceLine(h: HistoricalMeta): string | null {
  const parts = [
    h.newspaper,
    h.byline ? `By ${h.byline}` : null,
    h.publicationDate ? `Published ${h.publicationDate}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

export function historicalEditHref(post: {
  id: string;
  context: { type: string; id: string };
}): string {
  const scope =
    post.context.type === "organization"
      ? `organizationId=${encodeURIComponent(post.context.id)}`
      : `teamId=${encodeURIComponent(post.context.id)}`;
  return `/historical-recap?${scope}&postId=${encodeURIComponent(post.id)}`;
}

export type HistoricalFormState = {
  title: string;
  body: string;
  coverImageUrl: string | null;
  dateMode: "exact" | "year";
  gameDate: string;
  year: string;
  newspaper: string;
  byline: string;
  publicationDate: string;
};

export function validateHistorical(s: HistoricalFormState): string | null {
  if (!s.title.trim()) return "Add a title.";
  if (s.dateMode === "exact") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.gameDate)) return "Enter the exact game date.";
  } else {
    const y = Number(s.year);
    if (!Number.isInteger(y) || y < 1800 || y > new Date().getFullYear())
      return "Enter a valid four-digit year.";
  }
  return null;
}

export function buildPayload(
  s: HistoricalFormState,
  rightsConfirmed: boolean,
  reviewed: boolean,
) {
  const nn = (v: string) => (v.trim() ? v.trim() : null);
  return {
    title: s.title.trim(),
    body: s.body,
    coverImageUrl: s.coverImageUrl,
    historical: {
      gameDate: s.dateMode === "exact" ? nn(s.gameDate) : null,
      year: s.dateMode === "year" ? Number(s.year) || null : null,
      newspaper: nn(s.newspaper),
      byline: nn(s.byline),
      publicationDate: nn(s.publicationDate),
      rightsConfirmed,
      reviewed,
    },
  };
}

export function checkClipFile(file: { type: string; size: number }): string | null {
  if (!ALLOWED_CLIP_TYPES.includes(file.type))
    return "Use a JPEG, PNG, or WebP image. PDFs are not supported.";
  if (file.size > MAX_CLIP_BYTES) return "The image must be 5 MB or smaller.";
  return null;
}

export function checkClipDimensions(w: number, h: number): string | null {
  if (w > MAX_CLIP_EDGE || h > MAX_CLIP_EDGE)
    return "The image can be at most 8000 pixels on each side.";
  if (w * h > MAX_CLIP_PIXELS) return "The image can be at most 32 megapixels.";
  return null;
}
