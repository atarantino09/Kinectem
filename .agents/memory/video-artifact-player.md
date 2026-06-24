---
name: Video artifact master-clock player
description: How the game-recap-walkthrough video is driven — one scrubbable master clock, deterministic scenes, controlled audio.
---

# Master-clock video player (game-recap-walkthrough)

The video is driven by a single master clock, not per-scene timers.

- **One playhead owns time.** A `usePlayhead(totalMs)` hook (requestAnimationFrame, ref-backed time + play state) is the only clock. It exposes `currentMs, playing, play, pause, toggle, seek`. Everything else is a pure function of `currentMs`.
- **Scenes are deterministic in local time `t`.** `VideoTemplate` maps `currentMs` -> active scene + `localMs` and renders `<Scene t={localMs}/>`. Each scene computes opacity/scroll/zoom from `t` via `timing.ts` helpers (`panProgress`, `fadeInOpacity`, `captionOpacity`). No scene may use mount timers or framer-motion entrance transitions for time-driven content, or scrubbing breaks.
- **Audio is slaved to the clock.** One `<audio>`; play/pause follows `playing`; `currentTime` is corrected only on drift > 0.25s (so playback doesn't stutter but scrubs snap). A `canplay` listener retries `play()` for the autoplay export path.

**Why:** the previous design auto-looped through discrete scenes each owning a `setTimeout`, which made a single scrubbable timeline impossible and the position un-seekable.

**How to apply:** when adding/timing a scene, express every visual as a function of `t` and pick beat start offsets in ms; the scene's total budget is its entry in `SCENE_DURATIONS`. The composite audio file's `adelay` offsets must still match `SCENE_DURATIONS` (see video-artifact-audio.md).

## Two render paths (VideoWithControls)
- **Iframed (preview): `InteractivePlayer`** — single range slider + play/pause + mute, hover/tap-reveal bar, click-frame toggles. Scrub pauses then resumes; resume is guarded by a `scrubbingRef` and bound to both `onPointerUp` and `onLostPointerCapture` so releasing the pointer off the slider still resumes.
- **Non-iframed (export/recording): `ExportPlayer`** — fires `window.startRecording()` on mount and `window.stopRecording()` on end (the capture pipeline injects those globals). App-preview screenshots hit this path, so they show this path, not the interactive controls.
  - **The exported mp4 must open on the held poster frame, not immediate playback.** ExportPlayer holds the poster frame (audio parked, captions hidden) for a fixed delay, then starts the single playthrough from t=0; recording starts on mount so the poster intro lands at the head of the file. **Why:** the exported video must preview the AI Assist screen, not the blank composer. **The export poster has no play-button overlay** — only the interactive preview poster does. Keep these two posters distinct if you touch either path.
