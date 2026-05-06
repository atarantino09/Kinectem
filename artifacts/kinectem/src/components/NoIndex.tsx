import { useEffect } from "react";

// Task #367 — COPPA Phase 3. Mounts a `<meta name="robots" content="…">`
// tag on the document head while rendered, and removes it on unmount.
// Belt-and-braces with the X-Robots-Tag header the API server sets on
// minor profile / minor-authored post responses — the SPA can serve
// the same URL with no server header (e.g. via the static index.html
// shell), so we also instruct crawlers in-page.
export function NoIndex() {
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow, noimageindex";
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);
  return null;
}
