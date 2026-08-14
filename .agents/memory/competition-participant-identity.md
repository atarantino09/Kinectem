---
name: Competition participant identity
description: Team names are unique per competition; division/bracket are informational only
---

A competition team participant is identified by (tournament_id, lowercased trimmed name) — the unique index is `tournament_participants_unique_name`. Division/bracket on the participant row are first-seen informational values only and are NOT part of identity.

**Why:** the old (tournament, division, bracket, name) key created one slot per context, so the same team appearing in pool + playoff brackets showed as duplicate team names after a schedule upload. User wants each exact name listed once.

**How to apply:** any lookup/upsert of participants (CSV import slotKey, resolveParticipantId, claim flows) must key on nameKey only. Per-game division/bracket must always come from `tournament_matches` columns, never the participant row. The merge migration ("participant-unique-per-name") preferred claimed > pending > oldest keepers and repointed match FKs; it must run before any external index push on a duplicated DB.
