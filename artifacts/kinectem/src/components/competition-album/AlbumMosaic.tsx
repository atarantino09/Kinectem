import { PhotoBrand } from "./PhotoBrand";
import type { ViewerPhoto } from "./AlbumViewer";
import type { AlbumCompetition } from "@/lib/competitionAlbum";

// Collage: every 7th tile spans 2x2 for rhythm; dense flow fills the gaps.
export function AlbumMosaic({
  photos,
  competition,
  onOpen,
}: {
  photos: ViewerPhoto[];
  competition: AlbumCompetition;
  onOpen: (index: number) => void;
}) {
  return (
    <div className="grid grid-flow-dense grid-cols-2 gap-1.5 sm:grid-cols-3 sm:gap-2 lg:grid-cols-4">
      {photos.map((p, i) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onOpen(i)}
          className={`group relative overflow-hidden rounded-lg bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
            i % 7 === 0 ? "col-span-2 row-span-2 aspect-square" : "aspect-square"
          }`}
          aria-label={`Open photo ${i + 1} by ${p.uploadedByName}`}
          data-testid={`album-tile-${p.id}`}
        >
          <img
            src={p.url}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
          {p.status === "pending" && (
            <span className="absolute left-1.5 top-1.5 rounded bg-amber-400 px-1.5 py-0.5 text-[10px] font-black uppercase text-amber-950">
              Pending approval
            </span>
          )}
          {p.status === "rejected" && (
            <span className="absolute left-1.5 top-1.5 rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-black uppercase text-white">
              Not approved
            </span>
          )}
          <PhotoBrand competition={(p as ViewerPhoto).competition ?? competition} />
        </button>
      ))}
    </div>
  );
}
