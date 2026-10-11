---
name: Recap submission intent
description: Preserve legitimate separate recaps; distinguish retry identity from content similarity.
---

Do not use team, title, game date, or identical body text as a uniqueness rule
for recaps. Separate submissions with identical content remain legitimate.
Existing duplicate-looking posts and their reactions must not be automatically
merged, hidden, or deleted as part of submission-safety work.

**Why:** The product requirement explicitly distinguishes one retried submission
from legitimate separate recaps. Identical stored text and close timestamps
cannot establish what the coach intended.

**How to apply:** Protect retries using operation identity, not a content hash
uniqueness constraint. Investigate persisted IDs before blaming feed rendering.
Any cleanup of existing posts needs a separate, explicitly authorized decision.
