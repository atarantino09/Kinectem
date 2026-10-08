---
name: Competition branding on recap posts
description: How competition-linked recaps carry operator branding on PostResponse and where the in-app competition page lives.
---

**Rule:** Competition-linked recaps (articles with `competition_id`) carry a `competition` block ({id, slug, name, logoUrl, brandColor, secondaryColor}) on PostResponse — an extra field beyond the locked openapi spec, same precedent as `recapKind`. Client reads it via narrow cast in PostCard and renders a branded strip linking to `/competitions/c/:slug`.

**Why:** openapi.yaml is locked; competition features live outside it. Branding is operator metadata only (no user data), so it's COPPA-safe to serialize everywhere.

**How to apply:** Populate via `loadCompetitionBrandMap()` (lib/competition-brand.ts) at every article serialization site you touch — batched, keyed by `a.competitionId`. The competition page component matches BOTH `/c/:slug` (public standalone) and `/competitions/c/:slug` (inside AppShell); the AppShell route must stay ordered before `/competitions/:id` (console) or "c" parses as an id.

Featured game-recap cards on competition pages must prominently identify the authoring team's parent organization with its logo and organization colors, while retaining the smaller event strip.

**Why:** The user explicitly requested organization logos and branding on these cards. Event branding alone does not identify the club that wrote the story.

**How to apply:** Keep the two identities distinct. Use the actual parent organization's saved brand, not the competition's logo or colors as an organization substitute. Teams without an organization must remain visible.
