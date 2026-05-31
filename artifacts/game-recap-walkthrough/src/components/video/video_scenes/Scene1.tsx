import { useState, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Caption } from '../components/Chrome';
import { ScreenshotScene, ScreenshotPan } from '../components/UIHelpers';

export function Scene1() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setPhase(2), 4600);
    return () => clearTimeout(t);
  }, []);

  return (
    <ScreenshotScene>
      <AnimatePresence>
        {phase < 2 ? (
          <ScreenshotPan key="team-page" src="team-page.png" duration={4} />
        ) : (
          <ScreenshotPan key="composer" src="composer.png" duration={9} />
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {phase < 2 ? (
          <Caption key="cap1" text="Every season tells a story. It starts on your team's page." />
        ) : (
          <Caption key="cap2" text="Your coach writes the game recap — going way past the box score." />
        )}
      </AnimatePresence>
    </ScreenshotScene>
  );
}
