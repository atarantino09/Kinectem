---
name: Combined recap pill / recap_kind marker
description: How combined season/tournament recaps are distinguished from single-game recaps on the post card.
---

# Combined recap distinct pill

Combined season/tournament recaps (one AI article woven from many published game
recaps, published via the generic `POST /posts` long-post path) are marked by the
nullable `articles.recap_kind` column. Value `"combined"` = multi-game recap;
`NULL` = normal single-game recap.

- The marker is serialized into the `PostResponse` JSON by the **shared**
  `articleToPost`/`basePost` mapper, so it reaches every post surface
  (feed/team/profile/org/detail) automatically. It is an **extra field outside
  the locked `openapi.yaml`** — read it client-side via a narrow cast
  (`(post as { recapKind?: string|null }).recapKind`), same precedent as
  org-claim `hasOwner`.
- The create handler whitelists only `"combined"` (anything else → null).
- `PostCard` shows the pill **"Combined Recap"** for `recapKind === "combined"`,
  otherwise the usual "Game Recap" (highlights → "Highlight", org posts →
  "Update").
- The team CTA button is labeled **"Combined Recap"** (covers season AND
  tournament); `data-testid` stays `btn-season-recap`.

**Why:** product wanted multi-game recaps visually distinct from single-game
ones, and the feature reuses the generic create endpoint (not a dedicated route).
**Caveat:** `recapKind` is client-forgeable on any long post, but impact is
label/presentation only — no authz or data exposure. Don't rely on it for
provenance without server-side enforcement.
