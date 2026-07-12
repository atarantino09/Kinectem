---
name: Draft autosave clobbering server-derived fields
description: Extra-spec fields in the composer's draft PATCH body must be touch-gated or autosave silently clears server-derived values.
---

**Rule:** When the recap composer adds a new field to the draft PATCH body (`buildPatchBody` in `useNewPostForm.ts`), it must only be included after the user explicitly interacts with that control (a "touched" flag). Never send `field: null` unconditionally for draft sessions.

**Why:** The draft autosave PATCHes on every debounced keystroke. The server contract is "absent = unchanged, null = clear". `POST /posts` auto-derives some fields (e.g. the competition link from the team's claimed slots + game date); if the composer unconditionally sends `competitionId: competitionId || null`, the very first autosave clears the auto-derived link even though the coach never opened the picker. Caught by code review on the competition-picker feature.

**How to apply:** Follow the `competitionTouched` pattern: state starts untouched; the exported setter marks touched; programmatic resets (team change, draft-load prefill) do NOT mark touched; `buildPatchBody` spreads the field only when touched. Published-edit sessions omit these fields entirely.
