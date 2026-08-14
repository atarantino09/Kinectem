---
name: Competition participant identity
description: Participant identity is (competition, name, gender); division/bracket are informational only
---

A competition team participant is identified by (tournament_id, lowercased name_key, LOWER(BTRIM(COALESCE(gender,'')))) — the unique expression index is `tournament_participants_unique_name_gender`. Division/bracket on the participant row are first-seen informational values only and are NOT part of identity.

**Why:** the old (tournament, division, bracket, name) key created duplicate-looking slots after schedule uploads. A first fix used name-only uniqueness, but production data proved that wrong: a real club fields same-named girls AND boys teams ("Ramapo Valley Red 2012", divisions U14 GIRLS vs U14 BOYS) — name-only would have merged two different teams, and the publish-time index creation failed on them. Gender is the minimal extra discriminator that keeps real teams separate without reintroducing per-bracket duplicates.

**How to apply:** any lookup/upsert of participants (CSV import slotKey, resolveParticipantId, claim flows) must key on nameKey + normalized gender, using the exact same normalization as the SQL expression (`LOWER(BTRIM(COALESCE(gender,'')))` — trim AND lowercase in JS). Per-game division/bracket must always come from `tournament_matches` columns, never the participant row. The merge migration ("participant-unique-per-name-gender") prefers claimed > pending > oldest keepers and repoints match FKs; it re-runs every boot, so its dedupe partitions and index expression must stay in lockstep with the schema index. Gotcha: if the index expression ever changes, `CREATE INDEX IF NOT EXISTS` will NOT replace the old-definition index in dev — drop it manually first.
