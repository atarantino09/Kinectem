import { useCallback, useEffect, useRef, useState } from 'react';

interface UsePlayheadOptions {
  autoPlay?: boolean;
  loop?: boolean;
  onEnded?: () => void;
}

/**
 * A single master clock for the video. Owns the current time (ms) and play
 * state, advancing via requestAnimationFrame while playing. `seek` jumps the
 * clock anywhere (frame-accurate scrubbing); the rendered scene and the audio
 * are both derived from `currentMs`, so they stay in lockstep.
 */
export function usePlayhead(totalMs: number, options: UsePlayheadOptions = {}) {
  const { autoPlay = false, loop = false, onEnded } = options;

  const [currentMs, setCurrentMsState] = useState(0);
  const [playing, setPlayingState] = useState(autoPlay);

  const currentRef = useRef(0);
  const playingRef = useRef(autoPlay);
  const lastTsRef = useRef<number | null>(null);
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;

  const setCurrent = useCallback((ms: number) => {
    currentRef.current = ms;
    setCurrentMsState(ms);
  }, []);
  const setPlaying = useCallback((v: boolean) => {
    playingRef.current = v;
    setPlayingState(v);
  }, []);

  useEffect(() => {
    let raf = 0;
    const tick = (ts: number) => {
      if (lastTsRef.current == null) lastTsRef.current = ts;
      const dt = ts - lastTsRef.current;
      lastTsRef.current = ts;

      if (playingRef.current) {
        let next = currentRef.current + dt;
        if (next >= totalMs) {
          if (loop) {
            next = next % totalMs;
            setCurrent(next);
          } else {
            setCurrent(totalMs);
            setPlaying(false);
            onEndedRef.current?.();
          }
        } else {
          setCurrent(next);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      lastTsRef.current = null;
    };
  }, [totalMs, loop, setCurrent, setPlaying]);

  const play = useCallback(() => {
    if (currentRef.current >= totalMs) setCurrent(0);
    setPlaying(true);
  }, [totalMs, setCurrent, setPlaying]);

  const pause = useCallback(() => setPlaying(false), [setPlaying]);

  const toggle = useCallback(() => {
    if (playingRef.current) setPlaying(false);
    else play();
  }, [play, setPlaying]);

  const seek = useCallback(
    (ms: number) => setCurrent(Math.max(0, Math.min(totalMs, ms))),
    [totalMs, setCurrent],
  );

  return { currentMs, playing, totalMs, play, pause, toggle, seek };
}
