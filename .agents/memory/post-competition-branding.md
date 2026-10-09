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

Use clearly visible organization color treatments on these cards, rather than barely visible accents. Show the team name without a redundant "Team" label.

**Why:** The user requested stronger organization branding and said the team name is already clear without that label.

**How to apply:** Carry both organization colors through the identity area and recap preview while keeping text readable; retain the compact layout.

Keep featured competition cards compact: the team name belongs prominently beside the organization identity, and image sharing belongs inside the full recap, not on these cards.

**Why:** The user could not identify the team on the card and explicitly asked to remove its image-share footer to save space.

**How to apply:** Preserve the card's link to the full story and its existing image-sharing process there; do not restore a card-level image-sharing button.

Favor the recap preview over matchup metadata on featured competition cards: no separate opponent line, and the headline stays on one line.

**Why:** The user explicitly requested these constraints so the game-recap preview can take up more space.

**How to apply:** Truncate long card headlines with the full title still accessible; keep opponent details in the full recap and give the card preview more visible lines.

Organization names, team names, and recap titles must stay on one line with responsive font shrinking, bounded by readable minimum sizes. Keep the identity area compact to favor the recap excerpt.

**Why:** The user explicitly requested smaller text for long names and headlines, but a limit for extremely long text instead of unreadably small fonts.

**How to apply:** Fit text within its available width, then use an ellipsis once the minimum size is reached. Keep the full text accessible and preserve font-load remeasurement.

Featured recap excerpts must be black in the light theme; bracket labels on the cards stay gray. Use bracket filter pills instead of repeating bracket headings above the cards. Counts and organization/team labels remain high-contrast. Do not display date headings above featured cards. Keep section spacing compact.

**Why:** The user removed the redundant above-card bracket headings in favor of the existing filter pills, while retaining gray on-card bracket labels and removing repeated dates to save space.

**How to apply:** Preserve organization-colored backgrounds and readable dark-theme contrast. Keep bracket labels and the date filter, but omit date/week headings from the featured-card display. Do not change schedule dates elsewhere.

The excerpt gradient ends at a hard horizontal edge above a solid “Read full recap” footer.

**Why:** The user wants the footer visually separated, like the solid identity/title area above the excerpt, rather than faded into the gradient.

**How to apply:** Keep the footer outside the gradient surface, retain the organization palette, and preserve the compact card height.
