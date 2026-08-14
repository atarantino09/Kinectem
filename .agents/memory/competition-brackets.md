---
name: Competition brackets (recap sorting)
description: How the bracket feature works — seeding, touch-gated composer pick, extra-spec routes.
---

Brackets are organizer-defined labels for SORTING recaps only — no standings/seeding, and they never render on the published post.

- `competition_brackets` dedupes on `(tournament_id, label_key)` where `label_key` is lowercased/whitespace-normalized; `articles.bracket_id` is `ON DELETE SET NULL`.
- Auto-seed (`seedBracketsFromSchedule`) runs after CSV import AND lazily inside the organizer's GET brackets call (backfills pre-existing schedules). Idempotent via `onConflictDoNothing`; new brackets append after existing max sortOrder so organizer order is never clobbered. Gender only pre-filled when all rows for a label agree.
- **Why lazy seed in GET:** no separate backfill endpoint needed and the console panel "just works" for old competitions.
- Composer bracket pick is touch-gated exactly like competitionId (absent = unchanged; null = clear). Server also nulls `bracket_id` when a draft PATCH switches to a *different* competition — but NOT when autosave re-sends the same one, or every autosave would wipe it.
- Reorder endpoint requires the full exact id set (409 BRACKETS_STALE) — client sends the whole reordered list.
- All routes are extra-spec hand-written (openapi locked), pattern per competition-admins.ts; public competition read carries `brackets[]` + `bracketId` per featured recap for the filter chips (chips only shown for brackets actually used).
