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

**Rule:** An already accepted staff assignment must prevent a new coach
invitation for that account and team; resolve its obsolete pending coach
invites without changing the active position. Do not blanket-revoke
player invitations just because the addressed account is already on the
roster in any role: a player's invitation email may address a parent who
still needs the child-selection flow.

**Why:** a team Admin was shown as both active staff and a pending Coach
invite; broad email-only cleanup could wrongly cancel a legitimate
parent-facing invitation for a different player.

**How to apply:** resolve staff invites against the accepted account's
team membership, but keep player chooser invitations distinct from
staff assignments and preserve the accepted member's position.

**Rule:** An actual owner/admin of the team's organization explicitly
inviting their own account must become active immediately in every
position, including player. This exception applies to both existing-user
adds and email/bulk invites, not just coach invitations. Resolve their
obsolete self-sent pending invitations as well, without replacing an
already-active position.

**Why:** The user explicitly requires org-admin self-invites never to
remain pending. This overrides the earlier player-chooser exception for
self-sent org-admin invitations only.

**How to apply:** Verify identity and actual role in the target team's
org; global platform-admin authority alone is insufficient. Preserve
parent-facing player invites sent by somebody else. Repair old self-sent
pending records consistently when loading either roster or invitations,
but do not activate new memberships on archived teams.
