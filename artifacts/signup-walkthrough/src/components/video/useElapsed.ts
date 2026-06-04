import { useEffect, useRef, useState } from 'react';

// Local per-scene clock: milliseconds elapsed since the component mounted.
// Drives timed caption fades (see timing.ts). Resets on remount, which matches
// how scenes remount on each loop / scene change.
export function useElapsed() {
  const [ms, setMs] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    let raf = 0;
    const tick = (now: number) => {
      if (startRef.current === null) startRef.current = now;
      setMs(now - startRef.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return ms;
}
