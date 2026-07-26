-- Task #800 — Recap tags auto-approve by default; per-tag review is an
-- explicit guardian opt-in from the Family dashboard. Idempotent; the
-- runtime copy lives in artifacts/api-server/src/lib/migrations.ts.

-- 1. Track deliberate toggle writes so re-runs never clobber them.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS tag_consent_set_explicitly boolean NOT NULL DEFAULT false;

-- 2. Undo the legacy signup/COPPA auto-default (explicit opt-ins kept).
-- Covers is_minor accounts AND parent-created child accounts (parent_id /
-- active guardian link set but is_minor unset). Self-managed adults who
-- turned consent on themselves are untouched.
UPDATE users
   SET require_tag_consent = false
 WHERE require_tag_consent = true
   AND tag_consent_set_explicitly = false
   AND (
     is_minor = true
     OR parent_id IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM guardian_links gl
        WHERE gl.child_id = users.id AND gl.status = 'active'
     )
   );

-- 3. Approve recap tags stuck pending that today's insert logic would
--    approve (user gate off AND no active gating guardian). Declined
--    tags and highlight tags untouched.
UPDATE article_tags at
   SET status = 'approved', updated_at = NOW()
 WHERE at.status = 'pending'
   AND EXISTS (
     SELECT 1 FROM users u
      WHERE u.id = at.user_id
        AND u.require_tag_consent = false
   )
   AND NOT EXISTS (
     SELECT 1
       FROM guardian_links gl
       JOIN users g ON g.id = gl.guardian_id
      WHERE gl.child_id = at.user_id
        AND gl.status = 'active'
        AND g.require_tag_consent = true
   );
