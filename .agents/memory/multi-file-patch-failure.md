---
name: Multi-file patch failures
description: A failed patch call may still have changed other files in the same call.
---

A multi-file apply_patch call is not all-or-nothing: one file's context mismatch can fail while updates to later files succeed.

**Why:** The tool reports individual file outcomes, and an overall nonzero result does not mean every file remained unchanged.

**How to apply:** Inspect each file's reported outcome after a failure. Retry only failed changes rather than blindly resubmitting the entire patch, especially when it includes appended text or newly added files.
