import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Caption } from '../components/Chrome';
import { AnimatedCursor, TypewriterText } from '../components/UIHelpers';
import { useElapsed } from '../useElapsed';
import { captionOpacity } from '../timing';

export function Scene3() {
  const [phase, setPhase] = useState(0);
  const t = useElapsed();

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),  // Type org name
      setTimeout(() => setPhase(2), 2000), // Sport select
      setTimeout(() => setPhase(3), 3500), // Logo drop
      setTimeout(() => setPhase(4), 5000), // Submit
      setTimeout(() => setPhase(5), 5500), // Dashboard transition
      setTimeout(() => setPhase(6), 6500), // Checklist appear
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 bg-[#F4F4F5] flex items-center justify-center p-12"
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, y: -100 }}
      transition={{ duration: 0.8, type: "spring" }}
    >
      <div className="absolute top-8 left-8">
        <img src={`${import.meta.env.BASE_URL}logo-horizontal.png`} alt="Kinectem" className="h-8 opacity-80" />
      </div>

      {/* Form State */}
      {phase < 5 && (
        <motion.div 
          className="w-full max-w-xl bg-white rounded-2xl shadow-[0_4px_24px_rgba(37,99,235,0.08)] border border-[#E4E4E7] p-10"
          exit={{ scale: 0.9, opacity: 0 }}
        >
          <h2 className="text-3xl font-display font-bold text-[#09090B] mb-8">Setup Organization</h2>
          
          <div className="space-y-6">
            <div className="flex gap-6">
              <div className="w-24 h-24 rounded-full border-2 border-dashed border-[#A1A1AA] flex items-center justify-center bg-gray-50 shrink-0 relative overflow-hidden">
                {phase >= 3 ? (
                  <motion.div 
                    initial={{ scale: 0 }} animate={{ scale: 1 }} 
                    className="absolute inset-0 bg-blue-100 flex items-center justify-center text-blue-600 font-bold"
                  >
                    Logo
                  </motion.div>
                ) : (
                  <span className="text-xs text-gray-400">Upload Logo</span>
                )}
              </div>
              <div className="flex-1 space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-[#09090B]">Organization Name</label>
                  <div className="w-full h-12 rounded-lg border border-[#E4E4E7] px-4 flex items-center">
                    {phase >= 1 && <TypewriterText text="Westside Youth Soccer" speed={30} />}
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-[#09090B]">Sport</label>
                  <div className={`w-full h-12 rounded-lg border px-4 flex items-center justify-between ${phase >= 2 ? 'border-blue-500 text-black' : 'border-[#E4E4E7] text-gray-400'}`}>
                    {phase >= 2 ? 'Soccer' : 'Select a sport...'}
                    <span className="text-xs">▼</span>
                  </div>
                </div>
              </div>
            </div>
            <motion.div 
              className="w-full h-12 bg-[linear-gradient(135deg,#2563EB_0%,#7C3AED_100%)] text-white rounded-lg flex items-center justify-center font-bold mt-8"
              animate={phase >= 4 ? { scale: 0.97 } : { scale: 1 }}
            >
              Create Organization
            </motion.div>
          </div>
        </motion.div>
      )}

      {/* Dashboard State */}
      {phase >= 5 && (
        <motion.div 
          className="absolute inset-0 bg-[#F4F4F5] p-12"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <div className="max-w-5xl mx-auto flex gap-8">
            {/* Sidebar fake */}
            <div className="w-64 h-[70vh] bg-white rounded-xl border border-[#E4E4E7] p-6 shadow-sm">
              <div className="h-8 w-32 bg-gray-200 rounded mb-8" />
              <div className="space-y-4">
                {[1,2,3,4].map(i => <div key={i} className="h-4 w-full bg-gray-100 rounded" />)}
              </div>
            </div>

            {/* Main content */}
            <div className="flex-1 space-y-8">
              <div className="h-24 bg-white rounded-xl border border-[#E4E4E7] shadow-sm flex items-center p-6 gap-6">
                 <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold">WYS</div>
                 <div>
                   <h2 className="text-2xl font-bold">Westside Youth Soccer</h2>
                   <p className="text-gray-500 text-sm">Dashboard</p>
                 </div>
              </div>

              {phase >= 6 && (
                <motion.div 
                  className="bg-white rounded-xl border border-[#E4E4E7] shadow-sm p-6"
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                >
                  <h3 className="font-bold text-lg mb-4">Getting Started (1/6)</h3>
                  <div className="w-full h-2 bg-gray-100 rounded-full mb-6 overflow-hidden">
                    <div className="h-full w-1/6 bg-green-500" />
                  </div>
                  
                  <div className="space-y-3">
                    {[
                      { text: "Add your logo", done: true },
                      { text: "Add your first team", done: false },
                      { text: "Add staff or send a staff invite", done: false },
                      { text: "Add a co-admin", done: false },
                      { text: "Add a roster entry", done: false },
                      { text: "Add a guardian or send a guardian invite", done: false },
                    ].map((item, i) => (
                      <motion.div 
                        key={i}
                        className="flex items-center gap-3 p-3 rounded-lg border border-gray-100"
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.1 }}
                      >
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center border ${item.done ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300'}`}>
                          {item.done && <span className="text-xs">✓</span>}
                        </div>
                        <span className={`text-sm ${item.done ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{item.text}</span>
                      </motion.div>
                    ))}
                  </div>
                </motion.div>
              )}
            </div>
          </div>
        </motion.div>
      )}

      <AnimatedCursor 
        x={phase < 1 ? '45vw' : phase < 2 ? '55vw' : phase < 3 ? '40vw' : phase < 4 ? '50vw' : '80vw'} 
        y={phase < 1 ? '45vh' : phase < 2 ? '55vh' : phase < 3 ? '40vh' : phase < 4 ? '70vh' : '80vh'} 
        isClicking={phase === 2 || phase === 4} 
      />

      <Caption
        text="Spin up your organization — name it, pick a sport, drop a logo."
        opacity={captionOpacity(t, 0, 5000)}
      />
      <Caption
        text="Your dashboard guides you through six setup steps."
        opacity={captionOpacity(t, 5000, 8000)}
      />
    </motion.div>
  );
}
