import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toCanvas } from "html-to-image";
import type { PostResponse } from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Download, Share2, Sparkles } from "lucide-react";
import {
  ShareRecapCanvas,
  SHARE_CANVAS_W,
  SHARE_CANVAS_H,
  type ShareCtaMode,
} from "./ShareRecapCanvas";

/**
 * Task #863 — "Share as image" dialog. Shows a live preview of the branded
 * 1080×1350 composition, a CTA-line toggle, and a single high-energy action:
 * the native share sheet where available (mobile), otherwise a PNG download.
 *
 * The full-size canvas renders off-screen (not display:none — fonts and
 * layout must resolve) and is captured with html-to-image at 2× then
 * downscaled to 1080×1350 for sharpness.
 */
export function ShareRecapImageDialog({
  post,
  open,
  onOpenChange,
}: {
  post: PostResponse;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const captureRef = useRef<HTMLDivElement | null>(null);
  const [ctaMode, setCtaMode] = useState<ShareCtaMode>("bio");
  const [busy, setBusy] = useState(false);
  const [captureReady, setCaptureReady] = useState(false);
  // The preview is a RENDERED IMAGE of the capture node, not a live
  // scaled-down DOM copy. Three rounds of iOS-only off-center/cropped
  // previews proved JS scale math can't be trusted across engines; an
  // <img> at width:100% is layout-proof everywhere and doubles as a
  // truthful "this is exactly what you'll download" preview.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const recapUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    return `${window.location.origin}${base}/posts/${post.id}`;
  }, [post.id]);

  // Capture-readiness barrier: don't allow export until webfonts have
  // settled AND every image inside the off-screen capture node has
  // decoded. On a cold (especially mobile) cache, capturing early ships
  // fallback-font text or missing background/logo layers.
  useEffect(() => {
    if (!open) {
      setCaptureReady(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        await document.fonts?.ready;
        // Wait a tick for the off-screen node to mount, then decode images.
        for (let attempt = 0; attempt < 20 && !cancelled; attempt++) {
          const node = captureRef.current;
          if (node) {
            const imgs = Array.from(node.querySelectorAll("img"));
            await Promise.all(
              imgs.map((img) =>
                img.complete
                  ? Promise.resolve()
                  : img.decode().catch(() => undefined),
              ),
            );
            if (imgs.every((img) => img.complete)) break;
          }
          await new Promise((r) => setTimeout(r, 150));
        }
      } catch {
        // Fall through — better to enable than to wedge the button.
      }
      if (!cancelled) setCaptureReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Use the native share sheet only on touch devices (phones/tablets).
  // Desktop macOS browsers also pass canShare(), but there the system
  // share sheet (AirDrop/Mail/Notes…) is confusing — desktop users
  // expect a straight download they can then upload to their socials.
  const canNativeShare =
    typeof navigator !== "undefined" &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({
      files: [new File([""], "x.png", { type: "image/png" })],
    }) &&
    typeof window !== "undefined" &&
    window.matchMedia("(pointer: coarse)").matches;

  // Shared capture pipeline: inline images, then multi-pass rasterize
  // the off-screen node at the requested pixel ratio.
  const renderCanvas = useCallback(async (pixelRatio: number) => {
    const node = captureRef.current;
    if (!node) throw new Error("Share canvas not ready");
    // Inline every <img> as a data: URL BEFORE capture. html-to-image
    // re-fetches image URLs while serializing, which can silently render
    // blanks: cache-busted query params invalidate signed asset URLs, and
    // slow re-fetches lose the race with the SVG snapshot (seen in the
    // wild as an export missing the stadium background). Pre-inlining
    // makes the capture deterministic; failures keep the original src.
    await Promise.all(
      Array.from(node.querySelectorAll("img")).map(async (img) => {
        const src = img.getAttribute("src") ?? "";
        if (!src || src.startsWith("data:")) return;
        try {
          const resp = await fetch(src);
          if (!resp.ok) return;
          const blob = await resp.blob();
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(fr.result as string);
            fr.onerror = () => reject(fr.error);
            fr.readAsDataURL(blob);
          });
          img.src = dataUrl;
          await img.decode().catch(() => undefined);
        } catch {
          // Keep the original src — better a possibly-cached image than none.
        }
      }),
    );
    // 2× capture then downscale — a 1× capture is visibly soft.
    // Safari/WebKit quirk: the first SVG-foreignObject rasterization
    // frequently drops <img> layers (they decode too late), so the first
    // export ships without the stadium background. The standard fix is
    // to render more than once and keep the LAST pass — by then WebKit
    // has the images decoded. Chrome renders correctly on pass one; the
    // extra passes just cost a moment, so we always do them.
    const isWebKit =
      typeof navigator !== "undefined" &&
      /safari/i.test(navigator.userAgent) &&
      !/chrome|chromium|android/i.test(navigator.userAgent);
    const passes = isWebKit ? 3 : 2;
    let big: HTMLCanvasElement | null = null;
    for (let i = 0; i < passes; i++) {
      big = await toCanvas(node, {
        pixelRatio,
        width: SHARE_CANVAS_W,
        height: SHARE_CANVAS_H,
      });
    }
    if (!big) throw new Error("Could not render the image");
    return big;
  }, []);

  const renderPng = useCallback(async (): Promise<Blob> => {
    // 2× capture then downscale — a 1× capture is visibly soft.
    const big = await renderCanvas(2);
    const out = document.createElement("canvas");
    out.width = SHARE_CANVAS_W;
    out.height = SHARE_CANVAS_H;
    const ctx = out.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(big, 0, 0, SHARE_CANVAS_W, SHARE_CANVAS_H);
    const blob = await new Promise<Blob | null>((resolve) =>
      out.toBlob(resolve, "image/png"),
    );
    if (!blob) throw new Error("Could not create the image");
    return blob;
  }, []);

  // Generate the preview image once fonts/images are ready, and again
  // whenever the CTA line toggles. 0.5× is plenty for a dialog-width
  // preview and keeps regeneration snappy.
  useEffect(() => {
    if (!open || !captureReady) return;
    let cancelled = false;
    (async () => {
      try {
        const canvas = await renderCanvas(0.5);
        if (cancelled) return;
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/png"),
        );
        if (cancelled || !blob) return;
        setPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(blob);
        });
      } catch {
        // Preview failure is non-fatal — the download path still works.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, captureReady, ctaMode, renderCanvas]);

  // Drop the object URL when the dialog closes.
  useEffect(() => {
    if (open) return;
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, [open]);

  const fileName = useMemo(() => {
    const slug = (post.title ?? "game-recap")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48);
    return `kinectem-${slug || "game-recap"}.png`;
  }, [post.title]);

  const handleShare = useCallback(async () => {
    setBusy(true);
    try {
      const blob = await renderPng();
      const file = new File([blob], fileName, { type: "image/png" });
      if (canNativeShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: post.title ?? "Game recap",
          });
          return;
        } catch (err) {
          // User cancelled the sheet — not an error; anything else falls
          // through to download so they still get the image.
          if ((err as { name?: string }).name === "AbortError") return;
        }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({
        title: "Image saved!",
        description:
          "Your branded recap image is ready — upload it to Instagram, Facebook, or anywhere else.",
      });
    } catch (err) {
      toast({
        title: "Couldn't create the image",
        description:
          err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }, [renderPng, fileName, canNativeShare, post.title, toast]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // min-w-0 is load-bearing: DialogContent is a flex item of the
        // centering wrapper, and flex items refuse to shrink below their
        // content's min-content width. Something in this dialog (preview
        // + CTA row) is naturally wider than a phone screen, which pushed
        // the whole dialog past the right edge on mobile — the preview
        // then LOOKED off-center even though it was centered in its box.
        className="max-w-lg min-w-0 p-0 gap-0 overflow-hidden max-h-[calc(100dvh-2rem)] flex flex-col"
        data-testid="dialog-share-recap-image"
      >
        <DialogHeader className="px-5 pt-5 pb-3 shrink-0 text-left">
          <DialogTitle className="flex items-center gap-2 text-lg font-black">
            <Sparkles className="w-5 h-5 text-primary shrink-0" />
            Turn this recap into a branded image
          </DialogTitle>
          <DialogDescription>
            Way better than a screenshot — a clean, Kinectem-framed image
            sized for Instagram &amp; Facebook, ready to post everywhere.
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 overflow-y-auto flex-1 min-h-0 min-w-0 max-w-full overflow-x-hidden">
          {/* Preview (scaled-down live render) */}
          <div
            className="w-full rounded-xl bg-muted/60 border border-border p-3"
            data-testid="share-image-preview"
          >
            {/* The preview is a plain <img> of the rendered export — a
                width-100% image can't be off-center or cropped in any
                browser, and it shows EXACTLY what will download. */}
            <div
              style={{
                width: "100%",
                maxWidth: SHARE_CANVAS_W / 2,
                aspectRatio: `${SHARE_CANVAS_W} / ${SHARE_CANVAS_H}`,
                marginLeft: "auto",
                marginRight: "auto",
                overflow: "hidden",
                borderRadius: 10,
              }}
            >
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt="Preview of your branded recap image"
                  className="w-full h-full"
                  data-testid="img-share-preview"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-muted animate-pulse">
                  <p className="text-sm font-semibold text-muted-foreground">
                    Rendering preview…
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* CTA line toggle */}
          <div className="mt-3 space-y-1.5">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">
              Bottom line on the image
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={ctaMode === "bio" ? "default" : "outline"}
                className="font-bold flex-1"
                onClick={() => setCtaMode("bio")}
                data-testid="btn-share-cta-bio"
              >
                “Link in bio.”
              </Button>
              <Button
                type="button"
                size="sm"
                variant={ctaMode === "url" ? "default" : "outline"}
                className="font-bold flex-1"
                onClick={() => setCtaMode("url")}
                data-testid="btn-share-cta-url"
              >
                Recap link
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              “Link in bio.” fits Instagram; the full link works better for
              Facebook.
            </p>
          </div>
        </div>

        <div className="px-5 py-4 shrink-0 border-t border-border bg-card">
          <Button
            className="w-full font-bold"
            variant="brand"
            size="lg"
            disabled={busy || !captureReady}
            onClick={handleShare}
            data-testid="btn-share-image-action"
          >
            {busy ? (
              "Creating your image…"
            ) : !captureReady ? (
              "Preparing your image…"
            ) : canNativeShare ? (
              <>
                <Share2 className="w-4 h-4 mr-2" /> Share to your socials
              </>
            ) : (
              <>
                <Download className="w-4 h-4 mr-2" /> Download &amp; share to
                your socials
              </>
            )}
          </Button>
        </div>

        {/* Off-screen full-size render used for capture. Kept mounted while
            the dialog is open so fonts/images are loaded before capture. */}
        {open && (
          <div
            aria-hidden
            style={{
              position: "fixed",
              left: -10000,
              top: 0,
              width: SHARE_CANVAS_W,
              height: SHARE_CANVAS_H,
              overflow: "hidden",
              pointerEvents: "none",
            }}
          >
            <ShareRecapCanvas
              ref={captureRef}
              post={post}
              ctaMode={ctaMode}
              recapUrl={recapUrl}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
