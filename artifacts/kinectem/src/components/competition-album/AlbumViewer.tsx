import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { timeAgo } from "@/lib/format";
import type { AlbumCompetition, AlbumPhoto } from "@/lib/competitionAlbum";
import { PhotoBrand } from "./PhotoBrand";
import { useToast } from "@/hooks/use-toast";
import { downloadAlbumPhoto } from "./downloadAlbumPhoto";

export type ViewerPhoto = AlbumPhoto & { competition?: AlbumCompetition };

export function AlbumViewer({
  photos,
  index,
  onIndex,
  onClose,
  competition,
  onDelete,
  deleting,
}: {
  photos: ViewerPhoto[];
  index: number | null;
  onIndex: (i: number) => void;
  onClose: () => void;
  competition: AlbumCompetition;
  onDelete?: (photo: AlbumPhoto) => void;
  deleting?: boolean;
}) {
  const touchX = useRef<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const { toast } = useToast();
  const open = index !== null && !!photos[index];
  const photo = open ? photos[index as number] : null;
  const go = (d: number) => {
    if (index === null || photos.length === 0) return;
    onIndex((index + d + photos.length) % photos.length);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent
          className="!inset-0 !left-0 !top-0 !h-[100dvh] !w-screen !max-w-none !translate-x-0 !translate-y-0 !gap-0 !rounded-none !border-0 bg-slate-950/97 p-0 text-white"
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") go(-1);
            if (e.key === "ArrowRight") go(1);
          }}
          data-testid="album-viewer"
        >
          <DialogTitle className="sr-only">Competition photo</DialogTitle>
          <DialogDescription className="sr-only">
            Use the left and right arrow keys or the buttons to move between
            photos. Press Escape to close.
          </DialogDescription>
          {photo && (
            <div className="flex h-full flex-col">
              <div
                className="relative flex min-h-0 flex-1 items-center justify-center px-2 pt-12 sm:px-16"
                onTouchStart={(e) => {
                  touchX.current = e.touches[0]?.clientX ?? null;
                }}
                onTouchEnd={(e) => {
                  const start = touchX.current;
                  touchX.current = null;
                  const end = e.changedTouches[0]?.clientX;
                  if (start === null || end === undefined) return;
                  if (Math.abs(end - start) > 50) go(end < start ? 1 : -1);
                }}
              >
                <div className="relative inline-block max-h-full max-w-full">
                  <img
                    src={photo.url}
                    alt={`Photo from ${(photo.competition ?? competition).name} by ${photo.uploadedByName}`}
                    className="max-h-[calc(100dvh-9rem)] max-w-full object-contain"
                    data-testid="album-viewer-image"
                  />
                  <PhotoBrand competition={photo.competition ?? competition} size="md" />
                </div>
                {photos.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={() => go(-1)}
                      aria-label="Previous photo"
                      className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/15 p-2 hover:bg-white/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
                      data-testid="button-viewer-prev"
                    >
                      <ChevronLeft className="h-6 w-6" />
                    </button>
                    <button
                      type="button"
                      onClick={() => go(1)}
                      aria-label="Next photo"
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/15 p-2 hover:bg-white/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
                      data-testid="button-viewer-next"
                    >
                      <ChevronRight className="h-6 w-6" />
                    </button>
                  </>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0 text-sm">
                  <p className="flex flex-wrap items-center gap-2 font-bold">
                    {photo.uploadedByName}
                    {photo.status === "pending" && (
                      <Badge className="bg-amber-400 text-amber-950 hover:bg-amber-400">
                        Pending approval
                      </Badge>
                    )}
                    {photo.status === "rejected" && (
                      <Badge variant="destructive">Not approved</Badge>
                    )}
                  </p>
                  <p className="text-xs text-white/70">
                    {timeAgo(photo.createdAt)}
                    {photo.teamNames.length > 0 && ` · ${photo.teamNames.join(", ")}`}
                    {` · ${(index ?? 0) + 1} of ${photos.length}`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1 border-white/30 bg-transparent font-bold text-white hover:bg-white/10 hover:text-white"
                    disabled={downloading}
                    data-testid="button-download-album-photo"
                    onClick={async () => {
                      if (downloading) return;
                      setDownloading(true);
                      try {
                        await downloadAlbumPhoto(photo);
                      } catch (error) {
                        toast({
                          title: "Couldn’t download photo",
                          description: error instanceof Error ? error.message : "Please try again.",
                          variant: "destructive",
                        });
                      } finally {
                        setDownloading(false);
                      }
                    }}
                  >
                      <Download className="h-3.5 w-3.5" />
                      {downloading ? "Downloading…" : "Download photo"}
                  </Button>
                {photo.canDelete && onDelete && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1 border-white/30 bg-transparent font-bold text-white hover:bg-white/10 hover:text-white"
                    onClick={() => setConfirmOpen(true)}
                    data-testid={`button-delete-photo-${photo.id}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </Button>
                )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this photo permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              It will be removed from the competition album and from every team
              page it appears on. This can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep photo</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (photo && onDelete) onDelete(photo);
                setConfirmOpen(false);
              }}
              data-testid="button-confirm-delete-photo"
            >
              Delete photo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
