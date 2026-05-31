import { useState, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Caption } from '../components/Chrome';
import { ScreenshotScene, ScreenshotPan } from '../components/UIHelpers';

export function Scene2() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setPhase(2), 9100);
    return () => clearTimeout(t);
  }, []);

  return (
    <ScreenshotScene>
      <AnimatePresence>
        {phase < 2 ? (
          <ScreenshotPan key="team-page" src="team-page.png" duration={8.8} />
        ) : (
          <ScreenshotPan key="org-page" src="org-page.png" duration={8} />
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {phase < 2 ? (
          <Caption key="cap1" text="Every game recap publishes right to the team page. Season after season, those recaps build the team's story." />
        ) : (
          <Caption key="cap2" text="And it's showcased on your organization's page, alongside every team." />
        )}
      </AnimatePresence>
    </ScreenshotScene>
  );
}
