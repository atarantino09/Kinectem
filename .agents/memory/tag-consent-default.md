---
name: Tag consent is opt-in (auto-approve default)
description: Recap tags auto-approve for everyone; guardians opt IN to per-tag review; explicit-choice stamping rules
---

Recap (article) tags now auto-approve by default for ALL accounts, including minors — the COPPA-era "minors require per-tag consent" default was deliberately reversed at the product owner's direction. Guardians opt IN via the "Require tag consent" toggle.

**Rules to keep:**
- Any route that writes `users.require_tag_consent` MUST also set `tag_consent_set_explicitly = true`. The boot-time backfill flips consent off only for non-explicit minor/guardian-linked rows, so an unstamped write can be silently reverted.
- Never re-add a boot migration that asserts `require_tag_consent = true` for minors — migrations re-run every boot and it would clobber the new default (this was exactly the removed TASK_359 statement).
- Highlight tags stay pending-by-design (hard-coded), independent of consent flags — out of scope for auto-approve.
- Parent-created child accounts often have `is_minor = false` but `parent_id`/guardian links set — treat "guardian-linked" (parent_id OR active guardian_link) as the minor-account predicate for consent logic, not `is_minor` alone.
- Guardians of minors get an informational bell when a tag auto-approves (notifyGuardiansOfApprovedTags in article-tagging.ts); pending tags keep the "please review" family-inbox path.

**Why:** parents were missing the approval step so recaps never appeared on kids' profiles.
