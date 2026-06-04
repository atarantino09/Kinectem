import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WORKSPACE_ROOT = resolve(__dirname, "..", "..");

// Clean recording (no captions) — the signup-walkthrough app overlays captions
// live in React, so its public mp4 stays caption-free and serves as the source.
const SOURCE = resolve(
  WORKSPACE_ROOT,
  "artifacts/signup-walkthrough/public/walkthrough.mp4",
);
// Captions are burned in for the static marketing landing page, which embeds a
// plain <video> and cannot run the React overlay.
const OUTPUT = resolve(WORKSPACE_ROOT, "artifacts/marketing/public/walkthrough.mp4");
// A captioned copy the signup-walkthrough app offers as a download (its own
// walkthrough.mp4 stays caption-free for live React-overlay playback).
const DOWNLOAD_COPY = resolve(
  WORKSPACE_ROOT,
  "artifacts/signup-walkthrough/public/walkthrough-captioned.mp4",
);

const VIDEO_W = 1280;
const VIDEO_H = 720;

interface CaptionCue {
  start: number;
  end: number;
  text: string;
}

// Mirror of CAPTIONS in artifacts/signup-walkthrough/src/App.tsx — keep in sync.
// Timed against the recorded walkthrough.mp4 timeline (walkthrough-markers.json).
const CAPTIONS: CaptionCue[] = [
  { start: 0, end: 2400, text: "Meet Kinectem — built for youth sports organizations." },
  { start: 2600, end: 5300, text: "Getting started takes minutes." },
  { start: 5500, end: 8800, text: "Create your account." },
  { start: 8800, end: 14200, text: "Select your role and you're in." },
  { start: 14600, end: 17500, text: "Create your organization." },
  { start: 17500, end: 21000, text: "Fill out the basic info of your org, add your logo." },
  { start: 21000, end: 23900, text: "Your dashboard guides you through six setup steps." },
  { start: 24400, end: 30500, text: "Add your teams, invite your coaches, players and parents." },
  { start: 30500, end: 35200, text: "Everyone is connected from day one." },
  { start: 35700, end: 39500, text: "Game day. From the team page publish a game recap." },
  { start: 39500, end: 42200, text: "Add the score, a headline, and the write-up." },
  { start: 42200, end: 44500, text: "It auto tags every player on the roster." },
  { start: 44500, end: 46800, text: "Parents can add their own photos right to the article." },
  { start: 47000, end: 48640, text: "Start your org at kinectem.com" },
];

const FADE_MS = 320;

function assTime(ms: number): string {
  const cs = Math.round(ms / 10);
  const centis = cs % 100;
  const totalSec = Math.floor(cs / 100);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  const pad = (n: number, w = 2) => n.toString().padStart(w, "0");
  return `${h}:${pad(m)}:${pad(s)}.${pad(centis)}`;
}

function buildAss(): string {
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${VIDEO_W}`,
    `PlayResY: ${VIDEO_H}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    // BorderStyle 3 = opaque box; Outline draws the box padding border in
    // OutlineColour, the inner fill uses BackColour. Both must share the same
    // alpha or the opaque border dominates. Colours are &HAABBGGRR; AA=B0 ≈
    // 31% opaque black for a light translucent box.
    "Style: Caption,DejaVu Sans,32,&H00FFFFFF,&H00FFFFFF,&HB0000000,&HB0000000,0,0,0,0,100,100,0,0,3,14,0,2,300,300,72,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");

  const events = CAPTIONS.map((cue) => {
    const fadeIn = Math.min(FADE_MS, Math.floor((cue.end - cue.start) / 2));
    const fadeOut = fadeIn;
    return `Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},Caption,,0,0,0,,{\\fad(${fadeIn},${fadeOut})}${cue.text}`;
  }).join("\n");

  return `${header}\n${events}\n`;
}

function main() {
  const dir = mkdtempSync(join(tmpdir(), "walkthrough-captions-"));
  try {
    const assPath = join(dir, "captions.ass");
    writeFileSync(assPath, buildAss(), "utf8");

    // libass reads the .ass via the subtitles filter; escape the path for the filtergraph.
    const escaped = assPath.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
    const vf = `subtitles=${escaped}`;

    console.log("Burning captions into walkthrough.mp4...");
    console.log("  source:", SOURCE);
    console.log("  output:", OUTPUT);

    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-i",
        SOURCE,
        "-vf",
        vf,
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "copy",
        "-movflags",
        "+faststart",
        OUTPUT,
      ],
      { stdio: "inherit" },
    );

    copyFileSync(OUTPUT, DOWNLOAD_COPY);
    console.log("  download copy:", DOWNLOAD_COPY);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("Done.");
}

main();
