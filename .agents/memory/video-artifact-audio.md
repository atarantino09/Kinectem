---
name: Video artifact audio timeline (game-recap-walkthrough)
description: How the React-rendered video's single composite audio track is built and kept in sync with on-screen scenes.
---

# Video artifact audio timeline

The walkthrough videos (e.g. `artifacts/game-recap-walkthrough`) are React-rendered,
not exported clips. `VideoTemplate` plays ONE `composite_audio.mp3` and, on each
scene change, seeks the `<audio>` to that scene's cumulative start time computed from
`SCENE_DURATIONS`. So the audio and the visuals are only synced if the VO offsets in
`scripts/build-composite-audio.sh` match `SCENE_DURATIONS`.

## The lockstep rule
Each VO line is placed by an `adelay` (absolute ms from track start). A line's
[start, start+clipDuration] must fall entirely inside its scene's window
[sceneStart, sceneStart+sceneDuration]. Keep ~0.3–0.5s gaps between adjacent lines.
**Whenever you change a VO clip's length or any `SCENE_DURATIONS` value, recompute
EVERY downstream offset and the script's `-t` total, then update the header comment.**
The composite total must be ≥ the timeline sum (last scene start + its duration).
Verify clip durations with `ffprobe -show_entries format=duration`.

## Constant music (no loop seam)
`bg_music.mp3` is shorter than the timeline. Do NOT use `-stream_loop` — its loop
point is an audible jump ("music doesn't stay constant"). Instead `acrossfade` two
copies of the track (`[0:a][1:a]acrossfade=d=4:c1=tri:c2=tri`) then `atrim` to length;
the seam is smoothed. Add a tiny per-VO in-fade (`afade=t=in:st=0:d=0.05`) so lines
enter without a click and flow. Mix with `amix=...:normalize=0` so the bed level stays
constant under VO (normalize would duck the music when VO plays).

## Voice
VO is ElevenLabs "Bella - Professional, Bright, Warm" (`voiceId hpp4J3VqNfWAUOO0d1Us`).
For an upbeat read use voiceSettings ~ `{ stability 0.4, similarity_boost 0.8, style 0.45,
use_speaker_boost true, speed ~1.06 }`. Regenerate a single line straight into
`public/audio/vo_<n>.mp3`, then rerun `build-composite-audio.sh`.
