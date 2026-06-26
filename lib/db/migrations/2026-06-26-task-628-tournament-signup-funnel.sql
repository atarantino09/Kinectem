-- Task #628 — Tournament schedule signup funnel for outside teams.
-- Solo teams (no organization) + tournament/match/participant model.
-- Applied via raw SQL (additive, safe) rather than `drizzle-kit push` so we
-- don't touch unrelated schema drift on the live `teams` table.

-- Solo teams: organization becomes optional; add a creator/owner.
ALTER TABLE "teams" ALTER COLUMN "organization_id" DROP NOT NULL;
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "created_by_id" uuid
  REFERENCES "users"("id") ON DELETE SET NULL;

-- Tournaments.
CREATE TABLE IF NOT EXISTS "tournaments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "slug" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "location" text,
  "description" text,
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

-- Derived unique team-name participants per division/bracket.
CREATE TABLE IF NOT EXISTS "tournament_participants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tournament_id" uuid NOT NULL REFERENCES "tournaments"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "name_key" text NOT NULL,
  "division" text NOT NULL DEFAULT '',
  "bracket" text NOT NULL DEFAULT '',
  "age" text,
  "gender" text,
  "team_id" uuid REFERENCES "teams"("id") ON DELETE SET NULL,
  "claimed_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "claimed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "tournament_participants_tournament_id_idx"
  ON "tournament_participants" ("tournament_id");
CREATE INDEX IF NOT EXISTS "tournament_participants_team_id_idx"
  ON "tournament_participants" ("team_id");
CREATE UNIQUE INDEX IF NOT EXISTS "tournament_participants_unique_slot"
  ON "tournament_participants" ("tournament_id", "division", "bracket", "name_key");

-- One row per CSV match-slot; idempotent on (tournament, match_number).
CREATE TABLE IF NOT EXISTS "tournament_matches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tournament_id" uuid NOT NULL REFERENCES "tournaments"("id") ON DELETE CASCADE,
  "match_number" text NOT NULL,
  "match_date" date,
  "start_time" text,
  "age" text,
  "gender" text,
  "division" text NOT NULL DEFAULT '',
  "bracket" text NOT NULL DEFAULT '',
  "venue" text,
  "venue_state" text,
  "field" text,
  "home_participant_id" uuid REFERENCES "tournament_participants"("id") ON DELETE SET NULL,
  "away_participant_id" uuid REFERENCES "tournament_participants"("id") ON DELETE SET NULL,
  "home_score" integer,
  "away_score" integer,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "tournament_matches_tournament_id_idx"
  ON "tournament_matches" ("tournament_id");
CREATE UNIQUE INDEX IF NOT EXISTS "tournament_matches_unique_number"
  ON "tournament_matches" ("tournament_id", "match_number");
