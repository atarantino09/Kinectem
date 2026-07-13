---
name: Multi-guardian links & parentId mirror
description: guardian_links is the parent↔child source of truth; users.parentId is a mirror of the primary ACTIVE guardian because locked coppa.ts reads it.
---

# Multi-guardian links & the parentId mirror

**Rule:** `guardian_links` (status pending/active/revoked, one `is_primary` active row per child) is the source of truth for the parent↔child graph. `users.parentId` is a dual-written MIRROR of the primary ACTIVE guardian and must never drift — the locked `coppa.ts` still reads `parentId`.

**Why:** The OpenAPI spec and `coppa.ts` are locked, so multi-parent support had to be layered on without changing the single-parent read path they depend on.

**How to apply:**
- Any write that changes link status or primary-ness must call `syncParentIdMirror(childId)` afterwards (it also self-heals a missing primary flag).
- Legacy code that writes `users.parent_id` directly is covered by a DB trigger (`users_parent_id_guardian_link_sync`, registered startup migration): sets create an active link; clears/changes revoke the OLD pair only while still primary+active (so app-code transfer-primary, which demotes first, is untouched); a clear with remaining active co-guardians promotes the oldest one and mirrors it back (re-entrant trigger fire no-ops).
- Fan-out to guardians must use `getActiveGuardianIds`/`notifyAllGuardiansOfPendingItem`, never `parentId` alone — `parentId` only names the PRIMARY guardian.
- The live-pair partial unique index (child, guardian, status<>revoked) means invite claim and accept must be idempotent: claim only the oldest pending row per child + swallow 23505; accept revokes any other live pair link inside the advisory-locked tx before activating.
- Guardian-aware shim `patchParentIdForViewer` exists because locked `filterOutMinors` only honors the single mirror — non-primary guardians would otherwise lose sight of their child in list/search surfaces.
- Test fixtures that insert `parent_id` directly get links auto-created by the trigger (test DB schema is pg_dumped from dev, so the trigger rides along).
- Invite model is deliberately TOKEN-LESS (diverges from the original plan's "hashed invite token"): accepting is session-authenticated, and an unclaimed pending invite is claimed the first time a signed-in user with the invited (login-verified) email lists their children.
  **Why:** the locked OpenAPI spec has no token param on accept/decline, and email ownership is already proven by login — a mailed token would add a second, weaker proof plus expiry/rotation surface.
  **How to apply:** don't add invite tokens to guardian_links; keep invite responses generic (no account-existence probe); any future token would require a spec change first.
