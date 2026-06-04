import { useEffect, useMemo, useRef, useState } from "react";

const BASE = import.meta.env.BASE_URL ?? "/";

interface Marker {
  key: string;
  ms: number;
}

interface MarkersFile {
  markers: Marker[];
  totalMs: number;
}

const SCENE_LABELS: Record<string, string> = {
  marketing: "Marketing landing",
  signup: "Sign up",
  orgCreate: "Create organization",
  teamCreate: "Create team + invites",
  recap: "Write game recap",
  end: "Wrap",
};

interface CaptionCue {
  start: number;
  end: number;
  text: string;
}

// Timed against the recorded walkthrough.mp4 timeline (see walkthrough-markers.json).
const CAPTIONS: CaptionCue[] = [
  { start: 0, end: 2400, text: "Meet Kinectem — built for youth-sports admins." },
  { start: 2600, end: 8000, text: "Create your account." },
  { start: 8000, end: 14200, text: "Pick a role and you're in." },
  {
    start: 14600,
    end: 20000,
    text: "Spin up your organization — name it, pick a sport, drop a logo.",
  },
  { start: 20000, end: 23900, text: "Your dashboard guides you through six setup steps." },
  { start: 24400, end: 28000, text: "Add your first team." },
  { start: 28000, end: 33000, text: "Invite a coach, add a player, send the parent an invite." },
  { start: 33000, end: 35200, text: "Everyone's connected from day one." },
  { start: 35700, end: 40500, text: "Game day? Publish a recap from the team page." },
  { start: 40500, end: 44000, text: "Score, headline, write-up — done." },
  { start: 44000, end: 47912, text: "It's pinned to the team, ready for parents and players." },
];

const CAPTION_FADE_MS = 320;

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

function captionOpacity(ms: number, start: number, end: number) {
  if (ms < start || ms > end) return 0;
  const fadeIn = clamp01((ms - start) / CAPTION_FADE_MS);
  const fadeOut = clamp01((end - ms) / CAPTION_FADE_MS);
  return Math.min(fadeIn, fadeOut);
}

function fmt(seconds: number) {
  if (!Number.isFinite(seconds)) return "0:00";
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    fetch(`${BASE}walkthrough-markers.json`)
      .then((r) => (r.ok ? (r.json() as Promise<MarkersFile>) : null))
      .then((data) => {
        if (data?.markers?.length) setMarkers(data.markers);
      })
      .catch(() => {});
  }, []);

  const activeIndex = useMemo(() => {
    if (!markers.length) return 0;
    const ms = current * 1000;
    let idx = 0;
    for (let i = 0; i < markers.length; i++) {
      if (markers[i].ms <= ms) idx = i;
    }
    return idx;
  }, [markers, current]);

  const seekTo = (ms: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = ms / 1000;
    v.play().catch(() => {});
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <header className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-gradient-to-br from-indigo-500 to-violet-600" />
          <div>
            <h1 className="text-lg font-bold leading-tight">Kinectem signup walkthrough</h1>
            <p className="text-xs text-slate-400">
              End-to-end product tour, captured live with a Playwright bot.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setMuted((m) => !m)}
          className="text-sm rounded-md border border-slate-700 px-3 py-1.5 hover:bg-slate-800"
        >
          {muted ? "Unmute" : "Mute"}
        </button>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-4 py-6 gap-4">
        <div className="relative w-full max-w-5xl rounded-xl overflow-hidden bg-black shadow-2xl border border-slate-800">
          <video
            ref={videoRef}
            src={`${BASE}walkthrough.mp4`}
            controls
            autoPlay
            muted={muted}
            playsInline
            preload="auto"
            className="w-full h-auto block"
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
          />
          <div className="absolute bottom-16 left-0 right-0 z-10 flex justify-center px-12 pointer-events-none">
            {CAPTIONS.map((cue) => {
              const opacity = captionOpacity(current * 1000, cue.start, cue.end);
              if (opacity <= 0) return null;
              return (
                <div
                  key={cue.start}
                  className="absolute bg-black/50 backdrop-blur-md px-6 py-3 rounded-xl border border-white/10 shadow-xl max-w-2xl text-center"
                  style={{ opacity, transform: `translateY(${(1 - opacity) * 16}px)` }}
                >
                  <p className="text-xl md:text-2xl font-body text-white leading-tight drop-shadow">
                    {cue.text}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {markers.length > 0 && (
          <div className="w-full max-w-5xl">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
              <span>Chapters</span>
              <span>
                {fmt(current)} / {fmt(duration)}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
              {markers.map((m, i) => {
                const active = i === activeIndex;
                return (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => seekTo(m.ms)}
                    className={
                      "text-left rounded-lg border px-3 py-2 transition " +
                      (active
                        ? "border-indigo-400 bg-indigo-500/10"
                        : "border-slate-800 hover:border-slate-600 hover:bg-slate-900")
                    }
                  >
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">
                      {fmt(m.ms / 1000)}
                    </div>
                    <div className="text-sm font-semibold leading-tight">
                      {SCENE_LABELS[m.key] ?? m.key}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
