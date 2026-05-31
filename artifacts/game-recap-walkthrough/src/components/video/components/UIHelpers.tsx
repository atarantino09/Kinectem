import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

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

export function ScreenshotScene({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      className="absolute inset-0 bg-[#F4F4F5] overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.6 }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Renders a full-page screenshot at full frame width and slowly scrolls it
 * top -> bottom over `duration` seconds so the whole page is revealed.
 * When `scroll` is false (short beats like the filter dropdown) the image is
 * pinned to the top with a gentle Ken-Burns zoom instead.
 */
export function ScreenshotPan({
  src,
  scroll = true,
  duration = 7,
}: {
  src: string;
  scroll?: boolean;
  duration?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [maxScroll, setMaxScroll] = useState(0);

  // Reset measured overflow when the screenshot swaps so a cached image load
  // can't carry stale scroll distance from the previous beat.
  useEffect(() => {
    setMaxScroll(0);
  }, [src]);

  const measure = (img: HTMLImageElement) => {
    const container = containerRef.current;
    if (!container) return;
    // Image is rendered at full width (h-auto), so clientHeight already
    // reflects its scaled-to-fit-width height.
    const overflow = img.clientHeight - container.clientHeight;
    setMaxScroll(overflow > 0 ? overflow : 0);
  };

  return (
    <motion.div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden bg-white"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.6 }}
    >
      {scroll ? (
        <motion.img
          src={`${import.meta.env.BASE_URL}shots/${src}`}
          alt=""
          className="w-full h-auto block"
          onLoad={(e) => measure(e.currentTarget)}
          initial={{ y: 0 }}
          animate={{ y: maxScroll > 0 ? -maxScroll : 0 }}
          transition={{ y: { duration, ease: 'easeInOut' } }}
        />
      ) : (
        <motion.img
          src={`${import.meta.env.BASE_URL}shots/${src}`}
          alt=""
          className="absolute inset-x-0 top-0 w-full h-auto block"
          initial={{ scale: 1.0 }}
          animate={{ scale: 1.04 }}
          transition={{ scale: { duration, ease: 'linear' } }}
        />
      )}
    </motion.div>
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