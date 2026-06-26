---
name: Schedule event status writes
description: How to mutate schedule_events.status safely and which events are scoreable.
---

# Schedule event status writes

Any route that flips `schedule_events.status` (score capture flipping scheduled→completed, cancel, postpone) must guard the `UPDATE` on the status it just read: `WHERE id = ? AND status = <read-status>`. If 0 rows update, return 409 instead of overwriting.

**Why:** read-then-write on status is a TOCTOU race — a concurrent cancel/postpone landing between the SELECT and UPDATE would otherwise be clobbered (e.g. score capture re-marking a just-canceled game as completed).

**How to apply:** in `artifacts/api-server/src/routes/schedule.ts`. Score eligibility = event is a game/scrimmage/tournament AND (status `completed` OR (status `scheduled` AND startAt in the past)). Future/canceled/postponed events are NOT scoreable; the client (`ScoreSection`, `SeasonResults`) mirrors this same eligibility predicate so future games never show a score editor or appear in Season Results.
