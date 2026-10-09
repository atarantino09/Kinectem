---
name: Team removal safety
description: Authority and roster boundary for deleting or archiving organization team pages.
---

An organization owner/admin or effective platform admin may archive, restore, or permanently delete an organization team page through the team-page removal flow. Coach/team-staff membership alone does not grant these actions. Masquerading uses only the target user's authority. Standalone-team removal remains outside this flow.

**Why:** The user explicitly approved extending this flow to platform admins, superseding the earlier organization-only restriction, while retaining archive-then-delete safety.

**How to apply:** Every organization team, including an empty one, must be archived before permanent deletion. Archived teams may be deleted even with roster members. Explain both steps before confirming archival, and state that archiving preserves data and never automatically deletes. Deletion is separate and irreversible: require the exact team name and an explicit acknowledgment in both the UI and the server, and recheck persisted platform/org authority and archived state under transaction locks. User accounts and original competition schedules remain. Keep first-claim setup guidance consistent with this sequence.