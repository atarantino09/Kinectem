import { useState, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Caption } from '../components/Chrome';
import { ScreenshotScene, ScreenshotPan } from '../components/UIHelpers';

export function Scene1() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setPhase(2), 2000);
    return () => clearTimeout(t);
  }, []);

  return (
    <ScreenshotScene>
      <AnimatePresence>
        {phase < 2 ? (
          <ScreenshotPan key="team-page" src="team-page.png" />
        ) : (
          <ScreenshotPan key="composer" src="composer.png" />
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {phase < 2 ? (
          <Caption key="cap1" text="Every season has a story. It starts on your team's page." />
        ) : (
          <Caption key="cap2" text="Write the recap. Go deeper than a box score — tell what really happened." />
        )}
      </AnimatePresence>
    </ScreenshotScene>
  );
}
