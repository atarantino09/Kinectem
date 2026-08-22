---
name: Share canvas frame capture
description: Capture compatibility constraint for html-to-image social-export frames.
---

Use ordinary painted edge bands for a branded frame in any `html-to-image`
capture canvas; do not use CSS `border-image`.

**Why:** The library's SVG foreign-object snapshotter can rasterize a gradient
`border-image` as a full-element fill, hiding the social artwork even though the
live DOM looks correct.

**How to apply:** Draw four absolutely positioned edge elements over the canvas
with primary/secondary colors or gradients, then verify the completed rendered
preview in a real browser before shipping.