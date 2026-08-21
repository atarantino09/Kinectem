-- Keep the oldest pending shared player link for each team, then make the
-- intended one-link-per-team invariant durable. Accepted/revoked/expired
-- invitations and normal email-addressed invitations are deliberately untouched.
DELETE FROM roster_invites duplicate
USING roster_invites canonical
WHERE duplicate.team_id = canonical.team_id
  AND duplicate.invited_email IS NULL
  AND duplicate.status = 'pending'
  AND duplicate.role = 'player'
  AND canonical.invited_email IS NULL
  AND canonical.status = 'pending'
  AND canonical.role = 'player'
  AND (
    duplicate.created_at > canonical.created_at
    OR (
      duplicate.created_at = canonical.created_at
      AND duplicate.id::text > canonical.id::text
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS roster_invites_pending_email_less_player_team_uniq
  ON roster_invites (team_id)
  WHERE invited_email IS NULL AND status = 'pending' AND role = 'player';