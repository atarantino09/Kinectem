import { useState, useEffect } from 'react';
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

export function ScreenshotPan({
  src,
  anchor = 'top',
}: {
  src: string;
  anchor?: 'top' | 'center';
}) {
  return (
    <motion.img
      src={`${import.meta.env.BASE_URL}shots/${src}`}
      alt=""
      className={`absolute inset-0 w-full h-full object-cover bg-[#F4F4F5] ${
        anchor === 'top' ? 'object-top' : 'object-center'
      }`}
      initial={{ opacity: 0, scale: 1.0 }}
      animate={{ opacity: 1, scale: 1.05 }}
      exit={{ opacity: 0, scale: 1.07 }}
      transition={{ opacity: { duration: 0.7 }, scale: { duration: 11, ease: 'linear' } }}
    />
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