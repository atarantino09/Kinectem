import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  Video,
  X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  shrinkImageToDataUrl,
  IMAGE_UPLOAD_MAX_BYTES,
} from "@/lib/shrinkImage";

export function MediaSection({
  photos,
  onPhotosChange,
  videoUrl,
  onVideoUrlChange,
}: {
  photos: string[];
  onPhotosChange: (next: string[]) => void;
  videoUrl: string;
  onVideoUrlChange: (next: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { toast } = useToast();
  // Index currently being dragged. Tracked in state so the source tile
  // can show a faded "lifted" appearance while it's en route. Touch
  // devices fall back to the move-left / move-right buttons below.
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const accepted: File[] = [];
    let rejectedTooLarge = 0;
    for (const f of Array.from(files)) {
      if (!f.type.startsWith("image/")) continue;
      if (f.size > IMAGE_UPLOAD_MAX_BYTES) {
        rejectedTooLarge += 1;
        continue;
      }
      accepted.push(f);
    }
    if (rejectedTooLarge > 0) {
      toast({
        title:
          rejectedTooLarge === 1
            ? "Photo too large"
            : `${rejectedTooLarge} photos too large`,
        description: "Images must be under 5 MB.",
        variant: "destructive",
      });
    }
    if (accepted.length === 0) return;
    try {
      const next = await Promise.all(accepted.map(shrinkImageToDataUrl));
      onPhotosChange([...photos, ...next]);
    } catch {
      toast({ title: "Couldn't read those photos", variant: "destructive" });
    }
  };

  const removeAt = (idx: number) => {
    onPhotosChange(photos.filter((_, i) => i !== idx));
  };

  // Move the photo at `from` to position `to`. Used by both the
  // arrow-button fallback and the HTML5 drag-and-drop drop handler.
  // No-ops when the move would leave the array unchanged so we don't
  // trigger needless auto-save round-trips.
  const moveTo = (from: number, to: number) => {
    if (from === to) return;
    if (from < 0 || from >= photos.length) return;
    const clamped = Math.max(0, Math.min(photos.length - 1, to));
    if (clamped === from) return;
    const next = photos.slice();
    const [picked] = next.splice(from, 1);
    next.splice(clamped, 0, picked);
    onPhotosChange(next);
  };

  return (
    <div className="space-y-4 pt-2 border-t border-border">
      <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">
        Media
      </Label>

      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-bold flex items-center gap-1.5">
            <ImagePlus className="w-4 h-4" /> Photos
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="font-bold rounded-full"
            onClick={() => inputRef.current?.click()}
            data-testid="button-add-photos"
          >
            <ImagePlus className="w-3.5 h-3.5 mr-1.5" /> Add Photos
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              onFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
        {photos.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">
            No photos yet. The first photo becomes the cover image.
          </p>
        ) : (
          <>
            <p
              className="text-[11px] text-muted-foreground font-medium mb-2"
              id="photos-help"
            >
              Drag a photo to reorder, or use the arrow buttons. The first
              photo is the cover.
            </p>
            <div
              className="grid grid-cols-3 gap-2"
              data-testid="photo-grid"
              aria-describedby="photos-help"
            >
              {photos.map((src, i) => {
                const isDragging = dragIndex === i;
                return (
                  <div
                    key={`${i}-${src.slice(0, 24)}`}
                    className={`relative rounded-lg overflow-hidden border border-border aspect-square bg-muted ${
                      isDragging ? "opacity-40" : ""
                    }`}
                    draggable
                    onDragStart={(e) => {
                      setDragIndex(i);
                      e.dataTransfer.effectAllowed = "move";
                      // Some browsers require setData to actually start
                      // a drag; the value itself is unused.
                      e.dataTransfer.setData("text/plain", String(i));
                    }}
                    onDragOver={(e) => {
                      if (dragIndex === null || dragIndex === i) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragIndex === null) return;
                      moveTo(dragIndex, i);
                      setDragIndex(null);
                    }}
                    onDragEnd={() => setDragIndex(null)}
                    data-testid={`photo-tile-${i}`}
                  >
                    <img
                      src={src}
                      alt={`Photo ${i + 1}`}
                      className="w-full h-full object-cover pointer-events-none"
                      draggable={false}
                    />
                    {i === 0 && (
                      <span className="absolute top-1 left-1 bg-primary text-primary-foreground text-[10px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded shadow-sm">
                        Cover
                      </span>
                    )}
                    {/* Remove (X) — sized so it stays comfortably tappable
                        on touch devices and visible against any cover
                        photo. The contrasting ring keeps it from blending
                        into bright backgrounds. */}
                    <button
                      type="button"
                      onClick={() => removeAt(i)}
                      className="absolute top-1 right-1 bg-black/70 hover:bg-black/90 text-white rounded-full h-7 w-7 flex items-center justify-center ring-2 ring-white/80 shadow-sm"
                      data-testid={`button-remove-photo-${i}`}
                      aria-label={`Remove photo ${i + 1}`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                    {/* Touch / a11y fallback for reordering. Always
                        rendered (even for single-photo grids) so the
                        layout is stable; the buttons gray out when
                        they can't move further. */}
                    <div className="absolute bottom-1 inset-x-1 flex items-center justify-between gap-1">
                      <button
                        type="button"
                        onClick={() => moveTo(i, i - 1)}
                        disabled={i === 0}
                        aria-label={`Move photo ${i + 1} earlier`}
                        className="bg-black/70 hover:bg-black/90 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-full h-6 w-6 flex items-center justify-center"
                        data-testid={`button-move-photo-left-${i}`}
                      >
                        <ChevronLeft className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveTo(i, i + 1)}
                        disabled={i === photos.length - 1}
                        aria-label={`Move photo ${i + 1} later`}
                        className="bg-black/70 hover:bg-black/90 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-full h-6 w-6 flex items-center justify-center"
                        data-testid={`button-move-photo-right-${i}`}
                      >
                        <ChevronRight className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      <div>
        <Label
          htmlFor="videoUrl"
          className="text-sm font-bold flex items-center gap-1.5"
        >
          <Video className="w-4 h-4" /> Video Highlight Link
        </Label>
        <Input
          id="videoUrl"
          value={videoUrl}
          onChange={(e) => onVideoUrlChange(e.target.value)}
          placeholder="Paste a YouTube, Vimeo, or other video link"
          className="mt-2"
          data-testid="input-video-url"
        />
      </div>
    </div>
  );
}
