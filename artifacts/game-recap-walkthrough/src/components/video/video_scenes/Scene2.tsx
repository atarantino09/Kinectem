import { useState, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Caption } from '../components/Chrome';
import { ScreenshotScene, ScreenshotPan } from '../components/UIHelpers';

export function Scene2() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setPhase(2), 4500);
    return () => clearTimeout(t);
  }, []);

  return (
    <ScreenshotScene>
      <AnimatePresence>
        {phase < 2 ? (
          <ScreenshotPan key="team-page" src="team-page.png" />
        ) : (
          <ScreenshotPan key="org-page" src="org-page.png" />
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {phase < 2 ? (
          <Caption key="cap1" text="It publishes straight to the team page, building the team's story." />
        ) : (
          <Caption key="cap2" text="And it's showcased on your club's page, alongside every other team." />
        )}
      </AnimatePresence>
    </ScreenshotScene>
  );
}
