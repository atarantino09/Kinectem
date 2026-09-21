import { useEffect, useRef, useState } from "react";
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
  DATA_URL_MAX_LENGTH,
  POST_IMAGES_TOTAL_MAX_LENGTH,
  UnsupportedImageFormatError,
  shrinkImageToDataUrl,
} from "@/lib/shrinkImage";
import { VideoEmbed, getEmbedSrc } from "@/components/VideoEmbed";
import {
  confirmUpload,
  requestUpload,
} from "@workspace/api-client-react";

export const HIGHLIGHT_VIDEO_MAX_BYTES = 10 * 1024 * 1024;
const HIGHLIGHT_VIDEO_ACCEPT = "video/mp4,video/quicktime";
const HIGHLIGHT_VIDEO_TYPES = new Set(["video/mp4", "video/quicktime"]);

function uploadErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const data = (error as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  return typeof (data as { code?: unknown }).code === "string"
    ? String((data as { code: string }).code)
    : null;
}

export function MediaSection({
  photos,
  onPhotosChange,
  videoUrl,
  onVideoUrlChange,
  isHighlight = false,
  videoAssetId,
  onVideoAssetIdChange,
  allowVideoUpload = false,
}: {
  photos: string[];
  onPhotosChange: (next: string[]) => void;
  videoUrl: string;
  onVideoUrlChange: (next: string) => void;
  isHighlight?: boolean;
  videoAssetId?: string;
  onVideoAssetIdChange?: (next: string) => void;
  allowVideoUpload?: boolean;
}) {
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const photosRef = useRef(photos);
  const lastEmittedPhotosRef = useRef<string[] | null>(null);
  const photoSelectionQueueRef = useRef(Promise.resolve());
  if (photos !== lastEmittedPhotosRef.current) photosRef.current = photos;
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const { toast } = useToast();
  // Index currently being dragged. Tracked in state so the source tile
  // can show a faded "lifted" appearance while it's en route. Touch
  // devices fall back to the move-left / move-right buttons below.
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [videoPreview, setVideoPreview] = useState("");
  const [videoName, setVideoName] = useState("");
  const [uploadingVideo, setUploadingVideo] = useState(false);

  useEffect(
    () => () => {
      if (videoPreview) URL.revokeObjectURL(videoPreview);
    },
    [videoPreview],
  );

  const onHighlightVideo = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const type = file.type.split(";")[0].trim().toLowerCase();
    if (!HIGHLIGHT_VIDEO_TYPES.has(type)) {
      toast({
        title: "That video format isn’t supported",
        description: "Choose an MP4 or MOV video from your phone.",
        variant: "destructive",
      });
      return;
    }
    if (file.size > HIGHLIGHT_VIDEO_MAX_BYTES) {
      toast({
        title: "Video too large",
        description:
          "Videos must be under 10 MB. Choose a shorter clip or trim it in your phone’s Photos/Gallery app.",
        variant: "destructive",
      });
      return;
    }

    setUploadingVideo(true);
    try {
      const upload = await requestUpload({
        fileName: file.name || "highlight-video",
        fileType: type,
        fileSize: file.size,
      });
      const putResp = await fetch(upload.uploadUrl, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": type },
        body: file,
      });
      if (!putResp.ok) {
        let data: unknown = null;
        try {
          data = await putResp.json();
        } catch {
          // The status is enough for the generic connection guidance below.
        }
        throw Object.assign(new Error(`Upload failed (${putResp.status})`), {
          data,
        });
      }
      await confirmUpload(upload.assetId);
      if (videoPreview) URL.revokeObjectURL(videoPreview);
      setVideoPreview(URL.createObjectURL(file));
      setVideoName(file.name);
      onVideoAssetIdChange?.(upload.assetId);
      onVideoUrlChange("");
    } catch (error) {
      const minorBlocked = uploadErrorCode(error) === "MINOR_BLOCKED";
      toast({
        title: minorBlocked
          ? "Video uploads aren’t available for this account"
          : "Couldn’t upload that video",
        description: minorBlocked
          ? "Under-13 accounts can only upload JPEG or PNG photos."
          : "Check your connection and try again.",
        variant: "destructive",
      });
    } finally {
      setUploadingVideo(false);
    }
  };

  const removeHighlightVideo = () => {
    if (videoPreview) URL.revokeObjectURL(videoPreview);
    setVideoPreview("");
    setVideoName("");
    onVideoAssetIdChange?.("");
  };

  const onFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    photoSelectionQueueRef.current = photoSelectionQueueRef.current.then(
      async () => {

    // Phone cameras commonly produce photos larger than 5 MB. Process those
    // originals before enforcing the encoded post limits; rejecting the raw
    // camera file here prevents the existing downscaler from doing its job.
    // Some mobile pickers omit MIME type, so recognize common image extensions
    // as well.
    const selected = Array.from(files).filter(
      (file) =>
        file.type.startsWith("image/") ||
        /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(file.name),
    );
    if (selected.length === 0) {
      toast({
        title: "Choose an image file",
        description: "Select a JPG, PNG, WebP, or GIF photo.",
        variant: "destructive",
      });
      return;
    }

    const processed = await Promise.all(
      selected.map(async (file) => {
        try {
          return {
            status: "ready" as const,
            dataUrl: await shrinkImageToDataUrl(file),
          };
        } catch (error) {
          return { status: "failed" as const, error };
        }
      }),
    );

    // Task #692 — the whole recap (all photos) is sent inline in one JSON
    // body. Keep both each encoded image and the combined set within the
    // server's limits after compression.
    let running = photosRef.current.reduce((sum, photo) => sum + photo.length, 0);
    const fits: string[] = [];
    let rejectedForSpace = 0;
    let unsupported = 0;
    let unreadable = 0;
    for (const result of processed) {
      if (result.status === "failed") {
        if (
          result.error instanceof UnsupportedImageFormatError ||
          (result.error as { name?: unknown } | null)?.name ===
            "UnsupportedImageFormatError"
        ) {
          unsupported += 1;
        } else {
          unreadable += 1;
        }
        continue;
      }
      if (
        result.dataUrl.length > DATA_URL_MAX_LENGTH ||
        running + result.dataUrl.length > POST_IMAGES_TOTAL_MAX_LENGTH
      ) {
        rejectedForSpace += 1;
        continue;
      }
      running += result.dataUrl.length;
      fits.push(result.dataUrl);
    }

    if (fits.length > 0) {
      const next = [...photosRef.current, ...fits];
      photosRef.current = next;
      lastEmittedPhotosRef.current = next;
      onPhotosChange(next);
    }
    if (unsupported > 0) {
      toast({
        title:
          unsupported === 1
            ? "That photo format isn't supported"
            : `${unsupported} photo formats aren't supported`,
        description:
          "Choose a JPG, PNG, WebP, or GIF. For an iPhone HEIC photo, export or share it as JPG first.",
        variant: "destructive",
      });
    }
    if (unreadable > 0) {
      toast({
        title:
          unreadable === 1
            ? "Couldn't read that photo"
            : `Couldn't read ${unreadable} photos`,
        description: "Try selecting the photo again or choose a different one.",
        variant: "destructive",
      });
    }
    if (rejectedForSpace > 0) {
      toast({
        title:
          rejectedForSpace === 1
            ? "Photo too large to add"
            : `${rejectedForSpace} photos too large to add`,
        description:
          "Kinectem couldn't make these photos small enough for this post. Remove some photos or choose smaller ones.",
        variant: "destructive",
      });
    }
      },
    );
  };

  const removeAt = (idx: number) => {
    const next = photosRef.current.filter((_, i) => i !== idx);
    photosRef.current = next;
    lastEmittedPhotosRef.current = next;
    onPhotosChange(next);
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
    photosRef.current = next;
    lastEmittedPhotosRef.current = next;
    onPhotosChange(next);
  };

  return (
    <div className="space-y-4 pt-2 border-t border-border">
      <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">
        Media
      </Label>

      {(!isHighlight || allowVideoUpload) && <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-bold flex items-center gap-1.5">
            <ImagePlus className="w-4 h-4" /> Photos
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="font-bold rounded-full"
            onClick={() => photoInputRef.current?.click()}
            data-testid="button-add-photos"
          >
            <ImagePlus className="w-3.5 h-3.5 mr-1.5" /> Add Photos
          </Button>
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            data-testid="input-post-photos"
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
      </div>}

      {(isHighlight || allowVideoUpload) && (
        <div className="space-y-2" data-testid="highlight-video-upload">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-bold flex items-center gap-1.5">
              <Video className="w-4 h-4" /> Upload Video
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="font-bold rounded-full"
              disabled={uploadingVideo}
              onClick={() => videoInputRef.current?.click()}
              data-testid="button-add-video"
            >
              <Video className="w-3.5 h-3.5 mr-1.5" />
              {uploadingVideo ? "Uploading…" : videoAssetId ? "Replace Video" : "Add Video"}
            </Button>
            <input
              ref={videoInputRef}
              type="file"
              accept={HIGHLIGHT_VIDEO_ACCEPT}
              className="hidden"
              onChange={(e) => {
                void onHighlightVideo(e.target.files);
                e.target.value = "";
              }}
              data-testid="input-highlight-video"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Choose an MP4 or MOV from your phone, up to 10 MB. If it is too
            large, trim it in Photos or Gallery first.
          </p>
          {videoPreview && (
            <div className="relative overflow-hidden rounded-lg border bg-black">
              <video
                src={videoPreview}
                controls
                playsInline
                preload="metadata"
                className="max-h-72 w-full"
                aria-label={`Video preview: ${videoName}`}
              />
              <button
                type="button"
                onClick={removeHighlightVideo}
                className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/75 text-white"
                aria-label="Remove uploaded video"
                data-testid="button-remove-video"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      )}

      <div>
        <Label
          htmlFor="videoUrl"
          className="text-sm font-bold flex items-center gap-1.5"
        >
          <Video className="w-4 h-4" /> {(isHighlight || allowVideoUpload) ? "Or Add a YouTube Link" : "Video Highlight Link"}
        </Label>
        <Input
          id="videoUrl"
          value={videoUrl}
          onChange={(e) => {
            if (isHighlight && videoAssetId) removeHighlightVideo();
            onVideoUrlChange(e.target.value);
          }}
          placeholder="Paste a YouTube, Vimeo, or other video link"
          className="mt-2"
          data-testid="input-video-url"
        />
        <VideoUrlPreview url={videoUrl} />
      </div>
    </div>
  );
}

// Live preview for the video URL input. Mirrors what the feed card and
// post detail page render so the author can confirm the link parses to
// a real player before publishing. Empty / whitespace-only values are
// suppressed so the section stays quiet until there's something to
// preview. URLs that don't resolve to YouTube or Vimeo show the same
// fallback link the feed uses, with an explicit note that the link
// won't play inline — that way a typo or an unsupported provider is
// obvious in the composer instead of after publishing.
function VideoUrlPreview({ url }: { url: string }) {
  const trimmed = url.trim();
  if (!trimmed) return null;
  const embeddable =
    trimmed.startsWith("data:video/") || getEmbedSrc(trimmed) !== null;
  return (
    <div className="mt-3" data-testid="video-url-preview">
      <p className="text-[11px] text-muted-foreground font-semibold mb-2">
        {embeddable
          ? "Preview"
          : "We don't recognize this as a YouTube or Vimeo link, so it won't play inline. Readers will see this link instead:"}
      </p>
      <VideoEmbed url={trimmed} />
    </div>
  );
}
