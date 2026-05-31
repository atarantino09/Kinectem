import { useState, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Caption } from '../components/Chrome';
import { ScreenshotScene, ScreenshotPan } from '../components/UIHelpers';

export function Scene3() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setPhase(3), 4200);
    return () => clearTimeout(t);
  }, []);

  return (
    <ScreenshotScene>
      <AnimatePresence>
        {phase < 3 ? (
          <ScreenshotPan key="recap" src="recap.png" duration={3.8} />
        ) : (
          <ScreenshotPan key="profile" src="profile.png" duration={5} />
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {phase < 3 ? (
          <Caption key="cap1" text="Every player on the roster gets tagged — automatically." />
        ) : (
          <Caption key="cap2" text="It lives on their profile forever — a growing, searchable storybook." />
        )}
      </AnimatePresence>
    </ScreenshotScene>
  );
}
