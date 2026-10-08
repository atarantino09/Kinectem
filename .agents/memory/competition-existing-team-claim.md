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
- Differing participant and team names are allowed only as a deliberate, person-confirmed match, not through automatic fuzzy matching. Do not reject all name differences outright: competition exports and club team pages can use different labels.
- Claimed games surface via the existing team-page tournament-schedule card automatically (keys off participant.teamId) — no schedule merge needed.
- Claimed slots remain in the competition Teams directory; replace Claim with a Claimed status and retain the team-page link.
- **Why:** claiming locks ownership of a slot, but must not remove a participant from the public competition directory.
- **How to apply:** never filter participants by claim state; only explicit organizer hiding and viewer filters may remove rows.

Platform admins must be able to prelink competition teams to existing team pages in a partner directory before the clubs or coaches claim their organizations or teams.

**Why:** The user wants those team pages to already contain their competition schedules when real owners arrive. Administrative schedule linking is not an ownership claim.

**How to apply:** Keep support-driven linking ownership-neutral and distinct from ordinary coach claim approval. Do not require the platform admin to acquire roster or organization memberships merely to find and connect these teams.

Support-driven partner linking should put schedules on team pages immediately, without changing the competition's ordinary approval policy or subscribing the operator to those teams/competitions.

**Why:** This is preparation for future club owners, not an entry request or a personal follow. Using ordinary claims unchanged would leave review-gated schedules pending and subscribe admins to competitions they are only helping set up.

**How to apply:** Treat this as a distinct privileged operation; retain ordinary coach/org-admin approval behavior and keep operator access unavailable while masquerading.

Bulk schedule preparation is a multi-club operation. Changing club filters within a partner directory is navigation, not a new assignment batch.

**Why:** Operators prepare many clubs' schedules before their owners arrive; the user asked for clearer list-based matching rather than repeatedly visiting individual organization pages.

**How to apply:** Preserve queued matches while browsing other clubs. Compare readable competition-team and club/team-page identities, and use technical IDs only for deliberate disambiguation.

Admin schedule matching is a continuous workflow: scroll through team lists, keep the current assignment action visible, and return to matching after each confirmed batch instead of closing the dialog.

**Why:** The user explicitly corrected the paged-list approach, asked for “Use this team page” anchored at the top while scrolling, and wants to continue from Match teams after assigning schedules.

**How to apply:** Preserve the directory, filters and remaining choices across submissions. Keep unsuccessful assignments visible even when search filters hide their source rows. Allow X/outside dismissal once assignment is no longer in flight.

Do not present heuristic team-name ranking as a confidence percentage or proof of team identity.

**Why:** Identical or similar team names can belong to different clubs, age groups, or genders. A name-ranking score is not a calibrated probability that the schedule belongs to a particular page.

**How to apply:** Show distinct club/team identities and metadata, retain explicit selection and review, and keep any numerical ranking internal unless a genuine confidence model is introduced.

Coaches and organization admins managing a team must be able to release its entire competition schedule back to the original, unclaimed competition entry. Team-page removal must not delete the shared competition or its games, and must require two deliberate confirmation steps.

**Why:** The user explicitly requested coach/org-admin removal, a “double secure system” against accidents, and returning removed competition schedules to their original unclaimed teams.

**How to apply:** Treat whole-competition removal as releasing the team-page assignment, not deleting imported matches, team ownership, roster memberships, or opponents’ schedules. Preserve the original competition team identity and require management permission plus explicit confirmation.

Removing one competition game removes only that game from this team's views, including the manager view; the other games stay linked and the competition entry remains claimed. It is distinct from ordinary public-only hiding.

**Why:** The user explicitly chose to keep the other games when removing one game. Only removing the whole competition should return its entry to Unclaimed.

**How to apply:** Keep the original match and the opponent's schedule intact. A manager must still be able to release the whole competition after removing its last displayed game. A future deliberate re-claim should start with the complete original schedule, not inherit earlier team-page exclusions.
