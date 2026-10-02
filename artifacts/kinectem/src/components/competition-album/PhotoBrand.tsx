import { useState } from "react";
import type { AlbumCompetition } from "@/lib/competitionAlbum";

// Small corner mark: competition logo, or compact name when no logo exists.
// Legible on light and dark photos via a soft translucent chip. Display only —
// the original file is never modified.
export function PhotoBrand({
  competition,
  size = "sm",
}: {
  competition: Pick<AlbumCompetition, "name" | "logoUrl" | "brandColor">;
  size?: "sm" | "md";
}) {
  const [broken, setBroken] = useState(false);
  const showLogo = !!competition.logoUrl && !broken;
  const accent = competition.brandColor || "#1e293b";
  return (
    <span
      className={`pointer-events-none absolute bottom-1.5 right-1.5 flex max-w-[60%] items-center gap-1 rounded-md bg-white/80 px-1 py-0.5 shadow-sm ring-1 ring-black/10 backdrop-blur-sm ${
        size === "md" ? "bottom-3 right-3" : ""
      }`}
      style={{ borderBottom: `2px solid ${accent}` }}
      data-testid="photo-brand"
    >
      {showLogo ? (
        <img
          src={competition.logoUrl ?? ""}
          alt={competition.name}
          onError={() => setBroken(true)}
          className={`${size === "md" ? "h-6 sm:h-7" : "h-4 sm:h-5"} w-auto max-w-[5rem] object-contain`}
        />
      ) : (
        <span
          className={`truncate font-bold uppercase leading-none tracking-wide text-slate-800 ${
            size === "md" ? "px-1 py-0.5 text-[11px]" : "px-0.5 text-[8px] sm:text-[9px]"
          }`}
        >
          {competition.name}
        </span>
      )}
    </span>
  );
}
