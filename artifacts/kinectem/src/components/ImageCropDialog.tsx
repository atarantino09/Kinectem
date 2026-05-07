import { useCallback, useEffect, useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RotateCcw, ZoomIn, ZoomOut } from "lucide-react";

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.05;
// Cap the cropped JPEG's longest edge so we don't ship a needlessly huge
// image. Matches `shrinkImage`'s 1024 budget on the upper end.
const MAX_OUTPUT_WIDTH = 1600;
const OUTPUT_QUALITY = 0.9;

export interface ImageCropDialogProps {
  /** Source image (data URL or blob URL). When null/empty the dialog is hidden. */
  src: string | null;
  /** Filename to use for the cropped output. */
  fileName: string;
  /** Aspect ratio of the crop frame (width / height). Defaults to 1 (square). */
  aspect?: number;
  /** Visual shape of the crop frame. Use "round" for avatars. */
  cropShape?: "rect" | "round";
  /** Title shown in the dialog header. */
  title?: string;
  /** Helper copy under the title. */
  description?: string;
  /** Label for the confirm button. */
  confirmLabel?: string;
  /** Fallback name applied when fileName has no usable base. */
  fallbackBaseName?: string;
  /** Override for the dialog's data-testid. Defaults to "dialog-crop-image". */
  testId?: string;
  /** Pixel height of the crop area. Defaults to 280. */
  cropAreaHeight?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Called with the cropped File. May return a Promise; the crop dialog
   * stays in its busy state until the promise settles so users can't
   * double-submit while the upload is in flight.
   */
  onConfirm: (cropped: File) => void | Promise<void>;
}

async function loadHTMLImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not read image"));
    img.src = src;
  });
}

async function cropToFile(
  src: string,
  area: Area,
  fileName: string,
  fallbackBaseName: string,
): Promise<File> {
  const img = await loadHTMLImage(src);
  // Clamp to integer pixels inside image bounds so we never sample
  // outside the source (react-easy-crop's pixel area is in source-image
  // coords but can drift a fractional pixel past the edge).
  const sx = Math.max(0, Math.round(area.x));
  const sy = Math.max(0, Math.round(area.y));
  const sw = Math.max(1, Math.min(img.naturalWidth - sx, Math.round(area.width)));
  const sh = Math.max(1, Math.min(img.naturalHeight - sy, Math.round(area.height)));

  // Downscale if the source crop is huge so the resulting JPEG stays
  // reasonable for upload.
  const scale = Math.min(1, MAX_OUTPUT_WIDTH / sw);
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement("canvas");
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", OUTPUT_QUALITY),
  );
  if (!blob) throw new Error("Could not encode cropped image");

  const baseName = fileName.replace(/\.[^.]+$/, "") || fallbackBaseName;
  return new File([blob], `${baseName}.jpg`, {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
}

export function ImageCropDialog({
  src,
  fileName,
  aspect = 1,
  cropShape = "rect",
  title = "Position your photo",
  description = "Drag to move, pinch or use the slider to zoom.",
  confirmLabel = "Save photo",
  fallbackBaseName = "photo",
  testId = "dialog-crop-image",
  cropAreaHeight = 280,
  open,
  onOpenChange,
  onConfirm,
}: ImageCropDialogProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);
  const areaPixelsRef = useRef<Area | null>(null);

  // Reset position/zoom (and any leftover busy flag from a prior
  // session) every time the dialog opens with a new source. Without
  // resetting `busy` here, a previously-successful save would leave
  // the next session's buttons permanently disabled because the
  // success path closes the dialog before clearing the flag.
  useEffect(() => {
    if (open) {
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setBusy(false);
      areaPixelsRef.current = null;
    }
  }, [open, src]);

  const onCropComplete = useCallback((_area: Area, areaPixels: Area) => {
    areaPixelsRef.current = areaPixels;
  }, []);

  const onReset = () => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
  };

  const onSave = async () => {
    if (!src || !areaPixelsRef.current) return;
    setBusy(true);
    try {
      const file = await cropToFile(
        src,
        areaPixelsRef.current,
        fileName,
        fallbackBaseName,
      );
      // Await onConfirm so the dialog stays in its busy/disabled state
      // until the parent finishes uploading. Closing only happens after
      // the parent's promise settles to avoid a flash of the previous
      // (unsaved) image during the request.
      await onConfirm(file);
      onOpenChange(false);
    } catch {
      // Cropper or upload failed; fall through to the finally block so
      // the user can adjust and try again rather than being stuck.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="sm:max-w-xl" data-testid={testId}>
        <DialogHeader>
          <DialogTitle className="font-black tracking-tight">
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div
          className="relative w-full bg-muted rounded-lg overflow-hidden"
          // Fixed height so Cropper has a positioned parent.
          style={{ height: cropAreaHeight }}
          data-testid="crop-area"
        >
          {src && (
            <Cropper
              image={src}
              crop={crop}
              zoom={zoom}
              minZoom={MIN_ZOOM}
              maxZoom={MAX_ZOOM}
              aspect={aspect}
              cropShape={cropShape}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
              objectFit="cover"
              showGrid={false}
            />
          )}
        </div>

        <div className="space-y-2">
          <Label
            htmlFor="crop-zoom"
            className="text-xs font-bold flex items-center justify-between"
          >
            <span>Zoom</span>
            <button
              type="button"
              onClick={onReset}
              disabled={busy}
              className="inline-flex items-center gap-1 text-[11px] font-bold text-muted-foreground hover:text-foreground"
              data-testid="btn-crop-reset"
            >
              <RotateCcw className="w-3 h-3" />
              Reset
            </button>
          </Label>
          <div className="flex items-center gap-2">
            <ZoomOut
              className="w-4 h-4 text-muted-foreground shrink-0"
              aria-hidden
            />
            <input
              id="crop-zoom"
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={ZOOM_STEP}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              disabled={busy}
              aria-label="Zoom"
              className="flex-1 accent-primary"
              data-testid="input-crop-zoom"
            />
            <ZoomIn
              className="w-4 h-4 text-muted-foreground shrink-0"
              aria-hidden
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={busy}
            data-testid="btn-crop-cancel"
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="brand"
            onClick={onSave}
            disabled={busy || !src}
            data-testid="btn-crop-save"
          >
            {busy ? "Saving…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
