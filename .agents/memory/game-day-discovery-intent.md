---
name: Game-day discovery intent
description: Product intent for the home feed's Explore spotlight and followed activity
---

The top featured area is **Explore only**; do not offer a Following spotlight or a Following/Explore dropdown. The user's followed-team posts are already in Latest activity below, which stays visible even when Explore has no matching stories. Mobile users swipe and desktop users use arrows. Discovery never advances automatically. Recommendations must match self-provided sport or location signals, with an honest empty state when there is no relevant content; do not replace that with random global posts or IP-derived location. In the Explore picker, default to **all sports in the viewer's profile state**, then require both the chosen sport (if any) and chosen state to match. When no profile state exists, ask the viewer to select one rather than showing global stories. Changing the Explore state must not rewrite the viewer's profile.

**Why:** The user explicitly chose deliberate one-story-at-a-time discovery and keeping the familiar newsfeed. On 2026-09-28, they clarified that showing followed posts again in the top spotlight is redundant because the feed below already contains them; the top should only show Explore.

**How to apply:** Keep the chronological Latest activity feed mounted and usable below Explore. Avoid changing its data semantics or introducing autoplay/global discovery without a new product decision. Treat explicit Explore state/sport filters as intersection filters; keep unfiltered legacy discovery calls compatible.