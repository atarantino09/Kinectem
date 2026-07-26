---
name: Recap approval is opt-in per org
description: Coach recap publishes are direct by default; org toggle restores the pending queue — test suites must flip it ON to exercise pending flows.
---

The org column `require_recap_approval` (default false) gates the recap pending-approval queue.

**Rule:** Non-admin recap publishes (POST /posts long-form AND the draft-publish endpoint — two separate status decisions) go `published` unless the org toggle is ON. Admin/owner authors and solo teams (org null) always publish directly. Turning the toggle OFF never auto-publishes already-pending rows; the queue/approve endpoints keep working for legacy items.

**Why:** Product flipped the default (pre-existing tests assumed pending); the queue is now opt-in.

**How to apply:**
- Any test asserting `pending_approval` must first set the toggle ON (posts.test.ts has `setRequireRecapApproval` + a beforeEach resetting all orgs to false; auto-tag-recap.test.ts flips inline).
- `requireRecapApproval` is serialized by `toOrganization` only for owner/admin viewers (extra-spec field); PATCH org accepts strict boolean only.
- Client messaging keys off the server's `requiresApproval` response flag — no client-side duplication of the rule.
- Pitfall: `GET /users?q=Marcus` first result is NOT reliably Marcus (returned Jordan); in tests use `loginAs(...).user.id` instead of search.
