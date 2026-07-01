import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";

export type TourStep = {
  /** Highlighted element, located via `[data-testid="..."]`. */
  targetTestId: string;
  title: string;
  body: ReactNode;
  /** Run before locating the target (e.g. switch the active tab). */
  onEnter?: () => void;
};

type Rect = { top: number; left: number; width: number; height: number };

const RING_PAD = 8;
const CARD_W = 340;

/**
 * A forced, numbered "spotlight" walkthrough. It dims the page, rings the
 * current target element, and shows a tooltip card with Back / Next. Only the
 * tour controls are interactive (a transparent full-screen layer blocks page
 * clicks) so users can't wander off mid-tour. Steps whose target never mounts
 * fall back to a centered card so the tour never gets stuck.
 */
export function SpotlightTour({
  steps,
  onFinish,
}: {
  steps: TourStep[];
  onFinish: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const retryRef = useRef<number | null>(null);

  const step = steps[index];
  const total = steps.length;

  const measure = useCallback((el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, []);

  // Locate + measure the current target, retrying briefly while the tab
  // content (and any queries) settle after onEnter().
  const locate = useCallback(
    (testId: string) => {
      if (retryRef.current) window.clearTimeout(retryRef.current);
      let tries = 0;
      const attempt = () => {
        const el = document.querySelector<HTMLElement>(
          `[data-testid="${testId}"]`,
        );
        if (el) {
          el.scrollIntoView({ block: "center", inline: "nearest" });
          // Re-measure on the next frame so the value reflects the scroll.
          window.requestAnimationFrame(() => measure(el));
          return;
        }
        tries += 1;
        if (tries < 24) {
          retryRef.current = window.setTimeout(attempt, 50);
        } else {
          setRect(null); // centered fallback — no target found
        }
      };
      attempt();
    },
    [measure],
  );

  // On step change: prep the page, then locate the target.
  useEffect(() => {
    if (!step) return;
    setRect(null);
    step.onEnter?.();
    const id = window.setTimeout(() => locate(step.targetTestId), 60);
    return () => {
      window.clearTimeout(id);
      if (retryRef.current) window.clearTimeout(retryRef.current);
    };
  }, [index, step, locate]);

  // Keep the ring glued to the element as the page scrolls / resizes.
  useEffect(() => {
    if (!step) return;
    const onMove = () => {
      const el = document.querySelector<HTMLElement>(
        `[data-testid="${step.targetTestId}"]`,
      );
      if (el) measure(el);
    };
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [step, measure]);

  if (!step) return null;

  const isFirst = index === 0;
  const isLast = index === total - 1;
  const next = () => (isLast ? onFinish() : setIndex((i) => i + 1));
  const back = () => setIndex((i) => Math.max(0, i - 1));

  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;

  let cardStyle: CSSProperties;
  if (rect) {
    // Pin the card to whichever vertical half is opposite the target so it
    // never sits on top of the highlighted button (or its neighbours). Center
    // it horizontally in the viewport, clamped to stay fully on-screen.
    const targetCenterY = rect.top + rect.height / 2;
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
      {/* Transparent click-blocker so only the tour controls are usable. */}
      <div className="absolute inset-0" style={{ pointerEvents: "auto" }} />
      {rect ? (
        <div
          className="absolute rounded-lg"
          style={{
            top: rect.top - RING_PAD,
            left: rect.left - RING_PAD,
            width: rect.width + RING_PAD * 2,
            height: rect.height + RING_PAD * 2,
            boxShadow: "0 0 0 9999px rgba(2,6,23,0.68)",
            outline: "3px solid rgb(255,255,255)",
            outlineOffset: "2px",
            pointerEvents: "none",
            transition: "top 0.15s ease, left 0.15s ease, width 0.15s ease, height 0.15s ease",
          }}
        />
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
          <span className="inline-flex items-center justify-center h-7 min-w-[1.75rem] px-2 rounded-full bg-primary text-primary-foreground text-xs font-black">
            {index + 1}
          </span>
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
