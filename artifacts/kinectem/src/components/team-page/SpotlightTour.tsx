import {
  useCallback,
  useEffect,
  useRef,
  useId,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { NumericBadge } from "@/components/ui/numeric-badge";

export type TourStep = {
  /** Highlighted element, located via `[data-testid="..."]`. */
  targetTestId: string;
  /** Additional visible controls that belong to the same instruction. */
  additionalTargetTestIds?: string[];
  title: string;
  body: ReactNode;
  /** Run before locating the target (e.g. switch the active tab). */
  onEnter?: () => void;
};

type Rect = { top: number; left: number; width: number; height: number };

const RING_PAD = 8;
const CARD_W = 340;

function layoutViewport(): { width: number; height: number } {
  if (typeof window === "undefined") {
    return { width: 1200, height: 800 };
  }

  // Fixed-position CSS and getBoundingClientRect() both use the layout
  // viewport. `innerWidth` includes a classic scrollbar, while an inset-0
  // fixed element does not. Using it in the SVG viewBox shrinks every x/y
  // coordinate toward the top-left and visibly shifts the ring off its
  // control, especially on the right side of a page.
  const root = document.documentElement;
  return {
    width: root.clientWidth || window.innerWidth,
    height: root.clientHeight || window.innerHeight,
  };
}

function targetTestIds(step: TourStep): string[] {
  return Array.from(
    new Set([step.targetTestId, ...(step.additionalTargetTestIds ?? [])]),
  );
}

function targetElements(testIds: string[]): HTMLElement[] {
  return Array.from(
    new Set(
      testIds
        .map((testId) =>
          document.querySelector<HTMLElement>(`[data-testid="${testId}"]`),
        )
        .filter((element): element is HTMLElement => element !== null),
    ),
  );
}

function boundsFor(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  const top = Math.min(...rects.map((rect) => rect.top));
  const left = Math.min(...rects.map((rect) => rect.left));
  const bottom = Math.max(...rects.map((rect) => rect.top + rect.height));
  const right = Math.max(...rects.map((rect) => rect.left + rect.width));
  return { top, left, width: right - left, height: bottom - top };
}

/**
 * A numbered "spotlight" walkthrough. It dims the page, rings the
 * current target element(s), and shows a tooltip card with Back / Next. Only
 * the tour controls are interactive (a transparent full-screen layer blocks
 * page clicks) so users can't wander off mid-tour. Steps whose targets never
 * mount fall back to a centered card so the tour never gets stuck.
 */
export function SpotlightTour({
  steps,
  onFinish,
}: {
  steps: TourStep[];
  onFinish: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [rects, setRects] = useState<Rect[]>([]);
  const retryRef = useRef<number | null>(null);
  const settleRef = useRef<number[]>([]);
  const maskId = `tour-mask-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const step = steps[index];
  const total = steps.length;

  const measure = useCallback((elements: HTMLElement[]) => {
    setRects(
      elements.map((element) => {
        const r = element.getBoundingClientRect();
        return { top: r.top, left: r.left, width: r.width, height: r.height };
      }),
    );
  }, []);

  // Locate + measure the current targets, retrying briefly while the tab
  // content (and any queries) settle after onEnter().
  const locate = useCallback(
    (testIds: string[]) => {
      if (retryRef.current) window.clearTimeout(retryRef.current);
      settleRef.current.forEach((t) => window.clearTimeout(t));
      settleRef.current = [];
      let tries = 0;
      const attempt = () => {
        const elements = targetElements(testIds);
        if (elements.length > 0) {
          elements[0].scrollIntoView({ block: "center", inline: "nearest" });
          // Re-measure on the next frame so the value reflects the scroll.
          window.requestAnimationFrame(() => measure(targetElements(testIds)));
          // Layout can still shift after the target is found — e.g. an image
          // above it (org logo / avatar) finishing loading pushes it
          // sideways or down. Re-measure a few times so every ring lands on
          // its target's final resting position instead of a stale rect.
          settleRef.current = [100, 250, 500, 900, 1400].map((d) =>
            window.setTimeout(() => {
              measure(targetElements(testIds));
            }, d),
          );
          return;
        }
        tries += 1;
        if (tries < 24) {
          retryRef.current = window.setTimeout(attempt, 50);
        } else {
          setRects([]); // centered fallback — no target found
        }
      };
      attempt();
    },
    [measure],
  );

  // On step change: prep the page, then locate the target.
  useEffect(() => {
    if (!step) return;
    setRects([]);
    step.onEnter?.();
    const id = window.setTimeout(() => locate(targetTestIds(step)), 60);
    return () => {
      window.clearTimeout(id);
      if (retryRef.current) window.clearTimeout(retryRef.current);
      settleRef.current.forEach((t) => window.clearTimeout(t));
      settleRef.current = [];
    };
  }, [index, step, locate]);

  // Keep the ring glued to the element as the page scrolls / resizes.
  useEffect(() => {
    if (!step) return;
    const onMove = () => {
      const elements = targetElements(targetTestIds(step));
      if (elements.length > 0) measure(elements);
    };
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    // Reflows from late-loading content (images above the target) change the
    // page layout without firing scroll/resize. Observe the body plus the
    // target and its offset parent so both vertical reflows and width-only
    // redistributions (which may not change the body's box) re-position the
    // ring.
    const ro = new ResizeObserver(onMove);
    ro.observe(document.body);
    targetElements(targetTestIds(step)).forEach((element) => {
      ro.observe(element);
      if (element.offsetParent instanceof HTMLElement) {
        ro.observe(element.offsetParent);
      }
    });
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
      ro.disconnect();
    };
  }, [step, measure]);

  if (!step) return null;

  const isFirst = index === 0;
  const isLast = index === total - 1;
  const next = () => (isLast ? onFinish() : setIndex((i) => i + 1));
  const back = () => setIndex((i) => Math.max(0, i - 1));

  const { width: vw, height: vh } = layoutViewport();
  const bounds = boundsFor(rects);

  let cardStyle: CSSProperties;
  if (bounds) {
    // Pin the card to whichever vertical half is opposite the highlighted
    // group so it never sits on top of any target. Center it horizontally in
    // the viewport, clamped to stay fully on-screen.
    const targetCenterY = bounds.top + bounds.height / 2;
    const targetInTopHalf = targetCenterY < vh / 2;
    const left = Math.min(
      Math.max(14, vw / 2 - CARD_W / 2),
      vw - CARD_W - 14,
    );
    cardStyle = targetInTopHalf
      ? { position: "fixed", bottom: 24, left, width: CARD_W }
      : { position: "fixed", top: 24, left, width: CARD_W };
  } else {
    cardStyle = {
      position: "fixed",
      top: "50%",
      left: "50%",
      width: CARD_W,
      transform: "translate(-50%, -50%)",
    };
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999]" data-testid="team-tour">
      {/* The backdrop blocks page controls and dismisses the tour when clicked. */}
      <div
        className="absolute inset-0"
        style={{ pointerEvents: "auto" }}
        onClick={onFinish}
        data-testid="tour-backdrop"
      />
      {rects.length > 0 ? (
        <svg
          className="absolute inset-0 h-full w-full pointer-events-none"
          viewBox={`0 0 ${vw} ${vh}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <mask id={maskId}>
              <rect width={vw} height={vh} fill="white" />
              {rects.map((rect, index) => (
                <rect
                  key={index}
                  x={rect.left - RING_PAD}
                  y={rect.top - RING_PAD}
                  width={rect.width + RING_PAD * 2}
                  height={rect.height + RING_PAD * 2}
                  rx="8"
                  fill="black"
                />
              ))}
            </mask>
          </defs>
          <rect
            width={vw}
            height={vh}
            fill="rgba(2,6,23,0.68)"
            mask={`url(#${maskId})`}
          />
          {rects.map((rect, index) => (
            <rect
              key={index}
              x={rect.left - RING_PAD}
              y={rect.top - RING_PAD}
              width={rect.width + RING_PAD * 2}
              height={rect.height + RING_PAD * 2}
              rx="8"
              fill="none"
              stroke="white"
              strokeWidth="3"
              data-testid="tour-spotlight-ring"
            />
          ))}
        </svg>
      ) : (
        <div
          className="absolute inset-0"
          style={{ background: "rgba(2,6,23,0.68)", pointerEvents: "none" }}
        />
      )}
      <div
        className="rounded-xl border border-border bg-background shadow-2xl p-5 space-y-3"
        style={cardStyle}
        data-testid="team-tour-card"
      >
        <div className="flex items-center justify-between">
          <NumericBadge size={28} className="bg-primary text-primary-foreground text-xs font-black">
            {index + 1}
          </NumericBadge>
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Step {index + 1} of {total}
          </span>
        </div>
        <h3 className="text-lg font-black tracking-tight">{step.title}</h3>
        <div className="text-sm text-muted-foreground leading-relaxed">
          {step.body}
        </div>
        <div className="flex items-center justify-between pt-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={back}
            disabled={isFirst}
            className="font-bold"
            data-testid="btn-tour-back"
          >
            Back
          </Button>
          <Button
            size="sm"
            onClick={next}
            className="font-bold rounded-full"
            data-testid="btn-tour-next"
          >
            {isLast ? "Got it" : "Next"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
