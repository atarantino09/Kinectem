#!/usr/bin/env bash
# Rebuild public/audio/composite_audio.mp3 from the per-line VO clips + bg music.
#
# The game-recap walkthrough is a React-rendered video: VideoTemplate plays this
# single composite track and seeks to each scene's cumulative start time. So the
# VO clips must sit at fixed absolute offsets that match SCENE_DURATIONS in
# VideoTemplate.tsx. Keep this script and those durations in lockstep.
#
# Timeline (seconds): scene starts 0 / 14.5 / 28.9 / 38.5 / 46.0, total 54.7.
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
  -i vo_2a.mp3 -i vo_2b.mp3 \
  -i vo_3a.mp3 -i vo_3b.mp3 \
  -i vo_4a.mp3 -i vo_4b.mp3 \
  -i vo_5.mp3 \
  -filter_complex "\
    [0:a][1:a]acrossfade=d=4:c1=tri:c2=tri[bgx]; \
    [bgx]atrim=0:54.7,volume=0.14,afade=t=in:st=0:d=1,afade=t=out:st=53.2:d=1.5[bg]; \
    [2:a]afade=t=in:st=0:d=0.05,adelay=300|300[a1]; \
    [3:a]afade=t=in:st=0:d=0.05,adelay=4640|4640[a2]; \
    [4:a]afade=t=in:st=0:d=0.05,adelay=14800|14800[a3]; \
    [5:a]afade=t=in:st=0:d=0.05,adelay=23900|23900[a4]; \
    [6:a]afade=t=in:st=0:d=0.05,adelay=29200|29200[a5]; \
    [7:a]afade=t=in:st=0:d=0.05,adelay=33120|33120[a6]; \
    [8:a]afade=t=in:st=0:d=0.05,adelay=38500|38500[a7]; \
    [9:a]afade=t=in:st=0:d=0.05,adelay=43000|43000[a8]; \
    [10:a]afade=t=in:st=0:d=0.05,adelay=46400|46400[a9]; \
    [bg][a1][a2][a3][a4][a5][a6][a7][a8][a9]amix=inputs=10:duration=longest:normalize=0,alimiter=limit=0.95[out]" \
  -map "[out]" -t 54.7 -ar 44100 -b:a 192k composite_audio.mp3

echo "Wrote composite_audio.mp3"
