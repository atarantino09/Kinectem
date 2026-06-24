import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';
import { Scene5 } from './video_scenes/Scene5';
import { BrowserChrome } from './components/Chrome';

export const SCENE_DURATIONS = {
  composerEmpty: 13000,
  notes: 8500,
  aiResult: 10000,
  insertPublish: 13000,
  endCard: 8500,
};

export const TOTAL_MS = Object.values(SCENE_DURATIONS).reduce((a, b) => a + b, 0);

const SCENE_COMPONENTS: Record<string, React.ComponentType<{ t: number }>> = {
  composerEmpty: Scene1,
  notes: Scene2,
  aiResult: Scene3,
  insertPublish: Scene4,
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

// A jump larger than this between renders means a scrub/replay, not normal
// frame advance — only then do we re-seek the audio to match the playhead.
const AUDIO_RESYNC_JUMP_MS = 350;

export default function VideoTemplate({
  currentMs,
  playing,
  muted = false,
  poster = false,
}: {
  currentMs: number;
  playing: boolean;
  muted?: boolean;
  poster?: boolean;
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

  // Keep audio aligned to the playhead WITHOUT nudging it every frame (that
  // caused choppy audio). While playing, the audio element is the smooth clock
  // and we only resync on a real discontinuity (scrub / replay jump). While
  // paused, we track the playhead exactly so resume starts from the right spot.
  const lastMsRef = useRef(currentMs);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    // Poster (pre-play still): leave the audio untouched at 0 so the first play
    // starts cleanly from the beginning — never park it at the poster frame's
    // timestamp, which would leak a split-second of that voice-over on play.
    if (poster) return;
    const prev = lastMsRef.current;
    lastMsRef.current = currentMs;
    const target = currentMs / 1000;
    if (!playing) {
      if (Math.abs(audio.currentTime - target) > 0.05) audio.currentTime = target;
    } else if (Math.abs(currentMs - prev) > AUDIO_RESYNC_JUMP_MS) {
      audio.currentTime = target;
    }
  }, [currentMs, playing, poster]);

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

        <div className={`absolute inset-x-0 top-12 bottom-0 overflow-hidden bg-[#F4F4F5]${poster ? ' hide-captions' : ''}`}>
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
