#!/usr/bin/env bash
# Rebuild public/audio/composite_audio.mp3 from the per-line VO clips + bg music.
#
# The AI Assist walkthrough is a React-rendered video: VideoTemplate plays this
# single composite track and seeks to each scene's cumulative start time. So the
# VO clips must sit at fixed absolute offsets that match SCENE_DURATIONS in
# VideoTemplate.tsx. Keep this script and those durations in lockstep.
#
# Scene starts (seconds): 0 / 13.0 / 21.5 / 31.5 / 47.0, total 53.0.
#
# Music continuity: bg_music.mp3 is ~48s, shorter than the timeline. Instead of a
# hard -stream_loop seam (audible jump at 48s) we acrossfade two copies of the
# track so the loop point is smoothed and the bed stays constant the whole time.
# Each VO line also gets a tiny in-fade so lines enter cleanly and flow.
set -euo pipefail
cd "$(dirname "$0")/../public/audio"

ffmpeg -y \
  -i bg_music.mp3 -i bg_music.mp3 \
  -i vo_1a.mp3 -i vo_1b.mp3 \
  -i vo_2.mp3 \
  -i vo_3.mp3 \
  -i vo_4a.mp3 -i vo_4b.mp3 \
  -i vo_5.mp3 \
  -filter_complex "\
    [0:a][1:a]acrossfade=d=4:c1=tri:c2=tri[bgx]; \
    [bgx]atrim=0:53.0,volume=0.14,afade=t=in:st=0:d=1,afade=t=out:st=51.5:d=1.5[bg]; \
    [2:a]afade=t=in:st=0:d=0.05,adelay=300|300[a1]; \
    [3:a]afade=t=in:st=0:d=0.05,adelay=6900|6900[a2]; \
    [4:a]afade=t=in:st=0:d=0.05,adelay=13400|13400[a3]; \
    [5:a]afade=t=in:st=0:d=0.05,adelay=22000|22000[a4]; \
    [6:a]afade=t=in:st=0:d=0.05,adelay=31800|31800[a5]; \
    [7:a]afade=t=in:st=0:d=0.05,adelay=38500|38500[a6]; \
    [8:a]afade=t=in:st=0:d=0.05,adelay=47700|47700[a7]; \
    [bg][a1][a2][a3][a4][a5][a6][a7]amix=inputs=8:duration=longest:normalize=0,alimiter=limit=0.95[out]" \
  -map "[out]" -t 53.0 -ar 44100 -b:a 192k composite_audio.mp3

echo "Wrote composite_audio.mp3"
