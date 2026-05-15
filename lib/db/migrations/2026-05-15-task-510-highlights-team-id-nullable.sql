-- Task #510 — Allow "Just my profile" highlights (no team / org scope).
-- Drops the NOT NULL on highlights.team_id; the FK stays the same and is
-- already ON DELETE CASCADE, so this is a no-op for existing rows.
ALTER TABLE highlights ALTER COLUMN team_id DROP NOT NULL;
