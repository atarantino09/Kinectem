import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';
import { Scene5 } from './video_scenes/Scene5';
import { BrowserChrome } from './components/Chrome';

export const SCENE_DURATIONS = {
  teamPage: 14500,
  feedOrg: 14400,
  playerProfile: 9600,
  filterSports: 7500,
  endCard: 8700,
};

export const TOTAL_MS = Object.values(SCENE_DURATIONS).reduce((a, b) => a + b, 0);

const SCENE_COMPONENTS: Record<string, React.ComponentType<{ t: number }>> = {
  teamPage: Scene1,
  feedOrg: Scene2,
  playerProfile: Scene3,
  filterSports: Scene4,
  endCard: Scene5,
};

// Precompute each scene's absolute start offset on the master timeline.
const SCENE_LIST = (() => {
  let start = 0;
  return Object.entries(SCENE_DURATIONS).map(([key, dur]) => {
    const entry = { key, start, dur };
    start += dur;
    return entry;
  });
})();

function sceneAt(ms: number) {
  let current = SCENE_LIST[0];
  for (const s of SCENE_LIST) {
    if (s.start <= ms) current = s;
    else break;
  }
  return {
    key: current.key,
    localMs: Math.max(0, Math.min(ms - current.start, current.dur)),
  };
}

const AUDIO_DRIFT_SEC = 0.25;

export default function VideoTemplate({
  currentMs,
  playing,
  muted = false,
}: {
  currentMs: number;
  playing: boolean;
  muted?: boolean;
}) {
  const { key, localMs } = sceneAt(currentMs);
  const SceneComponent = SCENE_COMPONENTS[key] ?? Scene1;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playingRef = useRef(playing);
  playingRef.current = playing;

  // Play/pause follows the master clock's play state.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = 1.0;
    if (playing) audio.play().catch(() => {});
    else audio.pause();
  }, [playing]);

  // Resilient start: if the first play() attempt happens before the media is
  // ready (common in the autoplay export path), retry once it can play.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onReady = () => {
      if (playingRef.current) audio.play().catch(() => {});
    };
    audio.addEventListener('canplay', onReady);
    return () => audio.removeEventListener('canplay', onReady);
  }, []);

  // Keep audio locked to the playhead. Only correct on meaningful drift so
  // normal playback doesn't stutter, but scrubs snap immediately.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const target = currentMs / 1000;
    if (Math.abs(audio.currentTime - target) > AUDIO_DRIFT_SEC) {
      audio.currentTime = target;
    }
  }, [currentMs]);

  return (
    <div className="relative w-full h-screen overflow-hidden bg-[#09090B] flex items-center justify-center">
      {/* Background layer */}
      <div className="absolute inset-0 z-0">
        <div className="absolute inset-0 bg-[linear-gradient(160deg,#EEF2FF_0%,#F5F3FF_40%,#EDE9FE_100%)] opacity-20" />
        <motion.div
          className="absolute top-0 right-0 w-[800px] h-[800px] rounded-full blur-[120px] opacity-30"
          style={{ background: 'radial-gradient(circle, #2563EB 0%, transparent 70%)' }}
          animate={{ x: ['10%', '-10%', '10%'], y: ['-10%', '10%', '-10%'] }}
          transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
        />
        <motion.div
          className="absolute bottom-0 left-0 w-[600px] h-[600px] rounded-full blur-[100px] opacity-20"
          style={{ background: 'radial-gradient(circle, #7C3AED 0%, transparent 70%)' }}
          animate={{ x: ['-10%', '10%', '-10%'], y: ['10%', '-10%', '10%'] }}
          transition={{ duration: 15, repeat: Infinity, ease: 'linear' }}
        />
      </div>

      {/* Main content container with browser chrome */}
      <div className="relative w-[90vw] h-[85vh] bg-white rounded-xl shadow-2xl overflow-hidden z-10 border border-white/20">
        <BrowserChrome />

        <div className="absolute inset-x-0 top-12 bottom-0 overflow-hidden bg-[#F4F4F5]">
          <SceneComponent key={key} t={localMs} />
        </div>
      </div>

      <audio
        ref={audioRef}
        src={`${import.meta.env.BASE_URL}audio/composite_audio.mp3`}
        preload="auto"
        muted={muted}
      />
    </div>
  );
}
