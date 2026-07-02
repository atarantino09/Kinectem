import { useEffect, useRef, useState, type ElementType } from "react";
import { cn } from "@/lib/utils";

interface FitTextProps {
  children: React.ReactNode;
  /** Largest font size in px, used when the text comfortably fits. */
  max: number;
  /** Smallest font size in px before falling back to an ellipsis. */
  min?: number;
  /** Line-height applied to the visible text. */
  lineHeight?: number;
  /** Element rendered for the container (e.g. "h1"). Defaults to "div". */
  as?: ElementType;
  className?: string;
}

/**
 * Renders a single line of text that automatically shrinks its font size to fit
 * the container width. A hidden measurer (always at `max`) provides the natural
 * width so the visible text can be scaled in one pass without a feedback loop.
 * Falls back to a truncating ellipsis if the text can't fit even at `min`.
 */
export function FitText({
  children,
  max,
  min = 14,
  lineHeight = 1.05,
  as: Tag = "div",
  className,
}: FitTextProps) {
  const containerRef = useRef<HTMLElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [fontSize, setFontSize] = useState(max);

  useEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;

    const recompute = () => {
      const available = container.clientWidth;
      const natural = measure.scrollWidth;
      if (!available || !natural) return;
      const next =
        natural <= available
          ? max
          : Math.max(min, Math.floor((available / natural) * max));
      setFontSize(next);
    };

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(container);
    return () => ro.disconnect();
  }, [children, max, min]);

  return (
    <Tag ref={containerRef} className={cn("min-w-0 w-full", className)}>
      <span
        ref={measureRef}
        aria-hidden
        style={{
          fontSize: max,
          position: "absolute",
          visibility: "hidden",
          whiteSpace: "nowrap",
          left: -99999,
          top: 0,
          pointerEvents: "none",
        }}
      >
        {children}
      </span>
      <span
        className="block overflow-hidden text-ellipsis whitespace-nowrap"
        style={{ fontSize, lineHeight }}
      >
        {children}
      </span>
    </Tag>
  );
}
