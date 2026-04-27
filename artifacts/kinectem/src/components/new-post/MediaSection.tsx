import { useRef } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ImagePlus, Video, X } from "lucide-react";
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
          <div className="grid grid-cols-3 gap-2">
            {photos.map((src, i) => (
              <div
                key={i}
                className="relative rounded-lg overflow-hidden border border-border aspect-square bg-muted"
              >
                <img
                  src={src}
                  alt={`Photo ${i + 1}`}
                  className="w-full h-full object-cover"
                />
                {i === 0 && (
                  <span className="absolute top-1 left-1 bg-primary text-primary-foreground text-[10px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded">
                    Cover
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => removeAt(i)}
                  className="absolute top-1 right-1 bg-black/60 hover:bg-black/80 text-white rounded-full p-1"
                  data-testid={`button-remove-photo-${i}`}
                  aria-label="Remove photo"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
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
