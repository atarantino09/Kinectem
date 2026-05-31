#!/usr/bin/env bash
# Rebuild public/audio/composite_audio.mp3 from the per-line VO clips + bg music.
#
# The game-recap walkthrough is a React-rendered video: VideoTemplate plays this
# single composite track and seeks to each scene's cumulative start time. So the
# VO clips must sit at fixed absolute offsets that match SCENE_DURATIONS in
# VideoTemplate.tsx. Keep this script and those durations in lockstep.
#
# Timeline (seconds): scene starts 0 / 14.5 / 27.7 / 37.3 / 44.8, total 53.5.
set -euo pipefail
cd "$(dirname "$0")/../public/audio"

ffmpeg -y \
  -stream_loop -1 -i bg_music.mp3 \
  -i vo_1a.mp3 -i vo_1b.mp3 \
  -i vo_2a.mp3 -i vo_2b.mp3 \
  -i vo_3a.mp3 -i vo_3b.mp3 \
  -i vo_4a.mp3 -i vo_4b.mp3 \
  -i vo_5.mp3 \
  -filter_complex "\
    [0:a]atrim=0:53.5,volume=0.14,afade=t=in:st=0:d=1,afade=t=out:st=52:d=1.5[bg]; \
    [1:a]adelay=300|300[a1]; \
    [2:a]adelay=4640|4640[a2]; \
    [3:a]adelay=14800|14800[a3]; \
    [4:a]adelay=22720|22720[a4]; \
    [5:a]adelay=28000|28000[a5]; \
    [6:a]adelay=31920|31920[a6]; \
    [7:a]adelay=37600|37600[a7]; \
    [8:a]adelay=40770|40770[a8]; \
    [9:a]adelay=45200|45200[a9]; \
    [bg][a1][a2][a3][a4][a5][a6][a7][a8][a9]amix=inputs=10:duration=longest:normalize=0,alimiter=limit=0.95[out]" \
  -map "[out]" -t 53.5 -ar 44100 -b:a 192k composite_audio.mp3

echo "Wrote composite_audio.mp3"
