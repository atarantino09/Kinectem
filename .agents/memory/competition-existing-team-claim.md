---
name: Competition existing-team claim
description: Claim branch to an existing team — advisory-lock atomicity + coach-confirmed mismatch gate.
---

- Slot claim accepts EITHER a new solo-team name OR an existing team (mutually exclusive); existing-team branch gates on canManageTeam and never creates a team row.
- Organization owners/admins may claim slots for every team in their organization, even without a coach roster role on each team; claim pickers should show the full club list and say this explicitly.
- **Why:** club admins coordinate competition entry for the whole organization, while coaches remain able to claim their own team.
- **How to apply:** keep manageable-team discovery and claim authorization aligned with organization-level management; never narrow club admins to personally coached teams.
- **One slot per team per competition** must be enforced INSIDE a transaction behind `pg_advisory_xact_lock(hashtext(tournamentId), hashtext(teamId))` — a plain precheck lets two concurrent claims on *different* slots both succeed (TOCTOU; same pattern as the per-tier team-cap guard).
- **Why:** verified live — concurrent double-claim yielded two rows before the lock, exactly one after.
- Name mismatch between slot and team is a **coach-confirmed UI gate** (checkbox ack; `lib/name-match.ts` loose normalize, no fuzzy match in v1), NOT server-enforced — openapi is locked, and organizers can reject via the pending-approval flow.
- Claimed games surface via the existing team-page tournament-schedule card automatically (keys off participant.teamId) — no schedule merge needed.
