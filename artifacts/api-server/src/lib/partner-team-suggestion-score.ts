import { sql, type SQL } from "drizzle-orm";

// No extension or stored index is required. The query ranks the entire selected
// directory before applying its small result limit, not an alphabetical page.
export function partnerTeamSuggestionScore(sourceName: string, teamName: SQL, clubName: SQL): SQL<number> {
  const normalize = (name: SQL) => sql`trim(regexp_replace(lower(${name}), '[^[:alnum:]]+', ' ', 'g'))`;
  const source = normalize(sql`${sourceName}`);
  const team = normalize(teamName);
  const combined = normalize(sql`${clubName} || ' ' || ${teamName}`);
  const phrase = (a: SQL, b: SQL) => sql`length(${a}) >= 4 AND position(' ' || ${a} || ' ' in ' ' || ${b} || ' ') > 0`;
  const size = (name: SQL) => sql`(SELECT count(DISTINCT word) FROM unnest(regexp_split_to_array(${name}, ' ')) AS word)`;
  const similarity = (name: SQL) => sql`floor(70.0 * (
    SELECT count(*) FROM (
      SELECT unnest(regexp_split_to_array(${source}, ' ')) AS word
      INTERSECT SELECT unnest(regexp_split_to_array(${name}, ' '))
    ) shared
  ) / greatest(1, ${size(source)}, ${size(name)}))::int`;
  return sql<number>`CASE
    WHEN length(${source}) = 0 THEN 0
    WHEN ${source} = ${team} THEN 100
    WHEN ${source} = ${combined} THEN 95
    WHEN (${phrase(source, team)}) OR (${phrase(team, source)}) OR (${phrase(source, combined)}) THEN 80
    ELSE greatest(${similarity(team)}, ${similarity(combined)})
  END`;
}
