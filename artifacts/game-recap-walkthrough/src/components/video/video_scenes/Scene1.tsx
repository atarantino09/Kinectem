import { Caption } from '../components/Chrome';
import { ScreenshotScene, ScreenshotPan } from '../components/UIHelpers';
import { panProgress, fadeInOpacity, captionOpacity } from '../timing';

export function Scene1({ t }: { t: number }) {
  return (
    <ScreenshotScene opacity={fadeInOpacity(t, 0, 500)}>
      <ScreenshotPan
        src="team-page.png"
        progress={panProgress(t, 0, 4000)}
        opacity={fadeInOpacity(t, 0, 400)}
      />
      <ScreenshotPan
        src="composer.png"
        progress={panProgress(t, 4600, 9000)}
        opacity={fadeInOpacity(t, 4600, 500)}
      />

      <Caption
        text="Every season tells a story. It starts on your team's page."
        opacity={captionOpacity(t, 0, 4600)}
      />
      <Caption
        text="Your coach writes the game recap — going way past the box score."
        opacity={captionOpacity(t, 4600, 8800)}
      />
      <Caption
        text="The hustle plays, the turning points — the moments the stats can't capture, but nobody forgets."
        opacity={captionOpacity(t, 8800, 14500)}
      />
    </ScreenshotScene>
  );
}
