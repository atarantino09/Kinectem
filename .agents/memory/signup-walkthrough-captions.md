---
name: signup-walkthrough captions & video pipeline
description: How the signup-walkthrough video differs from game-recap, and where captions live.
---

# signup-walkthrough is a screen recording, NOT React scenes

The two video artifacts use fundamentally different pipelines:

- **game-recap-walkthrough**: `App → VideoWithControls → VideoTemplate` — React-rendered
  scenes recorded via the export pipeline. Captions are `<Caption>` components baked into
  the scenes, faded with `captionOpacity(t, start, end)` off a per-scene/master clock.
- **signup-walkthrough**: `App.tsx` plays a pre-recorded `public/walkthrough.mp4`, which
  `scripts/src/record-walkthrough.ts` produces by **Playwright screen-recording the real
  live Kinectem app** (navigates `/marketing`, `/login?signup=1`, real org/team/recap
  flows). The `VideoTemplate` / `Scene1–5` / `Chrome.tsx` files in signup-walkthrough are
  **dead/unused legacy** — nothing renders them. Editing them has zero effect on the video.

**How to apply:** To add/change captions on the signup walkthrough, edit the overlay in
`App.tsx` (a caption box positioned over the `<video>`, driven by `currentTime` and a
`CAPTIONS` array of `{start,end,text}` in ms). Cue timings map against
`public/walkthrough-markers.json` (scene boundaries; total ~48s), NOT against the dead
`SCENE_DURATIONS`. To change the recorded footage itself, re-run
`pnpm --filter @workspace/scripts run record-walkthrough` (needs the full live app stack +
demo seeding; produces `recording/raw.webm` + `markers.json`).

# Video artifacts have no DOM lib in typecheck (both signup + game-recap)

Both video artifacts extend `tsconfig.base.json` which sets `lib: ["es2022"]` with **no
DOM lib**. So `window`, `document`, `requestAnimationFrame`, and `HTMLVideoElement`
members (`currentTime`, `play`, `duration`) PRE-EXISTINGLY error under
`pnpm --filter @workspace/<slug> run typecheck`. Also framer-motion variant `transition`
shapes error in `lib/video/animations.ts`. Both artifacts ship/run fine via Vite (no
typecheck gate in dev/build path).

**Why:** template config, accepted across both artifacts. **How to apply:** do NOT "fix"
by editing tsconfig — these are not regressions. When adding code, just don't introduce
NEW error classes beyond this known DOM-lib gap.
