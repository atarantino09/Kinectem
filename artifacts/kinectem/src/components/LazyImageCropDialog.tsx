import { Suspense, lazy, useEffect, useState } from "react";
import type { ImageCropDialogProps } from "@/components/ImageCropDialog";

// Defer the (heavy) cropper — and its `react-easy-crop` dependency — out
// of the main bundle. The chunk is only fetched the first time a consumer
// opens the dialog.
const ImageCropDialogImpl = lazy(() =>
  import("@/components/ImageCropDialog").then((m) => ({
    default: m.ImageCropDialog,
  })),
);

/**
 * Drop-in replacement for `ImageCropDialog` that lazy-loads the real
 * implementation. Nothing is mounted (and no chunk is fetched) until the
 * dialog is first opened; once opened it stays mounted so Radix can play
 * its close animation, matching the original always-mounted behaviour.
 */
export function ImageCropDialog(props: ImageCropDialogProps) {
  const [mounted, setMounted] = useState(props.open);

  useEffect(() => {
    if (props.open) setMounted(true);
  }, [props.open]);

  if (!mounted) return null;

  return (
    <Suspense fallback={null}>
      <ImageCropDialogImpl {...props} />
    </Suspense>
  );
}
