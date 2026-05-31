import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { clamp01, easeInOut } from '../timing';

interface TypewriterTextProps {
  text: string;
  delay?: number;
  speed?: number;
  className?: string;
  onComplete?: () => void;
}

export function TypewriterText({ text, delay = 0, speed = 50, className = '', onComplete }: TypewriterTextProps) {
  const [displayedText, setDisplayedText] = useState('');

  useEffect(() => {
    let timeout: NodeJS.Timeout;

    // Initial delay
    const startTimeout = setTimeout(() => {
      let currentIndex = 0;

      const typeNextChar = () => {
        if (currentIndex < text.length) {
          setDisplayedText(text.slice(0, currentIndex + 1));
          currentIndex++;
          timeout = setTimeout(typeNextChar, speed);
        } else if (onComplete) {
          onComplete();
        }
      };

      typeNextChar();
    }, delay);

    return () => {
      clearTimeout(startTimeout);
      clearTimeout(timeout);
    };
  }, [text, delay, speed, onComplete]);

  return (
    <span className={className}>
      {displayedText}
      <motion.span
        animate={{ opacity: [1, 0] }}
        transition={{ duration: 0.5, repeat: Infinity, repeatType: "reverse" }}
        className="inline-block w-[2px] h-[1em] bg-blue-500 align-middle ml-1"
      />
    </span>
  );
}

export function ScreenshotScene({
  children,
  opacity = 1,
}: {
  children: React.ReactNode;
  opacity?: number;
}) {
  return (
    <div
      className="absolute inset-0 bg-[#F4F4F5] overflow-hidden"
      style={{ opacity }}
    >
      {children}
    </div>
  );
}

/**
 * Renders a full-page screenshot at full frame width. Fully controlled by the
 * master clock: `progress` (0..1) drives the scroll (or Ken-Burns zoom when
 * `scroll` is false) and `opacity` drives the cross-fade. No internal timers —
 * the same props always produce the same frame, so it scrubs cleanly.
 */
export function ScreenshotPan({
  src,
  scroll = true,
  progress,
  opacity = 1,
}: {
  src: string;
  scroll?: boolean;
  progress: number;
  opacity?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [maxScroll, setMaxScroll] = useState(0);

  const measure = useCallback(() => {
    const img = imgRef.current;
    const container = containerRef.current;
    if (!img || !container) return;
    // Image is rendered at full width (h-auto), so clientHeight already
    // reflects its scaled-to-fit-width height.
    const overflow = img.clientHeight - container.clientHeight;
    setMaxScroll(overflow > 0 ? overflow : 0);
  }, []);

  // Measure on mount and whenever the screenshot swaps. Critically this covers
  // the cached-image case: when the <img> is already `complete` before React
  // attaches the onLoad handler (e.g. opening the video in a fresh tab with a
  // warm cache), onLoad never fires — so we measure synchronously here instead.
  // Otherwise reset to 0 so a cached load can't carry stale scroll distance.
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalHeight > 0) measure();
    else setMaxScroll(0);
  }, [src, measure]);

  // Re-measure when the viewport changes (iframe preview vs full browser tab).
  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  const p = clamp01(progress);
  const y = scroll ? -(maxScroll * easeInOut(p)) : 0;
  const scale = scroll ? 1 : 1 + 0.04 * p;

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden bg-white"
      style={{ opacity }}
    >
      <img
        ref={imgRef}
        src={`${import.meta.env.BASE_URL}shots/${src}`}
        alt=""
        onLoad={measure}
        className={scroll ? 'w-full h-auto block' : 'absolute inset-x-0 top-0 w-full h-auto block'}
        style={{
          transform: scroll ? `translateY(${y}px)` : `scale(${scale})`,
          transformOrigin: 'top center',
          willChange: 'transform',
        }}
      />
    </div>
  );
}

export function AnimatedCursor({ 
  x, 
  y, 
  isClicking = false 
}: { 
  x: string | number; 
  y: string | number; 
  isClicking?: boolean;
}) {
  return (
    <motion.div
      className="absolute top-0 left-0 z-50 pointer-events-none"
      animate={{ x, y }}
      transition={{ type: "spring", stiffness: 150, damping: 20 }}
    >
      <motion.div
        animate={{ scale: isClicking ? 0.8 : 1 }}
        transition={{ duration: 0.1 }}
      >
        <svg width="24" height="36" viewBox="0 0 24 36" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M5.65376 2.00004L22.6538 18.0001L14.6538 19.5001L18.6538 30.0001L13.1538 32.5001L9.15376 22.0001L1.65376 28.5001L5.65376 2.00004Z" fill="black" stroke="white" strokeWidth="2" strokeLinejoin="round"/>
        </svg>
      </motion.div>
      {isClicking && (
        <motion.div
          className="absolute top-0 left-0 w-8 h-8 rounded-full border-2 border-blue-500"
          initial={{ scale: 0.5, opacity: 1 }}
          animate={{ scale: 2, opacity: 0 }}
          transition={{ duration: 0.4 }}
          style={{ x: '-20%', y: '-20%' }}
        />
      )}
    </motion.div>
  );
}
