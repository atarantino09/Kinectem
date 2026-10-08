---
name: Competition brackets (recap sorting)
description: How the bracket feature works — seeding, touch-gated composer pick, extra-spec routes.
---

Brackets are organizer-defined labels for SORTING recaps only — no standings/seeding, and they never render on the published post.

- Published Teams are deliberately grouped from the schedule-derived participant fields in this order: age, gender, then division/bracket group. Do not use `bracketId` as the Teams grouping key: identical group labels may exist for different ages or genders.
- **Why:** organizer bracket edits should remain available for recap organization without collapsing visibly distinct imported team categories.
- **How to apply:** preserve bracket assignment and its sort order for recap UI; keep schedule re-imports refreshing each participant slot's display age/group fields so the public Teams page reflects the current CSV.
- `competition_brackets` dedupes on `(tournament_id, label_key)` where `label_key` is lowercased/whitespace-normalized; `articles.bracket_id` is `ON DELETE SET NULL`.
- Auto-seed (`seedBracketsFromSchedule`) runs after CSV import AND lazily inside the organizer's GET brackets call (backfills pre-existing schedules). Idempotent via `onConflictDoNothing`; new brackets append after existing max sortOrder so organizer order is never clobbered. Gender only pre-filled when all rows for a label agree.
- **Why lazy seed in GET:** no separate backfill endpoint needed and the console panel "just works" for old competitions.
- Composer bracket pick is touch-gated exactly like competitionId (absent = unchanged; null = clear). Server also nulls `bracket_id` when a draft PATCH switches to a *different* competition — but NOT when autosave re-sends the same one, or every autosave would wipe it.
- Reorder endpoint requires the full exact id set (409 BRACKETS_STALE) — client sends the whole reordered list.
- All routes are extra-spec hand-written (openapi locked), pattern per competition-admins.ts; public competition read carries `brackets[]` + `bracketId` per featured recap for the filter chips (chips only shown for brackets actually used).

## Overall bracket versus subgroups
The user defines the full group, such as “2016 U10 Boys Gold,” as the overall bracket. “Bracket A” and “Bracket B” inside it are subgroups, not separate overall brackets for featured recap browsing.

**Why:** the user explicitly clarified that “Gold” or “Bracket A” alone is not the intended overall name; preserve the year, age, gender, and tier in the group name.

**How to apply:** use the linked game's division when available, with the saved overall bracket name as a fallback. Keep subgroup detail separate, combine A/B under the overall recap filter and heading, and show the overall name as a small card label. Do not guess a missing full name from team names or rewrite persisted bracket assignments.

The bracket dropdown must list every overall group, including groups with zero featured recaps, and show each group's total admin-featured recap count.

**Why:** the user wants visitors to distinguish an empty bracket from an omitted one and know how much featured coverage each has.

**How to apply:** include saved groups and schedule divisions even before any recaps are featured. Counts represent the complete publicly eligible curated set, not just a newest-N subset or search-filtered results. Keep zero-count choices selectable.
