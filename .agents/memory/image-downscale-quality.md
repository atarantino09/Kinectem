---
name: Client image downscale quality
description: Why uploaded photos looked blurry and how the shrink pipeline avoids it.
---

Uploaded photos across kinectem are downscaled client-side on a 2D canvas
before upload (`artifacts/kinectem/src/lib/shrinkImage.ts`). Two things make
canvas downscales look blurry:

1. **Default `imageSmoothingQuality` is `"low"`.** It must be set to `"high"`
   on every context that draws a reduced image, or output is soft/aliased.
2. **Single-step large reductions** (e.g. a 4032px phone photo straight to the
   target) use a poor box filter. Fix: **stepped halving** — repeatedly halve
   (each step ≤2x reduction) toward the target, then one exact-size pass. This
   is what `resizeStepped` does.

**Why:** users reported "most photos show up pretty blurry". Both the low
smoothing quality and the single-step jump contributed.

**How to apply:** any new canvas resize/crop path in this app must set
`imageSmoothingEnabled = true; imageSmoothingQuality = "high"` and prefer
stepped downscaling for large ratios. Default budget is 1600px / q0.9;
team hero banners use 2048px / q0.92 (`BANNER_SHRINK_*`). Keep encoded data
URLs under `DATA_URL_MAX_LENGTH` (express.json 25MB cap) — the
`shrinkImageToDataUrl` fallback re-encodes at the default budget if exceeded.
