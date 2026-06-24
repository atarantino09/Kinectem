import { Caption } from '../components/Chrome';
import { ScreenshotScene, ScreenshotPan } from '../components/UIHelpers';
import { fadeInOpacity, captionOpacity, panProgress } from '../timing';

// Scene 3 — the AI-drafted suggestion sitting in the dialog, ready to insert.
export function Scene3({ t }: { t: number }) {
  return (
    <ScreenshotScene opacity={fadeInOpacity(t, 0, 400)}>
      <ScreenshotPan
        src="ai-dialog-result.png"
        scroll={false}
        progress={panProgress(t, 0, 10000)}
        opacity={fadeInOpacity(t, 0, 400)}
      />

      <Caption
        text="AI Assist turns them into a polished, ready-to-share recap — in seconds."
        opacity={captionOpacity(t, 0, 10000)}
      />
    </ScreenshotScene>
  );
}
