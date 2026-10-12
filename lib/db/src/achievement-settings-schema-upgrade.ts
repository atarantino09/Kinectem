/**
 * Focused DEVELOPMENT schema sync used by post-merge setup and upgrade tests.
 * Not imported by the API bootstrap: Publish owns the production schema diff.
 * Keep equivalent to the achievementSettings Drizzle definition.
 */
export const ACHIEVEMENT_SETTINGS_SCHEMA_UPGRADE = `
DO $$ BEGIN
  IF to_regclass('public.achievement_settings') IS NOT NULL THEN
    ALTER TABLE achievement_settings ALTER COLUMN visibility SET DEFAULT 'public';
    ALTER TABLE achievement_settings DROP CONSTRAINT IF EXISTS achievement_settings_featured_check;
  END IF;
END $$;
`;
