import { useState, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Caption } from '../components/Chrome';
import { ScreenshotScene, ScreenshotPan } from '../components/UIHelpers';

const SHOTS = [
  'filter-open.png', // dropdown showing all three teams/sports
  'profile-filtered.png', // filtered to the soccer team
  'profile-basketball.png', // filtered to the basketball team
  'profile.png', // back to every sport, combined timeline
];

export function Scene4() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 1500), // soccer
      setTimeout(() => setPhase(2), 3470), // basketball (caption switches here)
      setTimeout(() => setPhase(3), 5300), // every sport, combined
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <ScreenshotScene>
      <AnimatePresence>
        <ScreenshotPan key={SHOTS[phase]} src={SHOTS[phase]} scroll={false} duration={2.5} />
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {phase < 2 ? (
          <Caption key="cap1" text="Filter the game recaps by team..." />
        ) : (
          <Caption key="cap2" text="...or by sport. One profile, every team, every season." />
        )}
      </AnimatePresence>
    </ScreenshotScene>
  );
}
