---
name: Mobile grid truncation
description: Prevent long, truncated content from widening card grids on phones.
---

Grid children that contain `truncate` text still need `min-w-0` on the grid item and its relevant flex/card descendants; otherwise the automatic min-content width can widen the whole document on mobile.

**Why:** `truncate` intentionally sets a non-wrapping line. Without an explicit shrink allowance on its ancestors, a long team/opponent label can force a single-column recap grid wider than the viewport, clipping the CTA and creating horizontal scroll.

**How to apply:** For responsive card grids with potentially long labels, put `min-w-0` on the grid container, the direct item/link, and the card/content flex chain before relying on `truncate`.