---
name: Shareable recap image
description: Client-side branded PNG export of game recaps — gating, fonts, and capture pitfalls.
---

- "Share as image" renders a fixed 1080×1350 DOM composition (share-image/ShareRecapCanvas) off-screen and captures it with html-to-image at 2× then downscales — no server rendering.
- **Publication gate:** posts carry `articleStatus` ("draft"|"pending_approval"|"published"), an extra-spec field from articleToPost (recapKind precedent). The share button requires exactly `"published"` — the detail endpoint intentionally serves drafts/pending recaps to authors/org admins, and `isAdminOnPending` is NOT a publication-state proxy (async, 403s for non-admin authors). Any future "published-only" client gate must use articleStatus.
- **Fonts:** Inter is self-hosted via @fontsource (400–900) imported in main.tsx; the Google Fonts CDN was removed because html-to-image cannot inline cross-origin stylesheets — the export silently ships fallback fonts with only a console SecurityError as a clue.
- **Capture readiness:** the export button stays disabled until `document.fonts.ready` + every `img` in the capture node has decoded; the fade-crop measurement re-runs after fonts settle (text metrics shift).
- Fade-to-white + "• • •" only render when card content genuinely overflows (measured via scrollHeight), never on short recaps.
