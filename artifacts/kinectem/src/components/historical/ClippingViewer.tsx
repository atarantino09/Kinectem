import { useState } from "react";
import { Maximize2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

/** Unfiltered, uncropped clipping with a full-size reading viewer. */
export function ClippingViewer({
  src,
  alt,
  postId,
}: {
  src: string;
  alt: string;
  postId: string;
}) {
  const [open, setOpen] = useState(false);
  const [actualSize, setActualSize] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="historical-clipping group relative block w-full rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label={`Open full-size clipping: ${alt}`}
        data-testid={`btn-open-clipping-${postId}`}
      >
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          className="mx-auto max-h-[28rem] w-full object-contain"
          data-testid={`img-clipping-${postId}`}
        />
        <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded bg-background/90 px-2 py-1 text-xs font-bold text-foreground shadow">
          <Maximize2 className="h-3 w-3" /> Full size
        </span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-h-[92dvh] max-w-5xl overflow-auto"
          data-testid={`dialog-clipping-${postId}`}
        >
          <DialogTitle>Original clipping</DialogTitle>
          <DialogDescription className="sr-only">
            Uncropped full-size view of the newspaper clipping.
          </DialogDescription>
          <button
            type="button"
            aria-pressed={actualSize}
            onClick={() => setActualSize((value) => !value)}
            className="w-fit rounded border px-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid={`btn-clipping-actual-size-${postId}`}
          >
            {actualSize ? "Fit to screen" : "Read at original size"}
          </button>
          <div className="min-w-0 overflow-auto max-h-[70dvh]" tabIndex={0} aria-label="Clipping reading area">
            <img
              src={src}
              alt={alt}
              className={actualSize ? "h-auto w-auto max-w-none object-contain" : "h-auto w-full object-contain"}
              data-testid={`img-clipping-full-${postId}`}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
