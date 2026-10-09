import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Numeric-only treatment; callers keep their existing colors and count caps. */
export function NumericLabel({ children }: { children: ReactNode }) {
  return <span className="numeric-badge-label">{children}</span>;
}

export function NumericBadge({
  children,
  className,
  size = 20,
  style,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { size?: 14 | 16 | 18 | 20 | 24 | 28 }) {
  return (
    <span
      {...props}
      className={cn("numeric-badge", className)}
      style={{ "--numeric-badge-size": `${size}px`, ...style } as CSSProperties}
    >
      <NumericLabel>{children}</NumericLabel>
    </span>
  );
}
