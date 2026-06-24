import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause, Volume2, VolumeX } from 'lucide-react';
import VideoTemplate, { TOTAL_MS } from './VideoTemplate';
import { usePlayhead } from './usePlayhead';

declare global {
  interface Window {
    startRecording?: () => Promise<void>;
    stopRecording?: () => void;
  }
}

// Poster frame shown before the first play: the AI Assist screen at ~23s, so
// the still frame previews AI Assist instead of the blank composer.
const POSTER_MS = 23000;

function formatTime(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Export / recording path: one self-driving playthrough (no loop), unmuted,
// firing the recording markers the capture pipeline hooks into.
function ExportPlayer() {
  const { currentMs, playing } = usePlayhead(TOTAL_MS, {
    autoPlay: true,
    loop: false,
    onEnded: () => window.stopRecording?.(),
  });

  useEffect(() => {
    window.startRecording?.();
  }, []);

  return <VideoTemplate currentMs={currentMs} playing={playing} muted={false} />;
}

// Interactive path: single scrubbable timeline + play/pause, no auto-loop.
function InteractivePlayer() {
  const { currentMs, playing, totalMs, play, pause, toggle, seek } =
    usePlayhead(TOTAL_MS, { autoPlay: false, loop: false });

  const [muted, setMuted] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);

  // Before the first play, freeze the frame on the AI Assist screen (~23s) as a
  // poster. The first play resets to the start so the whole video plays through.
  const displayMs = hasStarted ? currentMs : POSTER_MS;
  const handleToggle = useCallback(() => {
    if (!hasStarted) {
      setHasStarted(true);
      seek(0);
      play();
    } else {
      toggle();
    }
  }, [hasStarted, seek, play, toggle]);

  // Controls reveal on hover (mouse) or tap (touch) so they never cover the
  // captions during playback.
  const sensorRef = useRef<HTMLDivElement | null>(null);
  const [hovering, setHovering] = useState(false);
  const [tapPinned, setTapPinned] = useState(false);
  const wasPlayingRef = useRef(false);
  const scrubbingRef = useRef(false);

  const handlePointerEnter = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') setHovering(true);
  }, []);
  const handlePointerLeave = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') setHovering(false);
  }, []);
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') setTapPinned(true);
  }, []);

  useEffect(() => {
    if (!tapPinned) return;
    const onDocPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      const sensor = sensorRef.current;
      if (sensor && !sensor.contains(e.target as Node)) setTapPinned(false);
    };
    document.addEventListener('pointerdown', onDocPointerDown);
    return () => document.removeEventListener('pointerdown', onDocPointerDown);
  }, [tapPinned]);

  const barVisible = hovering || tapPinned || !playing;

  // Scrubbing: pause while dragging, resume afterwards if it was playing.
  // Guarded by scrubbingRef so resume fires exactly once even when both
  // onPointerUp and onLostPointerCapture land (e.g. release off the slider).
  const onScrubStart = useCallback(() => {
    if (scrubbingRef.current) return;
    scrubbingRef.current = true;
    setHasStarted(true);
    wasPlayingRef.current = playing;
    pause();
  }, [playing, pause]);
  const onScrubEnd = useCallback(() => {
    if (!scrubbingRef.current) return;
    scrubbingRef.current = false;
    if (wasPlayingRef.current) play();
  }, [play]);

  return (
    <div className="relative w-full h-screen">
      <VideoTemplate currentMs={displayMs} playing={playing} muted={muted} poster={!hasStarted} />

      {/* Click anywhere on the frame toggles play/pause. */}
      <button
        type="button"
        onClick={handleToggle}
        className="absolute inset-0 z-40 cursor-pointer"
        aria-label={playing ? 'Pause' : 'Play'}
      />

      {/* Center play overlay while paused. */}
      {!playing && (
        <div className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none">
          <div className="w-24 h-24 rounded-full bg-black/55 backdrop-blur-sm flex items-center justify-center shadow-2xl">
            <Play className="w-12 h-12 text-white translate-x-0.5" fill="white" />
          </div>
        </div>
      )}

      <div
        ref={sensorRef}
        className="absolute bottom-0 left-0 right-0 z-50 flex flex-col justify-end"
        style={{ height: '25%' }}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        onPointerDown={handlePointerDown}
      >
        <div className="flex-1 w-full pointer-events-none" aria-hidden="true" />
        <div
          className={`flex items-center gap-4 bg-black/50 backdrop-blur-sm px-5 py-4 transition-all duration-200 ease-out ${
            barVisible
              ? 'translate-y-0 opacity-100 pointer-events-auto'
              : 'translate-y-full opacity-0 pointer-events-none'
          }`}
          aria-hidden={!barVisible}
        >
          <button
            onClick={handleToggle}
            className="w-14 h-14 flex items-center justify-center text-white bg-white/15 hover:bg-white/25 transition-colors rounded-lg shrink-0"
            title={playing ? 'Pause' : 'Play'}
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? <Pause className="w-8 h-8" /> : <Play className="w-8 h-8" />}
          </button>

          <button
            onClick={() => setMuted((m) => !m)}
            className={`w-14 h-14 flex items-center justify-center transition-colors rounded-lg shrink-0 ${
              muted
                ? 'text-white/60 hover:text-white hover:bg-white/10'
                : 'text-white bg-white/15 hover:bg-white/25'
            }`}
            title={muted ? 'Unmute' : 'Mute'}
            aria-label={muted ? 'Unmute' : 'Mute'}
            aria-pressed={!muted}
          >
            {muted ? <VolumeX className="w-8 h-8" /> : <Volume2 className="w-8 h-8" />}
          </button>

          <span className="text-xl text-white/70 font-mono tabular-nums shrink-0">
            {formatTime(currentMs)}
          </span>

          <input
            type="range"
            min={0}
            max={totalMs}
            step={50}
            value={Math.min(currentMs, totalMs)}
            onPointerDown={onScrubStart}
            onPointerUp={onScrubEnd}
            onLostPointerCapture={onScrubEnd}
            onChange={(e) => seek(Number(e.target.value))}
            className="flex-1 h-2 accent-white cursor-pointer"
            aria-label="Seek"
          />

          <span className="text-xl text-white/50 font-mono tabular-nums shrink-0">
            {formatTime(totalMs)}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function VideoWithControls() {
  const isIframed = typeof window !== 'undefined' && window.self !== window.top;
  return isIframed ? <InteractivePlayer /> : <ExportPlayer />;
}
