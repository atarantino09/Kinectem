import { Caption } from '../components/Chrome';
import { ScreenshotScene, ScreenshotPan } from '../components/UIHelpers';
import { panProgress, fadeInOpacity, captionOpacity } from '../timing';

// Scene 1 — the blank recap composer. Sets up the problem: writing a great
// recap takes time, and there's an AI Assist button sitting right there.
export function Scene1({ t }: { t: number }) {
  return (
    <ScreenshotScene opacity={fadeInOpacity(t, 0, 500)}>
      <ScreenshotPan
        src="composer-empty.png"
        progress={panProgress(t, 800, 20000)}
        opacity={fadeInOpacity(t, 0, 400)}
      />

      <Caption
        text="A great game recap takes time — and right after the final whistle, that's the last thing a coach has."
        opacity={captionOpacity(t, 0, 6800)}
      />
      <Caption
        text="So Kinectem built AI Assist right into the recap composer."
        opacity={captionOpacity(t, 6800, 13000)}
      />
    </ScreenshotScene>
  );
}
