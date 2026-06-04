import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Caption } from '../components/Chrome';
import { AnimatedCursor, TypewriterText } from '../components/UIHelpers';
import { useElapsed } from '../useElapsed';
import { captionOpacity } from '../timing';

export function Scene4() {
  const [phase, setPhase] = useState(0);
  const t = useElapsed();

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),  // Type team name
      setTimeout(() => setPhase(2), 2000), // Add team
      setTimeout(() => setPhase(3), 3500), // Invite coach
      setTimeout(() => setPhase(4), 5000), // Add roster entry
      setTimeout(() => setPhase(5), 6500), // Guardian invite
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 bg-[#F4F4F5] p-12"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, y: -50 }}
      transition={{ duration: 0.8 }}
    >
      <div className="absolute top-8 left-8">
        <img src={`${import.meta.env.BASE_URL}logo-horizontal.png`} alt="Kinectem" className="h-8 opacity-80" />
      </div>

      <div className="max-w-4xl mx-auto pt-16">
        <h2 className="text-3xl font-bold mb-8">U12 Lions Setup</h2>

        <div className="grid grid-cols-2 gap-8">
          {/* Create Team Form */}
          <motion.div 
            className="bg-white rounded-xl shadow-sm border border-[#E4E4E7] p-6 space-y-4"
            animate={{ opacity: phase >= 0 ? 1 : 0 }}
          >
            <h3 className="font-bold text-lg border-b pb-2">1. Create Team</h3>
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase">Team Name</label>
              <div className="h-10 mt-1 rounded border px-3 flex items-center bg-gray-50">
                {phase >= 1 && <TypewriterText text="Lions" speed={40} />}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase">Season</label>
                <div className="h-10 mt-1 rounded border px-3 flex items-center bg-gray-50 text-sm">Fall 2024</div>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase">Age Group</label>
                <div className="h-10 mt-1 rounded border px-3 flex items-center bg-gray-50 text-sm">U12</div>
              </div>
            </div>
            <div className={`mt-4 h-10 rounded font-bold text-white flex items-center justify-center transition-colors ${phase >= 2 ? 'bg-green-500' : 'bg-blue-600'}`}>
              {phase >= 2 ? 'Team Created ✓' : 'Create Team'}
            </div>
          </motion.div>

          {/* Roster & Invites */}
          <div className="space-y-6">
            <motion.div 
              className="bg-white rounded-xl shadow-sm border border-[#E4E4E7] p-6 space-y-4 relative"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: phase >= 2 ? 1 : 0.5, x: 0 }}
            >
              <h3 className="font-bold text-lg border-b pb-2">2. Staff</h3>
              {phase >= 3 ? (
                 <div className="flex items-center justify-between bg-blue-50 p-3 rounded border border-blue-100">
                   <div className="flex items-center gap-3">
                     <div className="w-8 h-8 bg-blue-200 rounded-full flex items-center justify-center text-blue-700 font-bold text-xs">C</div>
                     <div>
                       <div className="text-sm font-bold text-blue-900">Coach Smith</div>
                       <div className="text-xs text-blue-600">Invite sent to coach@example.com</div>
                     </div>
                   </div>
                 </div>
              ) : (
                <div className="h-10 border border-dashed border-gray-300 rounded flex items-center justify-center text-gray-400 text-sm">
                  + Invite Coach
                </div>
              )}
            </motion.div>

            <motion.div 
              className="bg-white rounded-xl shadow-sm border border-[#E4E4E7] p-6 space-y-4"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: phase >= 3 ? 1 : 0.5, x: 0 }}
            >
              <h3 className="font-bold text-lg border-b pb-2">3. Roster</h3>
              
              {phase >= 4 ? (
                <div className="border rounded-lg overflow-hidden">
                  <div className="flex items-center p-3 border-b bg-gray-50">
                    <div className="w-8 h-8 bg-gray-200 rounded-full mr-3" />
                    <span className="font-bold text-sm">Alex Johnson</span>
                    <span className="ml-auto text-xs bg-gray-200 px-2 py-1 rounded">#10</span>
                  </div>
                  
                  {phase >= 5 ? (
                     <div className="p-3 bg-purple-50 text-purple-800 text-sm flex items-center gap-2">
                       <span className="text-green-500">✓</span> Guardian invite sent
                     </div>
                  ) : (
                    <div className="p-3 text-center text-sm text-blue-600 font-bold border-t cursor-pointer hover:bg-gray-50">
                      + Send Guardian Invite
                    </div>
                  )}
                </div>
              ) : (
                <div className="h-10 border border-dashed border-gray-300 rounded flex items-center justify-center text-gray-400 text-sm">
                  + Add Player
                </div>
              )}
            </motion.div>
          </div>
        </div>
      </div>

      <AnimatedCursor 
        x={phase < 2 ? '30vw' : phase < 3 ? '60vw' : phase < 4 ? '70vw' : phase < 5 ? '70vw' : '80vw'} 
        y={phase < 2 ? '65vh' : phase < 3 ? '45vh' : phase < 4 ? '80vh' : phase < 5 ? '70vh' : '90vh'} 
        isClicking={phase === 2 || phase === 3 || phase === 4 || phase === 5} 
      />

      <Caption
        text="Add your first team."
        opacity={captionOpacity(t, 0, 2400)}
      />
      <Caption
        text="Invite a coach, add a player, send the parent an invite."
        opacity={captionOpacity(t, 2400, 6000)}
      />
      <Caption
        text="Everyone's connected from day one."
        opacity={captionOpacity(t, 6000, 8000)}
      />
    </motion.div>
  );
}
