import { useEffect, useRef, useState } from 'react';
import VideoTemplate from './VideoTemplate';

// Deterministic frame-capture harness. Mounted only when the page is loaded with
// `?capture` (see App.tsx). It renders VideoTemplate at a window-controlled
// currentMs with the background frozen, so an external Playwright script can step
// the playhead frame-by-frame and screenshot perfectly smooth, evenly-spaced
// frames (the real-time recordVideo path drops frames during fast pans).
//
// Protocol:
//   window.__captureReady === true   once all scene screenshots are preloaded
//   await window.__setFrame(ms, isPoster?)   renders that frame, resolves after paint

const SHOTS = [
  'composer-empty.png',
  'ai-dialog-notes.png',
  'ai-dialog-result.png',
  'composer-filled.png',
  'recap-published.png',
];

declare global {
  interface Window {
    __captureReady?: boolean;
    __setFrame?: (ms: number, isPoster?: boolean) => Promise<void>;
  }
}

export default function CaptureHarness() {
  const [frame, setFrame] = useState({ ms: 0, poster: false });
  const resolveRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    window.__setFrame = (ms: number, isPoster = false) =>
      new Promise<void>((resolve) => {
        resolveRef.current = resolve;
        setFrame({ ms, poster: isPoster });
      });

    // Preload every scene screenshot so each scene's <img> is already cached and
    // measures its scroll height synchronously on mount (no stale maxScroll=0).
    const base = import.meta.env.BASE_URL;
    Promise.all(
      SHOTS.map(
        (s) =>
          new Promise<void>((res) => {
            const img = new Image();
            img.onload = () => res();
            img.onerror = () => res();
            img.src = `${base}shots/${s}`;
          }),
      ),
    ).then(() => {
      window.__captureReady = true;
    });

    return () => {
      delete window.__setFrame;
      delete window.__captureReady;
    };
  }, []);

  // Resolve the pending __setFrame promise once the new frame has been committed
  // and painted (double rAF ⇒ after layout + paint of this render).
  useEffect(() => {
    const id1 = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolveRef.current?.();
        resolveRef.current = null;
      });
    });
    return () => cancelAnimationFrame(id1);
  }, [frame]);

  return (
    <VideoTemplate
      currentMs={frame.ms}
      playing={false}
      muted
      poster={frame.poster}
      freezeBg
    />
  );
}
