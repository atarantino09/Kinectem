---
name: Competition CSV import header aliasing
description: Schedule CSV import must accept scheduling-tool exports as-is; forgiving header matching is a product requirement, not a nicety.
---

**Rule:** The competition schedule import accepts raw exports from third-party scheduling tools (e.g. GotSport). Headers are normalized (lowercase, strip non-alphanumeric except `#`) and matched against per-column alias lists; each header cell binds to at most one canonical column. Only `match #`, `date`, `home team`, `away team` are required — everything else (division, bracket, venue, state, scores…) is optional and lands as null/"".

**Why:** Organizers upload whatever their tool exported. Requiring the exact canonical 14-column header blocked real users (their file had `Match #,Date,Start Time,Age,Gender,Venue,Field,Home Team,Away Team`). Explicit user directive: "it should just take the actual doc and do it all in the back end."

**How to apply:** When touching the import path, never re-tighten the required-column set or exact-match headers. New columns should be added as optional with aliases. Client UX: picking a file auto-uploads immediately; the paste-CSV textarea is a collapsed fallback, not the primary path.
