import type { CSSProperties, ReactNode } from "react";

// Reusable gradient persona badge. Colors and labels are locked brand values —
// add new personas here and they're available everywhere. The visual spec
// (exact gradients, padding, type) is encoded with inline styles so it stays
// pixel-accurate regardless of the surrounding Tailwind context.
type PersonaConfig = {
  label: string;
  gradient: [string, string];
};

const PERSONAS: Record<string, PersonaConfig> = {
  organization: {
    label: "ORGANIZATION",
    gradient: ["#F97316", "#DC2626"],
  },
  team: {
    label: "TEAM",
    gradient: ["#84CC16", "#10B981"],
  },
};

// Switch to 90deg for a horizontal sweep if 135deg looks off once live.
const GRADIENT_ANGLE = "135deg";

const SIZES = {
  md: { padding: "5px 14px", fontSize: "13px" },
  sm: { padding: "3px 10px", fontSize: "11px" },
} as const;

export function PersonaPill({
  persona,
  children,
  size = "md",
  className,
}: {
  persona: string;
  children?: ReactNode;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const config = PERSONAS[persona];
  if (!config) return null;

  const style: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    lineHeight: 1,
    whiteSpace: "nowrap",
    padding: SIZES[size].padding,
    borderRadius: "9999px",
    fontFamily: "Inter, sans-serif",
    fontWeight: 900,
    fontSize: SIZES[size].fontSize,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "#FFFFFF",
    backgroundImage: `linear-gradient(${GRADIENT_ANGLE}, ${config.gradient[0]}, ${config.gradient[1]})`,
  };

  return (
    <span
      style={style}
      className={className}
      data-testid={`persona-pill-${persona}`}
    >
      {children ?? config.label}
    </span>
  );
}
