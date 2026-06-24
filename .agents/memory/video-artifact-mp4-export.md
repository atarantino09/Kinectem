---
name: Exporting a master-clock video artifact to MP4
description: How to produce a synced MP4 file from the React video artifacts (game-recap-walkthrough etc.) without the preview-pane export UI.
---

# Exporting a video artifact to MP4 (headless)

There is NO built-in programmatic export tool — the preview-pane "export" is user-triggered. To produce an MP4 from a master-clock video artifact (e.g. `game-recap-walkthrough`) yourself:

1. **Record visuals with Playwright `recordVideo`.** Load the artifact URL as a top-level document via the shared proxy (`http://localhost:80/<slug>/`) so the non-iframed `ExportPlayer` autoplays. Use `@playwright/test`'s `chromium` (already installed; run the script from `artifacts/kinectem` so it resolves). Launch with `--autoplay-policy=no-user-gesture-required`, context `recordVideo: { dir, size }`, viewport 1280x720, `deviceScaleFactor: 2` for crispness. The video records at the `recordVideo.size`, not the DSF.
2. **Capture the start offset.** `addInitScript` to define `window.startRecording`/`window.stopRecording` (the ExportPlayer calls them via optional chaining) and stamp `performance.now()`. The webm timeline t=0 ≈ document origin, so the animation/audio begin at `perfStart` ms — that lead-in (page load before the playhead starts) was ~1.4s in practice. Poll `window.__recStart` then wait `TOTAL_MS + buffer` or `window.__recStop`.
3. **Mux the composite audio.** Audio is NOT captured by recordVideo. The artifact's `public/audio/composite_audio.mp3` is lockstep with the visual timeline, so trim the webm at `perfStart` and overlay the audio from 0. **Caveat (ai-assist-walkthrough):** when `ExportPlayer` opens on a held poster frame before the playthrough, the audio track must carry the SAME amount of leading silence as the poster hold (`EXPORT_POSTER_HOLD_MS` / `AUDIO_PREROLL_MS`, both 1800ms). The silence is baked into `composite_audio.mp3` via a second `adelay=1800|1800` pass in `build-composite-audio.sh`; without it the muxed audio leads the captions by the hold duration. Do NOT assume the track starts content at t=0. `ffmpeg -ss <perfStart> -i raw.webm -i composite_audio.mp3 -t <TOTAL_MS/1000> -map 0:v:0 -map 1:a:0 -c:v libx264 -pix_fmt yuv420p -crf 22 -preset slow -movflags +faststart -c:a aac -b:a 160k out.mp4`.
4. **Verify by extracting frames** (`ffmpeg -ss <t> -frames:v 1`) at several timestamps and confirm captions match the expected scene — that proves audio↔video sync.

**Why:** `recordVideo` starts at page creation (before the playhead/audio start), so a raw recording has a blank/loading lead-in and no audio. Trimming at `perfStart` + muxing the pre-synced composite track is what makes the exported clip start clean and stay in sync.

**Gotcha:** `scripts/validate-recording.sh` greps for `useVideoPlayer`, but this artifact uses the custom `usePlayhead`/`ExportPlayer` pattern instead — the script reports a false failure even though the `window.startRecording`/`stopRecording` lifecycle is intact.
