import type { SyntheticEvent } from "react";

export type BlurFillImageShape = "wide" | "landscape" | "portrait";

/** Shared fixed geometry for cropped team banners and their edit preview. */
export const TEAM_BANNER_ASPECT = 16 / 5;
export const TEAM_BANNER_FRAME_CLASS = "aspect-[16/5]";
export const TEAM_BANNER_PREVIEW_CLASS = "aspect-[16/5]";

export function classifyBlurFillImageShape(
  naturalWidth: number,
  naturalHeight: number,
): BlurFillImageShape {
  if (naturalWidth <= 0 || naturalHeight <= 0) return "wide";
  const ratio = naturalWidth / naturalHeight;
  if (ratio <= 1.1) return "portrait";
  if (ratio < 2.4) return "landscape";
  return "wide";
}

export function teamBannerFrameClass(shape: BlurFillImageShape): string {
  if (shape === "portrait") return "aspect-[2/1] sm:aspect-[16/7]";
  if (shape === "landscape") return "aspect-[16/7] sm:aspect-[8/3]";
  return "aspect-[16/5]";
}

export function teamBannerPreviewClass(shape: BlurFillImageShape): string {
  if (shape === "portrait") return "h-40";
  if (shape === "landscape") return "h-36";
  return "h-28";
}

// Shows a photo as large as possible inside a bounded responsive container
// without cropping: the sharp photo is fitted with `object-contain`, and a
// blurred, zoomed copy of the same photo fills whatever space is left over
// (the "blurred backdrop" pattern). Used for team hero banners and their
// upload previews so a portrait/landscape team photo never has heads or
// legs cut off by the wide banner shape.
//
// The parent container must be `relative overflow-hidden` and size the box.
export function BlurFillImage({
  src,
  alt,
  testId,
  onShapeChange,
}: {
  src: string;
  alt: string;
  testId?: string;
  onShapeChange?: (shape: BlurFillImageShape) => void;
}) {
  const reportShape = (event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    onShapeChange?.(
      classifyBlurFillImageShape(image.naturalWidth, image.naturalHeight),
    );
  };

  return (
    <>
      <img
        src={src}
        aria-hidden="true"
        className="absolute inset-0 h-full w-full scale-110 object-cover blur-md"
      />
      <img
        src={src}
        alt={alt}
        data-testid={testId}
        onLoad={reportShape}
        className="absolute inset-0 h-full w-full object-contain"
      />
    </>
  );
}
