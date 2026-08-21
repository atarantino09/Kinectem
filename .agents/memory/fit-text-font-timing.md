---
name: FitText production font timing
description: How auto-measured single-line text stays correct when web fonts load after first paint.
---

**Rule:** Any text-fitting component that measures glyph width must remeasure
when the browser's font set becomes ready and when later font loads complete,
in addition to observing container geometry.

**Why:** A production first load can render a fallback font before the
application font is available. That changes the natural text width without
necessarily changing the container's dimensions, so a ResizeObserver-only
implementation may preserve an unnecessarily small title forever.

**How to apply:** Keep the normal resize observer for responsive layout, then
subscribe to `document.fonts.ready` and the font-set `loadingdone` event where
they are available. Re-run the same measurement after either signal.