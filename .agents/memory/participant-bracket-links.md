---
name: Participant bracket links (Teams grouping)
description: Competition team slots attach to sorting brackets by id; deletion-vs-lazy-seed trap.
---

Competition team slots carry an id-based link to a sorting bracket (FK ON DELETE SET NULL), so bracket renames/reorders mirror onto the grouped Teams list and deletes drop teams to "Other" — same model recaps use.

- **Rule:** never re-run the schedule-derived bracket seeder outside an explicit schedule import. Linking participants (null-only, label-key match) is always safe; seeding is not.
- **Why:** per-label seeding on every console load resurrects brackets the organizer just deleted and re-adopts their teams. A durable "seeded/managed" stamp on the competition distinguishes a deliberately emptied bracket list (delete-all) from a never-seeded pre-feature one — a zero-count check alone can't.
- Schedule import requires a group value per game row (division-or-bracket column mandatory; whole upload rejected naming offending rows, dry-run included). This deliberately tightened the old lenient 4-column policy at the user's request.
- The participant `bracketId` in the public competition read is an extra-spec field (openapi locked).

**How to apply:** gate any lazy bracket backfill on the seeded stamp being unset AND zero brackets; stamp on every seed run and on deliberate bracket deletion.
