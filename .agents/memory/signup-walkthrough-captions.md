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

# Pushing captions to the STATIC marketing landing page (burn-in)

The marketing site (`artifacts/marketing`) is static multi-page HTML (`index.html` embeds
a plain `<video src="./walkthrough.mp4" controls>`), so the React caption overlay from
`App.tsx` cannot transfer. To "push the captioned version" to marketing, captions are
**burned into the mp4** via `pnpm --filter @workspace/scripts run burn-walkthrough-captions`
(`scripts/src/burn-walkthrough-captions.ts`): it emits an ASS subtitle file (libass) and
runs `ffmpeg -vf subtitles=...` (x264 crf20, audio copied), reading the CLEAN source
`artifacts/signup-walkthrough/public/walkthrough.mp4` and writing the captioned
`artifacts/marketing/public/walkthrough.mp4`. Poster regenerated with
`ffmpeg -ss <t> -frames:v 1`.

**Why this split:** signup-walkthrough's own mp4 must stay caption-free (its app overlays
captions live in React); only marketing gets burn-in. ASS style mirrors the game-recap box
(BorderStyle=3 opaque box, BackColour `&H80000000` ≈ bg-black/50, white DejaVu Sans,
bottom-center, `\fad(320,320)`). DM Sans is NOT installed system-wide — DejaVu Sans is the
burn font.

**How to apply / drift risk:** the cue list is DUPLICATED — `CAPTIONS` in `App.tsx` and the
`CAPTIONS` array in the burn script. If you change caption text/timings, update BOTH and
re-run the burn script. ffmpeg has libass (`subtitles`/`ass`) + `drawtext` available.
