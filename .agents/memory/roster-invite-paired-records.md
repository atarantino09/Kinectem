---
name: Roster invite paired records
description: Known-email team invites create TWO rows; revoke/re-invite must keep them consistent.
---
A `POST /teams/:teamId/invites` for an email that already has a Kinectem
account creates BOTH a `roster_invites` row AND a `pending`
`roster_entries` row (plus notification + auto-follow). Account-less
emails create only the `roster_invites` row (+ coach invite email).

**Rule:** anything that ends an invite must keep the two rows in lockstep.
Revoke (DELETE invite) must, in the SAME transaction, delete the matching
still-`pending` `roster_entries` row for the invited email's account
(never touch an `accepted` membership). The send-invite placement guard
must only short-circuit for a genuinely `accepted` entry — a leftover
pending/declined row must be reused (reset to pending) and the
notification/auto-follow re-fired.

**Why:** revoking only flipped the invite to `revoked` and left the
pending `roster_entries` behind; the re-invite guard saw that stale row
and skipped placement/notification/auto-follow, so re-invites silently
no-op'd while still returning 201.
