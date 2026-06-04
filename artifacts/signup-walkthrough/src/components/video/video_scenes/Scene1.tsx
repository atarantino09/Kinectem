import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Caption } from '../components/Chrome';
import { AnimatedCursor } from '../components/UIHelpers';
import { useElapsed } from '../useElapsed';
import { captionOpacity } from '../timing';

export function Scene1() {
  const [phase, setPhase] = useState(0);
  const t = useElapsed();

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1500),
      setTimeout(() => setPhase(3), 2500),
      setTimeout(() => setPhase(4), 4000),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 bg-[linear-gradient(160deg,#EEF2FF_0%,#F5F3FF_40%,#EDE9FE_100%)] flex flex-col items-center justify-center p-12"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.1 }}
      transition={{ duration: 0.8 }}
    >
      <div className="absolute top-8 left-8">
        <img src={`${import.meta.env.BASE_URL}logo-horizontal.png`} alt="Kinectem" className="h-8 opacity-80" />
      </div>

      <motion.div 
        className="max-w-4xl w-full text-center space-y-8"
        initial={{ y: 50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2, duration: 0.8 }}
      >
        <motion.div 
          className="inline-block px-6 py-2 rounded-full bg-white shadow-sm border border-blue-100 text-sm font-bold text-blue-600 tracking-widest uppercase mb-4"
          animate={{ scale: phase >= 1 ? 1 : 0.8, opacity: phase >= 1 ? 1 : 0 }}
          transition={{ type: 'spring', bounce: 0.5 }}
        >
          For Youth Sports Admins
        </motion.div>

        <motion.h1 
          className="text-6xl md:text-7xl font-display font-bold text-[#09090B] tracking-tight leading-[1.1]"
          animate={{ opacity: phase >= 1 ? 1 : 0, y: phase >= 1 ? 0 : 20 }}
          transition={{ delay: 0.2, duration: 0.6 }}
        >
          Where youth sports <br/>
          <span className="text-transparent bg-clip-text bg-[linear-gradient(135deg,#2563EB_0%,#7C3AED_100%)]">come together</span>
        </motion.h1>

        <motion.p 
          className="text-xl text-[#71717A] max-w-2xl mx-auto font-body"
          animate={{ opacity: phase >= 2 ? 1 : 0 }}
          transition={{ duration: 0.5 }}
        >
          Manage teams, communicate with parents, and celebrate athletes. 
          Everything you need in one place.
        </motion.p>

        <motion.div 
          className="pt-8 flex justify-center"
          animate={{ opacity: phase >= 3 ? 1 : 0, y: phase >= 3 ? 0 : 20 }}
          transition={{ duration: 0.5 }}
        >
          <motion.div 
            className="px-8 py-4 bg-[linear-gradient(135deg,#2563EB_0%,#7C3AED_100%)] text-white rounded-xl font-bold font-display tracking-wide shadow-[0_8px_32px_rgba(124,58,237,0.3)]"
            animate={phase >= 4 ? { scale: 0.95 } : { scale: 1 }}
            transition={{ duration: 0.1 }}
          >
            Get Started
          </motion.div>
        </motion.div>
      </motion.div>

      <AnimatedCursor 
        x={phase < 3 ? '50vw' : '50vw'} 
        y={phase < 3 ? '70vh' : '55vh'} 
        isClicking={phase >= 4} 
      />

      <Caption
        text="Meet Kinectem — built for youth-sports admins."
        opacity={captionOpacity(t, 0, 3400)}
      />
      <Caption
        text="Getting started takes minutes."
        opacity={captionOpacity(t, 3400, 6000)}
      />
    </motion.div>
  );
}
