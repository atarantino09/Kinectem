import { useId } from "react";
import { TIER_LABEL } from "@/lib/achievements";
import { BookOpen, Camera, CalendarCheck, Lock, Users, ShieldCheck } from "lucide-react";

// stops: [highlight, mid, shadow], rim, glyph colour
const METAL = {
  1: { stops: ["#e9b184", "#b8743f", "#7a4420"], rim: "#5e3317", glyph: "#fff4e8" },
  2: { stops: ["#f4f6f8", "#b9c1ca", "#7d8793"], rim: "#59626d", glyph: "#2b333c" },
  3: { stops: ["#fff0a6", "#f1c232", "#b27d0a"], rim: "#7a5200", glyph: "#4a3000" },
} as const;
const BASE = { stops: ["hsl(var(--primary) / 0.85)", "hsl(var(--primary))", "hsl(var(--primary) / 0.7)"], rim: "hsl(var(--primary) / 0.5)", glyph: "hsl(var(--primary-foreground))" };

const SHIELD = "M24 2 L44 8 V30 C44 42 34 50 24 55 C14 50 4 42 4 30 V8 Z";

export function CrestBadge({ name, tier, locked = false, size = 44 }: { name: string; tier?: 1 | 2 | 3; locked?: boolean; size?: number }) {
  const uid = useId().replace(/:/g, "");
  const Icon = locked ? Lock : name.includes("Memories") ? Camera : /Reporter|Roll/.test(name) ? CalendarCheck
    : /Club|Chroniclers|Storytellers/.test(name) ? Users : name.includes("Whistle") ? ShieldCheck : BookOpen;
  const m = tier ? METAL[tier] : BASE;
  const h = size * 1.15;
  return (
    <span
      role="img"
      aria-label={`${name}${tier ? `, ${TIER_LABEL[tier]}` : locked ? ", not yet earned" : ""}`}
      className="relative inline-block shrink-0"
      style={{ width: size, height: h }}
    >
      <svg viewBox="0 0 48 56" width={size} height={h} aria-hidden="true" focusable="false" className="absolute inset-0 drop-shadow-sm">
        <defs>
          <linearGradient id={`g${uid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={m.stops[0]} />
            <stop offset="0.5" stopColor={m.stops[1]} />
            <stop offset="1" stopColor={m.stops[2]} />
          </linearGradient>
        </defs>
        {locked ? (
          <path d={SHIELD} fill="hsl(var(--muted))" stroke="hsl(var(--muted-foreground) / 0.55)" strokeWidth="2" strokeDasharray="3 3" />
        ) : (
          <>
            <path d={SHIELD} fill={`url(#g${uid})`} stroke={m.rim} strokeWidth="1.5" />
            <path d="M24 6 L40 11 V30 C40 39 33 46 24 50.5 C15 46 8 39 8 30 V11 Z" fill="none" stroke="#fff" strokeOpacity="0.55" strokeWidth="1" />
            <path d="M24 2 L44 8 V20 C34 22 14 22 4 20 V8 Z" fill="#fff" fillOpacity="0.18" />
            {tier && Array.from({ length: tier }).map((_, i) => (
              <circle key={i} cx={24 + (i - (tier - 1) / 2) * 7} cy={44} r={2.2} fill={m.glyph} fillOpacity="0.9" />
            ))}
          </>
        )}
      </svg>
      <span className="absolute inset-x-0 flex items-center justify-center" style={{ top: h * 0.2, height: size * 0.5, color: locked ? "hsl(var(--muted-foreground))" : m.glyph }}>
        <Icon size={size * (locked ? 0.4 : 0.46)} strokeWidth={2.2} aria-hidden="true" />
      </span>
    </span>
  );
}
