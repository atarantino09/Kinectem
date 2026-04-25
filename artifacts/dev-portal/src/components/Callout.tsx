import { type ReactNode } from "react";
import { Info, Lightbulb, AlertTriangle, Construction } from "lucide-react";

type Variant = "tip" | "warn" | "info" | "soon";

const VARIANTS: Record<
  Variant,
  { bg: string; border: string; fg: string; icon: typeof Info; label: string }
> = {
  tip: {
    bg: "var(--color-tip-soft)",
    border: "var(--color-tip)",
    fg: "var(--color-tip)",
    icon: Lightbulb,
    label: "Tip",
  },
  warn: {
    bg: "var(--color-warn-soft)",
    border: "var(--color-warn)",
    fg: "var(--color-warn)",
    icon: AlertTriangle,
    label: "Heads up",
  },
  info: {
    bg: "var(--color-info-soft)",
    border: "var(--color-info)",
    fg: "var(--color-info)",
    icon: Info,
    label: "Note",
  },
  soon: {
    bg: "var(--color-accent-soft)",
    border: "var(--color-accent)",
    fg: "var(--color-accent-strong)",
    icon: Construction,
    label: "Coming soon",
  },
};

export function Callout({
  variant = "info",
  title,
  children,
}: {
  variant?: Variant;
  title?: string;
  children: ReactNode;
}) {
  const v = VARIANTS[variant];
  const Icon = v.icon;
  return (
    <div
      className="my-5 flex gap-3 rounded-lg border-l-2 p-4 text-sm"
      style={{ background: v.bg, borderLeftColor: v.border }}
    >
      <div className="mt-0.5 shrink-0" style={{ color: v.fg }}>
        <Icon size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: v.fg }}>
          {title ?? v.label}
        </div>
        <div className="text-[var(--color-fg)]">{children}</div>
      </div>
    </div>
  );
}
