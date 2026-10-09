---
name: Team removal safety
description: Authority and roster boundary for deleting or archiving organization team pages.
---

Only an actual organization owner or organization admin may archive, restore, or permanently delete its team page through the team-page removal flow. Platform-admin authority alone and coach/team-staff membership do not grant these actions.

**Why:** The user explicitly restricted this flow to org admins and replaced the previous empty-roster deletion rule with an archive-then-delete process.

**How to apply:** Every team, including an empty one, must be archived before permanent deletion. Archived teams may be deleted even with roster members. Explain both steps before confirming archival, and state that archiving preserves data and never automatically deletes. Deletion is separate and irreversible: require the exact team name and an explicit acknowledgment in both the UI and the server, and recheck the stored org role and archived state under transaction locks. User accounts and original competition schedules remain. Keep first-claim setup guidance consistent with this sequence.