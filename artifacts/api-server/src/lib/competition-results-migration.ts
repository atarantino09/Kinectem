export const COMPETITION_RESULTS_MIGRATION = {
  name: "competition-results-and-canonical-tournament-recaps",
  sql: `
    CREATE TABLE IF NOT EXISTS competition_result_imports (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      competition_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      client_id uuid NOT NULL, kind text NOT NULL, source_url text,
      imported_at timestamp NOT NULL DEFAULT now(), status text NOT NULL,
      message text NOT NULL, groups jsonb NOT NULL,
      confirmed boolean NOT NULL DEFAULT false, results_as_of text NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS competition_result_imports_client_uniq
      ON competition_result_imports(competition_id, client_id);
    CREATE TABLE IF NOT EXISTS competition_tournament_recaps (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      competition_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      bracket_id uuid NOT NULL REFERENCES competition_brackets(id) ON DELETE NO ACTION,
      draft jsonb NOT NULL, published jsonb, revision integer NOT NULL DEFAULT 1,
      generation_request_id uuid, published_at timestamp,
      updated_at timestamp NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS competition_tournament_recaps_bracket_uniq
      ON competition_tournament_recaps(competition_id, bracket_id);
    CREATE TABLE IF NOT EXISTS competition_recap_placements (
      recap_id uuid NOT NULL REFERENCES competition_tournament_recaps(id) ON DELETE CASCADE,
      team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      created_at timestamp NOT NULL DEFAULT now(),
      PRIMARY KEY (recap_id, team_id)
    );
    CREATE INDEX IF NOT EXISTS competition_recap_placements_team_idx
      ON competition_recap_placements(team_id);
  `,
};
