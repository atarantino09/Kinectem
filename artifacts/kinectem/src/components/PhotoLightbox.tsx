import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";

type PhotoLightboxProps = {
  images: string[];
  startIndex: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  testIdPrefix?: string;
};

export function PhotoLightbox({
  images,
  startIndex,
  open,
  onOpenChange,
  testIdPrefix,
}: PhotoLightboxProps) {
  const safeStart =
    images.length === 0
      ? 0
      : Math.min(Math.max(startIndex, 0), images.length - 1);
  const [index, setIndex] = useState(safeStart);

  useEffect(() => {
    if (open) setIndex(safeStart);
  }, [open, safeStart]);

  const hasMultiple = images.length > 1;

  const goPrev = useCallback(() => {
    if (!hasMultiple) return;
    setIndex((i) => (i - 1 + images.length) % images.length);
  }, [hasMultiple, images.length]);

  const goNext = useCallback(() => {
    if (!hasMultiple) return;
    setIndex((i) => (i + 1) % images.length);
  }, [hasMultiple, images.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, goPrev, goNext]);

  if (images.length === 0) return null;
  const current = images[index];
  const prefix = testIdPrefix ?? "photo-lightbox";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-5xl p-0 bg-transparent border-none shadow-none"
        data-testid={`${prefix}-dialog`}
        aria-describedby={undefined}
        onClick={(e) => {
          if (e.target === e.currentTarget) onOpenChange(false);
        }}
      >
        <DialogTitle className="sr-only">
          Photo {index + 1} of {images.length}
        </DialogTitle>
        <div className="relative flex items-center justify-center">
          <img
            src={current}
            alt={`Photo ${index + 1} of ${images.length}`}
            className="max-w-full max-h-[85vh] w-auto h-auto object-contain rounded-lg"
            data-testid={`${prefix}-image`}
            onClick={(e) => e.stopPropagation()}
          />

          {hasMultiple && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  goPrev();
                }}
                aria-label="Previous photo"
                data-testid={`${prefix}-prev`}
                className="absolute left-2 top-1/2 -translate-y-1/2 z-10 rounded-full bg-black/60 hover:bg-black/80 p-2 text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  goNext();
                }}
                aria-label="Next photo"
                data-testid={`${prefix}-next`}
                className="absolute right-2 top-1/2 -translate-y-1/2 z-10 rounded-full bg-black/60 hover:bg-black/80 p-2 text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </>
          )}

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenChange(false);
            }}
            aria-label="Close"
            data-testid={`${prefix}-close`}
            className="absolute top-2 right-2 z-20 rounded-full bg-black/60 hover:bg-black/80 p-1.5 text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <X className="w-4 h-4" />
          </button>

          {hasMultiple && (
            <div
              className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs font-bold text-white"
              data-testid={`${prefix}-counter`}
            >
              {index + 1} / {images.length}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
