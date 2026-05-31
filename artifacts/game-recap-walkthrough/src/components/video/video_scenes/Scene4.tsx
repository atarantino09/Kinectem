import { Caption } from '../components/Chrome';
import { ScreenshotScene, ScreenshotPan } from '../components/UIHelpers';
import { panProgress, fadeInOpacity, captionOpacity } from '../timing';

export function Scene4({ t }: { t: number }) {
  return (
    <ScreenshotScene opacity={fadeInOpacity(t, 0, 500)}>
      {/* Ken-Burns stack: each shot fades in over the one before it. */}
      <ScreenshotPan
        src="filter-open.png"
        scroll={false}
        progress={panProgress(t, 0, 2500)}
        opacity={fadeInOpacity(t, 0, 300)}
      />
      <ScreenshotPan
        src="profile-filtered.png"
        scroll={false}
        progress={panProgress(t, 1500, 2500)}
        opacity={fadeInOpacity(t, 1500, 300)}
      />
      <ScreenshotPan
        src="profile-basketball.png"
        scroll={false}
        progress={panProgress(t, 3470, 2500)}
        opacity={fadeInOpacity(t, 3470, 300)}
      />
      <ScreenshotPan
        src="profile.png"
        scroll={false}
        progress={panProgress(t, 5300, 2500)}
        opacity={fadeInOpacity(t, 5300, 300)}
      />

      <Caption
        text="Filter the game recaps by team..."
        opacity={captionOpacity(t, 0, 3470)}
      />
      <Caption
        text="...or by sport. One profile, every team, every season."
        opacity={captionOpacity(t, 3470, 7500)}
      />
    </ScreenshotScene>
  );
}
