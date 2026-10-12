import { TIER_LABEL } from "@/lib/achievements";
import { BookOpen, Camera, CalendarCheck, Users, ShieldCheck } from "lucide-react";

const TONE = {
  1: "from-amber-700 to-amber-500 text-amber-50",
  2: "from-slate-500 to-slate-300 text-slate-900",
  3: "from-yellow-600 to-yellow-300 text-yellow-950",
} as const;

export function CrestBadge({ name, tier, locked = false, size = 44 }: { name: string; tier?: 1 | 2 | 3; locked?: boolean; size?: number }) {
  const Icon = name.includes("Memories") ? Camera : /Reporter|Roll/.test(name) ? CalendarCheck
    : /Club|Chroniclers|Storytellers/.test(name) ? Users : name.includes("Whistle") ? ShieldCheck : BookOpen;
  return (
    <span
      role="img"
      aria-label={`${name}${tier ? `, ${TIER_LABEL[tier]}` : locked ? ", not yet earned" : ""}`}
      style={{ width: size, height: size * 1.15, clipPath: "polygon(0 0,100% 0,100% 68%,50% 100%,0 68%)" }}
      className={`inline-flex shrink-0 items-center justify-center pb-1 text-xs font-black tracking-tight bg-gradient-to-b ${
        locked ? "from-muted to-muted text-muted-foreground opacity-60" : tier ? TONE[tier] : "from-primary to-primary/80 text-primary-foreground"
      }`}
    >
      <Icon size={size * 0.5} strokeWidth={2} aria-hidden="true" />
    </span>
  );
}
