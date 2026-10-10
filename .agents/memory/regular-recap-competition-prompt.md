---
name: Regular recap competition choice
description: Remind coaches about active competitions even when they bypass the competition-game recap button.
---

Regular recap entry must prompt for the team’s competitions covering the recap’s game date, from the prior day through the end date. Both the prompt and competition recap buttons open at viewer-local **12:01 AM the day before competition start**. A season-long league and a midseason tournament can overlap; never choose between multiple competitions without the author’s decision.

**Why:** The user said coaches often use the regular recap button instead of the competition’s Write recap button, leaving competition games unlinked. They require an immediate, explained choice rather than relying on authors to find the editor’s competition fields.

The user explicitly required matching the competition buttons at 12:01 AM the prior day; do not revert to first-day prompting or the earlier midnight boundary.

**How to apply:** Preselect a sole eligible competition; require an explicit choice among overlapping events. Let authors choose the specific played game when listed, or continue with competition-level linkage. An explicit “not a competition game” choice must stay unlinked on create, autosave, reload, and publish; distinguish explicit null from an omitted automatic-link choice. Existing competition-specific entry points and loaded drafts/edits must retain their context without an extra reminder. Linking permits competition-admin curation; it must never automatically feature the recap.
