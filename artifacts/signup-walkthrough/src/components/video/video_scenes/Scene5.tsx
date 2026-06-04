import { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Caption } from '../components/Chrome';
import { AnimatedCursor, TypewriterText } from '../components/UIHelpers';
import { useElapsed } from '../useElapsed';
import { captionOpacity } from '../timing';

export function Scene5() {
  const [phase, setPhase] = useState(0);
  const t = useElapsed();

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),  // Open recap
      setTimeout(() => setPhase(2), 1500), // Fill opponent/score
      setTimeout(() => setPhase(3), 3000), // Fill text
      setTimeout(() => setPhase(4), 4500), // Publish
      setTimeout(() => setPhase(5), 5000), // Pin appears
      setTimeout(() => setPhase(6), 7500), // End card
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 bg-[#F4F4F5] flex flex-col relative overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.8 }}
    >
      <div className="absolute top-8 left-8 z-20">
        <img src={`${import.meta.env.BASE_URL}logo-horizontal.png`} alt="Kinectem" className="h-8 opacity-80" />
      </div>

      {/* Team Page BG */}
      <div className="h-48 bg-gradient-to-r from-blue-900 to-purple-900 relative">
        <div className="absolute bottom-4 left-12 flex items-end gap-6">
          <div className="w-24 h-24 bg-white rounded-xl shadow-lg flex items-center justify-center text-3xl font-bold text-blue-900 border-4 border-[#F4F4F5]">L</div>
          <div className="text-white pb-2">
            <h1 className="text-3xl font-bold font-display">U12 Lions</h1>
            <p className="opacity-80 text-sm">Fall 2024 Season</p>
          </div>
        </div>
      </div>

      <div className="flex-1 max-w-5xl w-full mx-auto w-full p-8 flex gap-8">
        {/* Main Feed */}
        <div className="flex-1 space-y-6">
          {/* Composer */}
          <motion.div 
            className="bg-white rounded-xl shadow-sm border border-[#E4E4E7] overflow-hidden"
            animate={phase >= 4 ? { opacity: 0.5, height: 60 } : { opacity: 1, height: 'auto' }}
          >
            {phase < 1 ? (
              <div className="p-4 flex items-center gap-4 text-gray-400 font-bold">
                <div className="w-8 h-8 rounded-full bg-gray-100" />
                Write a post...
                <div className="ml-auto flex gap-2">
                  <span className="px-3 py-1 bg-purple-50 text-purple-700 text-xs rounded-full">Recap</span>
                </div>
              </div>
            ) : (
              <div className="p-6 space-y-4">
                <h3 className="font-bold text-lg">Game Recap</h3>
                <div className="flex gap-4">
                  <div className="flex-1">
                    <label className="text-xs font-bold text-gray-500 uppercase">Opponent</label>
                    <div className="h-10 mt-1 border rounded px-3 flex items-center bg-gray-50 text-sm">
                      {phase >= 2 && <TypewriterText text="Westside Wolves" speed={20} />}
                    </div>
                  </div>
                  <div className="w-1/3">
                    <label className="text-xs font-bold text-gray-500 uppercase">Final Score</label>
                    <div className="h-10 mt-1 border rounded px-3 flex items-center bg-gray-50 text-sm">
                      {phase >= 2 && <TypewriterText text="Lions 4 - Wolves 2" speed={20} />}
                    </div>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase">Headline</label>
                  <div className="h-10 mt-1 border-b px-2 flex items-center text-lg font-bold">
                    {phase >= 3 && <TypewriterText text="Lions roar back in second half" speed={20} />}
                  </div>
                </div>
                <div>
                  <div className="h-20 mt-1 text-sm text-gray-600 p-2 leading-relaxed">
                    {phase >= 3 && <TypewriterText text="After going down early, the team rallied together for 4 unanswered goals. Great effort all around, especially from the defense." speed={10} />}
                  </div>
                </div>
                <div className="flex justify-end pt-4 border-t mt-4">
                  <motion.div 
                    className="px-6 py-2 bg-blue-600 text-white font-bold rounded-lg"
                    animate={phase >= 4 ? { scale: 0.95 } : { scale: 1 }}
                  >
                    Publish
                  </motion.div>
                </div>
              </div>
            )}
          </motion.div>

          {/* Published Post */}
          {phase >= 5 && (
            <motion.div 
              className="bg-white rounded-xl shadow-md border border-[#E4E4E7] overflow-hidden"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <div className="bg-purple-50 px-4 py-2 border-b flex justify-between items-center">
                <span className="text-xs font-bold text-purple-700 flex items-center gap-1">📌 Pinned Recap</span>
                <span className="text-xs font-bold text-gray-500">Lions 4 - Wolves 2</span>
              </div>
              <div className="p-6">
                <h3 className="text-xl font-display font-bold mb-2">Lions roar back in second half</h3>
                <p className="text-sm text-gray-600">After going down early, the team rallied together for 4 unanswered goals. Great effort all around, especially from the defense.</p>
              </div>
            </motion.div>
          )}
        </div>

        {/* Sidebar */}
        <div className="w-64 space-y-6 opacity-50">
          <div className="bg-white p-4 rounded-xl border">
            <h4 className="font-bold text-sm mb-4">Roster</h4>
            <div className="space-y-2">
              {[1,2,3].map(i => <div key={i} className="h-8 bg-gray-100 rounded flex items-center px-2 text-xs text-gray-400">Player {i}</div>)}
            </div>
          </div>
        </div>
      </div>

      <AnimatedCursor 
        x={phase < 1 ? '70vw' : phase < 4 ? '60vw' : phase < 5 ? '65vw' : '90vw'} 
        y={phase < 1 ? '30vh' : phase < 4 ? '50vh' : phase < 5 ? '80vh' : '90vh'} 
        isClicking={phase === 1 || phase === 4} 
      />

      {/* End Card */}
      <AnimatePresence>
        {phase >= 6 && (
          <motion.div 
            className="absolute inset-0 bg-white z-50 flex flex-col items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <img src={`${import.meta.env.BASE_URL}logo-horizontal.png`} alt="Kinectem" className="h-16 mb-8" />
            <h2 className="text-4xl font-display font-bold text-[#09090B] mb-4 text-transparent bg-clip-text bg-[linear-gradient(135deg,#2563EB_0%,#7C3AED_100%)]">
              Where youth sports come together
            </h2>
            <p className="text-xl text-[#71717A] font-bold">Start your org at kinectem.com</p>
          </motion.div>
        )}
      </AnimatePresence>

      {phase < 6 && (
        <>
          <Caption
            text="Game day? Publish a recap from the team page."
            opacity={captionOpacity(t, 0, 3000)}
          />
          <Caption
            text="Score, headline, write-up — done."
            opacity={captionOpacity(t, 3000, 5000)}
          />
          <Caption
            text="It's pinned to the team, ready for parents and players."
            opacity={captionOpacity(t, 5000, 7500)}
          />
        </>
      )}
    </motion.div>
  );
}
