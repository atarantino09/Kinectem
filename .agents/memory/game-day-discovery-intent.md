---
name: Game-day discovery intent
description: Product intent for the home feed's Following and Explore modes
---

Keep Following as the default chronological spotlight. Explore swaps only the featured area at the top for one discoverable story at a time; the user's Latest activity timeline stays below it in **both** modes, including when Explore has no matching stories. Mobile users swipe and desktop users use arrows. Discovery never advances automatically. Recommendations must match self-provided sport or location signals, with an honest empty state when there is no relevant content; do not replace that with random global posts or IP-derived location. In the Explore picker, default to **all sports in the viewer's profile state**, then require both the chosen sport (if any) and chosen state to match. When no profile state exists, ask the viewer to select one rather than showing global stories. Changing the Explore state must not rewrite the viewer's profile.

**Why:** The user explicitly chose deliberate one-story-at-a-time discovery, then clarified that choosing Explore should not make the familiar newsfeed disappear. They later requested sport and state selectors so discovery begins locally and can be narrowed or moved to another state.

**How to apply:** Keep the chronological Latest activity feed mounted and usable below the featured area regardless of mode. Avoid changing its data semantics or introducing autoplay/global discovery without a new product decision. Treat explicit Explore state/sport filters as intersection filters; keep unfiltered legacy discovery calls compatible.