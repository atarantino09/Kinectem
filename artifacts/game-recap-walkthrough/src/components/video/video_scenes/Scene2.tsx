import { Caption } from '../components/Chrome';
import { ScreenshotScene, ScreenshotPan } from '../components/UIHelpers';
import { panProgress, fadeInOpacity, captionOpacity } from '../timing';

export function Scene2({ t }: { t: number }) {
  return (
    <ScreenshotScene opacity={fadeInOpacity(t, 0, 500)}>
      <ScreenshotPan
        src="team-page.png"
        progress={panProgress(t, 0, 8800)}
        opacity={fadeInOpacity(t, 0, 400)}
      />
      {/* Org page scrolls deliberately slowly (12s pan over a ~5.3s window). */}
      <ScreenshotPan
        src="org-page.png"
        progress={panProgress(t, 9100, 12000)}
        opacity={fadeInOpacity(t, 9100, 500)}
      />

      <Caption
        text="Every game recap publishes right to the team page. And season after season, year after year, those game recaps are what build the teams story."
        opacity={captionOpacity(t, 0, 9100)}
      />
      <Caption
        text="And it's showcased on your organization's page, alongside every other team."
        opacity={captionOpacity(t, 9100, 14400)}
      />
    </ScreenshotScene>
  );
}
