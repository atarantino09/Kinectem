---
name: Video artifact MP4 export (smooth scroll)
description: How to export a master-clock video artifact to a smooth MP4, and the broken typecheck baseline of the walkthrough artifacts.
---

# Deterministic frame render = smooth scroll

Playwright `recordVideo` only samples ~25fps and **drops frames during fast pans/scroll** (worse under deviceScaleFactor:2 real-time render load), so a recorded master-clock video looks choppy exactly where the screenshot pans scroll. Re-recording does not reliably fix it.

**Fix that works:** render the video deterministically, one even-spaced frame at a time, then assemble + mux.

- The video must be a pure function of `currentMs` (these artifacts are: scenes derive everything from local `t` via panProgress/fadeInOpacity/captionOpacity; no real-time TypewriterText/AnimatedCursor in the scene tree).
- The **only** non-deterministic part of `VideoTemplate` is the two ambient background blob `motion.div`s (framer-motion `animate` on wall-clock). Freeze them for capture — add a `freezeBg` prop that drops their `animate`/`transition`. They're heavily blurred / low-opacity so a static background is visually fine.
- Add a capture harness gated on a `?capture` URL param (App.tsx branch → `CaptureHarness`) that renders `<VideoTemplate currentMs={state} playing={false} muted poster freezeBg/>` and exposes `window.__setFrame(ms, isPoster?)` returning a promise resolved after a double-rAF (commit+paint). Preload all `shots/*.png` before setting `window.__captureReady` so each scene's `<img>` measures its scroll height synchronously on mount (otherwise first frames of a scene get a stale `maxScroll=0`).
- Drive it from an external Playwright script (resolve `@playwright/test` from `artifacts/kinectem/node_modules`): viewport 1280x720, deviceScaleFactor 1, `await page.evaluate(m => window.__setFrame(m), ms)` then `page.screenshot` per frame.
- Poster intro: composite_audio.mp3 has 1.8s leading silence, so prepend 1.8s of the poster frame (currentMs=POSTER_MS, poster=true) before the 0..TOTAL_MS playthrough to keep audio in sync. Screenshot the poster once and `cp` it for the held frames.
- Assemble: `ffmpeg -framerate 30 -i frame_%05d.png -i composite_audio.mp3 -t <video_len> -c:v libx264 -pix_fmt yuv420p -crf 20 -preset slow -movflags +faststart -c:a aac -r 30 out.mp4`. 30fps even-spaced is smooth for the slow eased pans; 1644 frames ≈ 5MB.

**Why 30fps deterministic beats 25fps recorded:** the choppiness is from *uneven/dropped* frames, not the nominal rate. Perfectly even spacing reads as smooth.

## Running long captures in this sandbox

Backgrounded/`setsid`/`nohup` node processes get **reaped** (die with 0 output) here. Foreground bash has a 120s cap. So make the capture script **resumable** via `START`/`LIMIT` env vars (only `rmSync` the frames dir when `START===0`) and run ~200-frame foreground chunks sequentially until done. A chunk that overruns the 120s cap often keeps running as an orphan and still finishes its range — re-poll the frame count before launching the next chunk.

# Walkthrough artifacts have a BROKEN typecheck baseline

`pnpm --filter @workspace/<walkthrough> run typecheck` fails at baseline for **all** the walkthrough video artifacts (game-recap / signup / ai-assist). Two independent causes, both pre-existing:
- Their `tsconfig.json` extends `tsconfig.base.json` (`lib: ["es2022"]`, `types: []`) and **does not add `dom`** the way `dev-portal` does (`lib: ["esnext","dom","dom.iterable"]`). So every DOM global (`window`, `document`, `Image`, `requestAnimationFrame`, `HTMLAudioElement` members) errors with TS2304 / "include 'dom'".
- `lib/video/animations.ts` also has framer-motion `Variant` `transition`/`ease:"circOut"` TS2322 errors unrelated to DOM.

Vite/esbuild ignores all of this, so the artifacts run fine. **How to tell your errors from the noise:** real new errors are anything that is NOT a DOM-missing TS2304/TS2812 or the animations.ts framer-motion TS2322. Don't try to "fix" the baseline as part of an unrelated task.
