---
name: Staged coach persistence
description: Staged coach drafts persist through skip/dismiss and stay side-effect-free until the post-claim owner acts.
---

Two durable rules for staged coach drafts on handed-off orgs:

1. **Skipping never destroys drafts.** Staged entries disappear only when the post-claim owner successfully invites them or removes them individually. Bulk clear-all is reserved for explicit cleanup — never wired to a dismiss/skip path.
   **Why:** the drafts represent pre-handoff work by platform admins; a dismissed one-time prompt used to wipe them permanently.

2. **Pre-claim, drafts are side-effect-free.** Any UI that can convert drafts into real invites must be gated off unclaimed orgs — platform admins pass manager checks via the admin bypass, so a manager check alone is NOT enough to keep pre-claim invite sending impossible.
   **Why:** a completion review caught a re-entry banner that let platform admins send live coach invites before handoff.

**How to apply:** when adding entry points to the post-claim coach setup flow, gate on claimed-org state (not just manager role) and clear staged rows per-entry on invite success only.
