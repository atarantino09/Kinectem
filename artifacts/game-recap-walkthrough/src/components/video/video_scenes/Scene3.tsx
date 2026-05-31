import { useState, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Caption } from '../components/Chrome';
import { ScreenshotScene, ScreenshotPan } from '../components/UIHelpers';

export function Scene3() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setPhase(3), 3500);
    return () => clearTimeout(t);
  }, []);

  return (
    <ScreenshotScene>
      <AnimatePresence>
        {phase < 3 ? (
          <ScreenshotPan key="recap" src="recap.png" />
        ) : (
          <ScreenshotPan key="profile" src="profile.png" />
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {phase < 3 ? (
          <Caption key="cap1" text="Tag the players who made it happen." />
        ) : (
          <Caption key="cap2" text="And it lives forever on their profile — a growing digital storybook." />
        )}
      </AnimatePresence>
    </ScreenshotScene>
  );
}
