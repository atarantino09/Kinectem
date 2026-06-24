import { Caption } from '../components/Chrome';
import { ScreenshotScene, ScreenshotPan } from '../components/UIHelpers';
import { fadeInOpacity, captionOpacity, panProgress } from '../timing';

// Scene 2 — the AI Assist dialog with a few rough, unpolished notes typed in.
export function Scene2({ t }: { t: number }) {
  return (
    <ScreenshotScene opacity={fadeInOpacity(t, 0, 400)}>
      <ScreenshotPan
        src="ai-dialog-notes.png"
        scroll={false}
        progress={panProgress(t, 0, 8500)}
        opacity={fadeInOpacity(t, 0, 400)}
      />

      <Caption
        text="Just jot down what happened. A few rough notes is all it takes."
        opacity={captionOpacity(t, 0, 8500)}
      />
    </ScreenshotScene>
  );
}
