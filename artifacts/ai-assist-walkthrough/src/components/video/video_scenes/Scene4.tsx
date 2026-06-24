import { Caption } from '../components/Chrome';
import { ScreenshotScene, ScreenshotPan } from '../components/UIHelpers';
import { fadeInOpacity, captionOpacity, panProgress } from '../timing';

// Scene 4 — insert the draft into the composer, then cross-fade to the
// published recap on the team page.
export function Scene4({ t }: { t: number }) {
  return (
    <ScreenshotScene opacity={fadeInOpacity(t, 0, 400)}>
      <ScreenshotPan
        src="composer-filled.png"
        progress={panProgress(t, 800, 16000)}
        opacity={fadeInOpacity(t, 0, 400)}
      />
      <ScreenshotPan
        src="recap-published.png"
        progress={panProgress(t, 6800, 18000)}
        opacity={fadeInOpacity(t, 6500, 500)}
      />

      <Caption
        text="Insert it, tweak anything you like, and hit post."
        opacity={captionOpacity(t, 0, 6500)}
      />
      <Caption
        text="Your players — and their families — get a recap worth remembering."
        opacity={captionOpacity(t, 6800, 13000)}
      />
    </ScreenshotScene>
  );
}
