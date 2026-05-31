import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useVideoPlayer } from '@/lib/video/hooks';
import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';
import { Scene5 } from './video_scenes/Scene5';
import { BrowserChrome } from './components/Chrome';

export const SCENE_DURATIONS = {
  teamPage: 12000,
  feedOrg: 10000,
  playerProfile: 9000,
  filterSports: 9000,
  endCard: 8000,
};

const SCENE_COMPONENTS: Record<string, React.ComponentType> = {
  teamPage: Scene1,
  feedOrg: Scene2,
  playerProfile: Scene3,
  filterSports: Scene4,
  endCard: Scene5,
};

const SCENE_START_SEC: Record<string, number> = (() => {
  const out: Record<string, number> = {};
  let cumulativeMs = 0;
  for (const [key, ms] of Object.entries(SCENE_DURATIONS)) {
    out[key] = cumulativeMs / 1000;
    cumulativeMs += ms;
  }
  return out;
})();

const AUDIO_SEEK_EPSILON_SEC = 0.18;

export default function VideoTemplate({
  durations = SCENE_DURATIONS,
  loop = true,
  muted = false,
  onSceneChange,
}: {
  durations?: Record<string, number>;
  loop?: boolean;
  muted?: boolean;
  onSceneChange?: (sceneKey: string) => void;
} = {}) {
  const { currentSceneKey } = useVideoPlayer({ durations, loop });
  const baseSceneKey = currentSceneKey.replace(/_r[12]$/, '');

  useEffect(() => {
    onSceneChange?.(currentSceneKey);
  }, [currentSceneKey, onSceneChange]);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = 1.0;
    const targetTime = SCENE_START_SEC[baseSceneKey] ?? 0;
    if (Math.abs(audio.currentTime - targetTime) > AUDIO_SEEK_EPSILON_SEC) {
      audio.currentTime = targetTime;
    }
    audio.play().catch(() => {});
  }, [currentSceneKey, baseSceneKey, muted]);

  const SceneComponent = SCENE_COMPONENTS[baseSceneKey] || Scene1;

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
          <AnimatePresence mode="popLayout">
            <SceneComponent key={currentSceneKey} />
          </AnimatePresence>
        </div>
      </div>

      <audio
        ref={audioRef}
        src={`${import.meta.env.BASE_URL}audio/composite_audio.mp3`}
        preload="auto"
        autoPlay
        muted={muted}
      />
    </div>
  );
}
