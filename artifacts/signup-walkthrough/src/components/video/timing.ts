// Deterministic caption timing helpers (mirrors the game-recap walkthrough).
//
// Captions are rendered as a function of a scene's local time `t` (ms since the
// scene mounted) so they fade in, hold, then fade out on timed beats instead of
// showing one long run-on caption for the whole scene.

export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Caption opacity: fades in after `start`, holds, then fades out before `end`. */
export function captionOpacity(t: number, start: number, end: number, fade = 320) {
  return clamp01((t - start) / fade) * clamp01((end - t) / fade);
}
