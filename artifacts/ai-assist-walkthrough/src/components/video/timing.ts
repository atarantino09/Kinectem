// Deterministic timing helpers for the scrubbable video.
//
// Every scene renders purely as a function of its local time `t` (ms since the
// scene started), so the whole video can be driven by one master clock and
// scrubbed to any frame. No mount-based timers or framer-motion entrance
// transitions for time-driven content — given the same `t`, a scene always
// renders the same frame.

export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export const easeInOut = (p: number) =>
  p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;

/** Scroll/zoom progress (0..1) for a pan that starts at `start` and runs `durMs`. */
export function panProgress(t: number, start: number, durMs: number) {
  return clamp01((t - start) / durMs);
}

/** Fade-in opacity that ramps 0->1 over `fade` ms from `start`, then holds at 1. */
export function fadeInOpacity(t: number, start: number, fade = 450) {
  return clamp01((t - start) / fade);
}

/** Caption opacity: fades in after `start`, holds, then fades out before `end`. */
export function captionOpacity(t: number, start: number, end: number, fade = 320) {
  return clamp01((t - start) / fade) * clamp01((end - t) / fade);
}
