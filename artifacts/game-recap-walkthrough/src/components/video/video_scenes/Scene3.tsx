import { Caption } from '../components/Chrome';
import { ScreenshotScene, ScreenshotPan } from '../components/UIHelpers';
import { panProgress, fadeInOpacity, captionOpacity } from '../timing';

export function Scene3({ t }: { t: number }) {
  return (
    <ScreenshotScene opacity={fadeInOpacity(t, 0, 500)}>
      <ScreenshotPan
        src="recap.png"
        progress={panProgress(t, 0, 3800)}
        opacity={fadeInOpacity(t, 0, 400)}
      />
      <ScreenshotPan
        src="profile.png"
        progress={panProgress(t, 4200, 5000)}
        opacity={fadeInOpacity(t, 4200, 500)}
      />

      <Caption
        text="Every player on the roster gets tagged — automatically."
        opacity={captionOpacity(t, 0, 4200)}
      />
      <Caption
        text="It lives on their profile forever — a growing, searchable storybook."
        opacity={captionOpacity(t, 4200, 9600)}
      />
    </ScreenshotScene>
  );
}
