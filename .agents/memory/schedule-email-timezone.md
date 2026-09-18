---
name: Schedule email timezone
description: Current timezone convention for schedule reminder and change-notice emails.
---

Format timed schedule emails in `America/New_York`, including the daylight-saving abbreviation. Keep all-day event dates formatted in UTC so their calendar date cannot shift.

**Why:** Schedule events are stored as instants without a persisted team timezone. The app displays the Eastern wall-clock time for the current user base, while formatting emails in UTC made a 5:00 PM event appear as 9:00 PM.

**How to apply:** Use the same formatter for reminder and cancel/postpone emails, including subjects, HTML, and plaintext. If team timezones are added later, replace the fixed zone with the persisted event/team zone.