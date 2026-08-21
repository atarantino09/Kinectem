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

export function fitFontSize({
  available,
  natural,
  max,
  min,
}: {
  available: number;
  natural: number;
  max: number;
  min: number;
}): number {
  if (!available || !natural || natural <= available) return max;
  return Math.max(min, Math.floor((available / natural) * max));
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
      setFontSize(fitFontSize({ available, natural, max, min }));
    };

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(container);
    // The first measurement can happen while a fallback font is visible. Font
    // metrics changing after that do not necessarily resize the container, so
    // ResizeObserver alone can leave a title permanently too small in a
    // production first-load. Re-measure once the real font is ready and after
    // any later font loading event.
    const fontSet = "fonts" in document ? document.fonts : undefined;
    const onFontsLoaded = () => recompute();
    void fontSet?.ready.then(onFontsLoaded);
    fontSet?.addEventListener("loadingdone", onFontsLoaded);

    return () => {
      ro.disconnect();
      fontSet?.removeEventListener("loadingdone", onFontsLoaded);
    };
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
        style={{ fontSize, lineHeight, paddingBottom: "0.15em" }}
      >
        {children}
      </span>
    </Tag>
  );
}
