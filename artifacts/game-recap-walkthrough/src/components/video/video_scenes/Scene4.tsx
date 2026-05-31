import { Caption } from '../components/Chrome';
import { ScreenshotScene, ScreenshotPan } from '../components/UIHelpers';
import { panProgress, fadeInOpacity, captionOpacity } from '../timing';

export function Scene4({ t }: { t: number }) {
  return (
    <ScreenshotScene opacity={fadeInOpacity(t, 0, 500)}>
      {/* 1. Open the team filter on Sam's profile — held steady (no zoom). */}
      <ScreenshotPan
        src="filter-open.png"
        scroll={false}
        progress={0}
        opacity={fadeInOpacity(t, 0, 300)}
      />
      {/* 2. Filtered to Legacy Black 2014 — scroll down through the soccer
          recaps so the changed list is actually visible, not just the header.
          Bases are pre-compensated for ScreenshotPan's easeInOut so each list
          fades in at its "Posts & tagged in" filter row, not the header. */}
      <ScreenshotPan
        src="profile-filtered.png"
        scroll
        progress={0.32 + panProgress(t, 1800, 2400) * 0.35}
        opacity={fadeInOpacity(t, 1800, 350)}
      />
      {/* 3. Switched to Varsity Boys Basketball — a visibly different list. */}
      <ScreenshotPan
        src="profile-basketball.png"
        scroll
        progress={0.42 + panProgress(t, 3900, 2200) * 0.34}
        opacity={fadeInOpacity(t, 3900, 350)}
      />
      {/* 4. Back to every team, every season. */}
      <ScreenshotPan
        src="profile.png"
        scroll
        progress={0.20 + panProgress(t, 5800, 2400) * 0.28}
        opacity={fadeInOpacity(t, 5800, 350)}
      />

      <Caption
        text="Filter the game recaps by team..."
        opacity={captionOpacity(t, 0, 3700)}
      />
      <Caption
        text="...or by sport. One profile, every team, every season."
        opacity={captionOpacity(t, 3700, 7500)}
      />
    </ScreenshotScene>
  );
}
