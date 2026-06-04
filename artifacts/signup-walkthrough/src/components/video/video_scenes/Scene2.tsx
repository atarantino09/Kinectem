import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Caption } from '../components/Chrome';
import { AnimatedCursor, TypewriterText } from '../components/UIHelpers';
import { useElapsed } from '../useElapsed';
import { captionOpacity } from '../timing';

export function Scene2() {
  const [phase, setPhase] = useState(0);
  const t = useElapsed();

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),  // Type email
      setTimeout(() => setPhase(2), 2000), // Type pass
      setTimeout(() => setPhase(3), 3500), // Select role
      setTimeout(() => setPhase(4), 5000), // Click signup
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 bg-[#F4F4F5] flex items-center justify-center p-12"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, x: -100 }}
      transition={{ duration: 0.8, type: "spring" }}
    >
      <div className="absolute top-8 left-8">
        <img src={`${import.meta.env.BASE_URL}logo-horizontal.png`} alt="Kinectem" className="h-8 opacity-80" />
      </div>

      <motion.div 
        className="w-full max-w-md bg-white rounded-2xl shadow-[0_4px_24px_rgba(37,99,235,0.08)] border border-[#E4E4E7] p-10 relative overflow-hidden"
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5 }}
      >
        <div className="absolute top-0 left-0 w-full h-1 bg-[linear-gradient(135deg,#2563EB_0%,#7C3AED_100%)]" />
        
        <h2 className="text-3xl font-display font-bold text-[#09090B] mb-2">Create Account</h2>
        <p className="text-[#71717A] font-body mb-8">Join Kinectem to manage your organization</p>

        <div className="space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-bold text-[#09090B]">Email</label>
            <div className="w-full h-12 rounded-lg border border-[#E4E4E7] bg-white px-4 flex items-center text-lg">
              {phase >= 1 && <TypewriterText text="admin@youthsports.org" speed={30} />}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-bold text-[#09090B]">Password</label>
            <div className="w-full h-12 rounded-lg border border-[#E4E4E7] bg-white px-4 flex items-center text-lg">
              {phase >= 2 && <TypewriterText text="••••••••••••" speed={20} />}
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-sm font-bold text-[#09090B]">I am a...</label>
            <div className="grid grid-cols-2 gap-3">
              {['Coach', 'Parent', 'Admin', 'Player'].map((role) => (
                <div 
                  key={role} 
                  className={`h-12 rounded-lg border flex items-center justify-center font-bold text-sm transition-colors ${role === 'Admin' && phase >= 3 ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-[#E4E4E7] text-[#71717A]'}`}
                >
                  {role}
                </div>
              ))}
            </div>
          </div>

          <motion.div 
            className="w-full h-12 bg-[#09090B] text-white rounded-lg flex items-center justify-center font-bold mt-4"
            animate={phase >= 4 ? { scale: 0.97, backgroundColor: '#111115' } : { scale: 1 }}
          >
            Create Account
          </motion.div>
        </div>
      </motion.div>

      <AnimatedCursor 
        x={phase < 1 ? '40vw' : phase < 3 ? '45vw' : phase < 4 ? '55vw' : '50vw'} 
        y={phase < 1 ? '70vh' : phase < 3 ? '55vh' : phase < 4 ? '60vh' : '75vh'} 
        isClicking={phase === 3 || phase === 4} 
      />

      <Caption
        text="Create your account."
        opacity={captionOpacity(t, 0, 3500)}
      />
      <Caption
        text="Pick a role and you're in."
        opacity={captionOpacity(t, 3500, 7000)}
      />
    </motion.div>
  );
}
