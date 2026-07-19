import { useCallback, useEffect, useRef } from "react";

// Task #785 — shared IntersectionObserver hook for infinite post lists.
// Attach the returned ref to a sentinel element rendered after the last
// post; when it scrolls into view (with a generous rootMargin so the
// next page starts loading before the user hits the bottom) `onLoadMore`
// fires. Callers gate on hasMore/isLoading themselves via the args so
// the observer never spams requests while a page is in flight.
//
// `hasError` MUST be wired to the fetch's error state: when a page
// fetch fails, auto-loading stops entirely (otherwise isLoading flips
// back to false while hasMore stays true and the effect below would
// retry in a hot loop, hammering the API). Callers render a manual
// "Retry" button in that state; the retry calls `onLoadMore` directly,
// which clears the error and resumes auto-loading on success.
export function useInfiniteScrollSentinel({
  hasMore,
  isLoading,
  hasError = false,
  onLoadMore,
}: {
  hasMore: boolean;
  isLoading: boolean;
  hasError?: boolean;
  onLoadMore: () => void;
}) {
  const nodeRef = useRef<HTMLElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  // Keep the latest state in refs so the observer callback (created
  // once per attached node) always sees fresh values without needing
  // to re-create the observer on every render.
  const stateRef = useRef({ hasMore, isLoading, hasError, onLoadMore });
  stateRef.current = { hasMore, isLoading, hasError, onLoadMore };

  const attach = useCallback((node: HTMLElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    nodeRef.current = node;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        const { hasMore, isLoading, hasError, onLoadMore } = stateRef.current;
        if (hasMore && !isLoading && !hasError) onLoadMore();
      },
      // Start fetching one viewport-ish early so scrolling feels
      // continuous instead of stalling at the bottom.
      { rootMargin: "600px 0px" },
    );
    observer.observe(node);
    observerRef.current = observer;
  }, []);

  // When a fetch finishes and the sentinel is STILL on screen (short
  // pages / tall viewports), the observer won't re-fire on its own —
  // nudge another load so the list keeps filling until the sentinel
  // leaves the viewport or pages run out. Never nudges while errored,
  // or a failed fetch would retry in an infinite loop.
  useEffect(() => {
    if (!hasMore || isLoading || hasError) return;
    const node = nodeRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const inRange =
      rect.top < (window.innerHeight || document.documentElement.clientHeight) + 600 &&
      rect.bottom > -600;
    if (inRange) onLoadMore();
  }, [hasMore, isLoading, hasError, onLoadMore]);

  useEffect(
    () => () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    },
    [],
  );

  return attach;
}
