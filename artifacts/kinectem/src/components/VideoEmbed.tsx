import { Video } from "lucide-react";

function getYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return u.pathname.slice(1) || null;
    if (u.hostname.endsWith("youtube.com")) {
      if (u.pathname === "/watch") return u.searchParams.get("v");
      if (u.pathname.startsWith("/embed/"))
        return u.pathname.split("/")[2] ?? null;
      if (u.pathname.startsWith("/shorts/"))
        return u.pathname.split("/")[2] ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

function getVimeoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith("vimeo.com")) return null;
    const id = u.pathname.split("/").filter(Boolean)[0];
    return /^\d+$/.test(id ?? "") ? id : null;
  } catch {
    return null;
  }
}

/**
 * Resolve a video URL to a YouTube/Vimeo embed src, or null if the
 * provider isn't supported. Exported so callers (e.g. the highlight
 * feed card) can lay out embeddable vs. fallback-link videos
 * differently — embeddable videos belong in the media slot, while
 * fallback links should render inline as a normal body element.
 */
export function getEmbedSrc(url: string): string | null {
  const ytId = getYouTubeId(url);
  if (ytId) return `https://www.youtube.com/embed/${ytId}`;
  const vimeoId = getVimeoId(url);
  if (vimeoId) return `https://player.vimeo.com/video/${vimeoId}`;
  return null;
}

export function VideoEmbed({
  url,
  className,
  fallbackClassName,
}: {
  url: string;
  /** Wrapper class for the embedded iframe variant. */
  className?: string;
  /** Wrapper class for the fallback clickable-link variant. */
  fallbackClassName?: string;
}) {
  const embedSrc = getEmbedSrc(url);

  if (embedSrc) {
    return (
      <div
        className={
          className ??
          "mt-3 rounded-lg overflow-hidden border border-border bg-black aspect-video"
        }
      >
        <iframe
          src={embedSrc}
          title="Video highlight"
          className="w-full h-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={
        fallbackClassName ??
        "mt-3 flex items-center gap-2 px-3 py-2 rounded-lg border border-border hover:bg-muted text-sm font-bold text-primary"
      }
    >
      <Video className="w-4 h-4" />
      <span className="truncate">{url}</span>
    </a>
  );
}
