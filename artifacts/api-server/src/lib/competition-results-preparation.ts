import { db, competitionBrackets, competitionResultImports, tournamentParticipants, type ResultGroup } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { ResultGroupSchema } from "./competition-results-intake";

const norm = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
function gender(s: string | null | undefined): string {
  const n = norm(s);
  if (/^(m|male|boys?|men|mens)$/.test(n) || /\bboys?\b/.test(n)) return "boys";
  if (/^(f|female|girls?|women|womens)$/.test(n) || /\bgirls?\b/.test(n)) return "girls";
  return n;
}
function age(s: string | null | undefined): string {
  const n = norm(s);
  const u = n.match(/^(?:u[- ]?|under[- ]?)?(\d{1,2})$/);
  return u ? `u${u[1]}` : n;
}
export function resultsContext(label: string, g?: string | null, a?: string | null) {
  const labelGender = label.match(/\b(boys?|girls?|male|female)\b/i)?.[0] ?? "";
  const labelAge = label.match(/\bu[- ]?\d{1,2}\b/i)?.[0] ?? "";
  return { gender: gender(g || labelGender), age: age(a || labelAge) };
}
type Bracket = { id: string; label: string; gender: string | null; ageGroup: string | null };
type Participant = { id: string; name: string; gender: string | null; age: string | null; bracketId: string | null };

export function automaticParticipant(name: string, group: ResultGroup, participants: Participant[]): string | null {
  const context = resultsContext(group.label, group.gender, group.age);
  const candidates = participants.filter(p => norm(p.name) === norm(name) &&
    (!context.gender || gender(p.gender) === context.gender) &&
    (!context.age || age(p.age) === context.age));
  // Never infer a gender, age, or identity from a similar name. Bracket
  // membership can disambiguate only candidates already compatible with it.
  const inBracket = candidates.filter(p => !!group.bracketId && p.bracketId === group.bracketId);
  if (inBracket.length > 0) return inBracket.length === 1 ? inBracket[0].id : null;
  // A unique name is not permission to move a Silver identity into Gold.
  // Only an unassigned, uniquely compatible identity with explicit source
  // age or gender can be used when this bracket has no matching participant.
  return candidates.length === 1 && !candidates[0].bracketId && !!(context.gender || context.age)
    ? candidates[0].id : null;
}

export function resultsBracketLabel(group: ResultGroup): string {
  const context = resultsContext(group.label, group.gender, group.age);
  const embedded = resultsContext(group.label);
  return [
    group.label,
    context.gender && context.gender !== embedded.gender ? (context.gender === "boys" ? "Boys" : context.gender === "girls" ? "Girls" : group.gender) : "",
    context.age && context.age !== embedded.age ? context.age.toUpperCase() : "",
  ].filter(Boolean).join(" · ");
}
export function automaticBracket(group: ResultGroup, brackets: Bracket[], participants: Participant[] = []): Bracket | null {
  const context = resultsContext(group.label, group.gender, group.age);
  const candidates = brackets.filter(b => {
    const other = resultsContext(b.label, b.gender, b.ageGroup);
    const names = new Set([...group.games.flatMap(g => [norm(g.home), norm(g.away)]), ...group.standings.map(s => norm(s.team))]);
    const members = participants.filter(p => p.bracketId === b.id);
    // Older brackets may lack age/gender metadata. Existing participating
    // teams can establish the missing context, but any conflicting member
    // prevents us from merging a narrower source into a broader bracket.
    const evidence = members.some(p => names.has(norm(p.name)) &&
      (!context.gender || gender(p.gender) === context.gender) &&
      (!context.age || age(p.age) === context.age)) &&
      members.every(p => (!context.gender || !p.gender || gender(p.gender) === context.gender) &&
        (!context.age || !p.age || age(p.age) === context.age));
    return [norm(group.label), norm(resultsBracketLabel(group))].includes(norm(b.label)) &&
      (context.gender === other.gender || (!!context.gender && !other.gender && evidence)) &&
      (context.age === other.age || (!!context.age && !other.age && evidence));
  });
  return candidates.length === 1 ? candidates[0] : null;
}

/** Merge repeated source tables without losing source names or unknown scores. */
export function canonicalResultGroups(input: ResultGroup[]): ResultGroup[] {
  const groups = new Map<string, ResultGroup>();
  for (const raw of input) {
    const g = ResultGroupSchema.parse(raw);
    const context = resultsContext(g.label, g.gender, g.age);
    const identity = JSON.stringify([norm(g.label), context.gender, context.age]);
    const existing = groups.get(identity);
    if (existing) {
      existing.games.push(...g.games);
      existing.standings.push(...g.standings);
    } else groups.set(identity, { ...g, complete: false, games: [...g.games], standings: [...g.standings] });
  }
  return [...groups.values()].map(g => {
    const games = [...new Map(g.games.map(x => [
      JSON.stringify([x.home, x.away, x.date, x.group, x.homeScore, x.awayScore]), x,
    ])).values()].map((x, i) => ({ ...x, id: `game-${i + 1}` }));
    const standings = new Map<string, ResultGroup["standings"][number]>();
    for (const s of g.standings) {
      const old = standings.get(s.team);
      standings.set(s.team, old ? {
        ...old,
        position: old.position === s.position ? old.position : null,
        points: old.points === s.points ? old.points : null,
      } : s);
    }
    // A full set of game scores does NOT prove that a tournament is finished.
    return { ...g, complete: false, games, standings: [...standings.values()] };
  });
}

/** Persist a safe snapshot once; repeated calls preserve any operator choices. */
export async function prepareResultsImport(competitionId: string, importId: string) {
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${competitionId + ":results-prepare"}))`);
    const [snapshot] = await tx.select().from(competitionResultImports).where(and(
      eq(competitionResultImports.id, importId), eq(competitionResultImports.competitionId, competitionId),
    )).for("update");
    if (!snapshot) throw new Error("Results import not found.");
    if (snapshot.status === "blocked" || snapshot.status === "unsupported" || !snapshot.groups.length) {
      throw new Error(snapshot.message || "No usable results were found. Choose another results source.");
    }
    if (snapshot.confirmed) return snapshot;
    const groups = canonicalResultGroups(snapshot.groups);
    if (groups.length > 40 || groups.reduce((n, g) => n + g.games.length + g.standings.length, 0) > 1000) {
      throw new Error("The results source exceeds the 40-bracket or 1,000-row import limit.");
    }
    const brackets = await tx.select().from(competitionBrackets).where(eq(competitionBrackets.tournamentId, competitionId));
    const participants = await tx.select().from(tournamentParticipants).where(eq(tournamentParticipants.tournamentId, competitionId));
    for (const group of groups) {
      if (!group.games.length && !group.standings.length) throw new Error("No usable games or standings were found.");
      let bracket = automaticBracket(group, brackets, participants);
      if (!bracket) {
        const preferred = resultsBracketLabel(group).slice(0, 170);
        const context = resultsContext(group.label, group.gender, group.age);
        const identity = createHash("sha256").update(JSON.stringify([norm(group.label), context.gender, context.age])).digest("hex").slice(0, 12);
        // A generic existing label may represent a different gender/age. Do
        // not silently reuse it merely because the unique label is occupied.
        const label = brackets.some(b => norm(b.label) === norm(preferred))
          ? `${preferred} · Results ${identity}` : preferred;
        const labelKey = norm(label);
        const [created] = await tx.insert(competitionBrackets).values({
          tournamentId: competitionId, label, labelKey,
          gender: context.gender || null, ageGroup: context.age || null,
          sortOrder: Math.max(-1, ...brackets.map(b => b.sortOrder)) + 1,
        }).onConflictDoNothing().returning();
        const [found] = created ? [created] : await tx.select().from(competitionBrackets).where(and(
          eq(competitionBrackets.tournamentId, competitionId), eq(competitionBrackets.labelKey, labelKey),
        ));
        if (!found) throw new Error("Couldn't prepare this bracket. Please retry.");
        bracket = found;
        if (!brackets.some(b => b.id === found.id)) brackets.push(found);
      }
      group.bracketId = bracket.id;
      group.games = group.games.map(x => ({
        ...x, homeParticipantId: automaticParticipant(x.home, group, participants),
        awayParticipantId: automaticParticipant(x.away, group, participants),
      }));
      group.standings = group.standings.map(s => ({ ...s, participantId: automaticParticipant(s.team, group, participants) }));
    }
    const [saved] = await tx.update(competitionResultImports).set({
      groups, confirmed: true,
      message: `${groups.length} bracket(s) prepared automatically. Missing scores stay unknown; team names without a safe match remain unlinked.`,
    }).where(eq(competitionResultImports.id, snapshot.id)).returning();
    return saved;
  });
}

/** Bound AI input automatically instead of asking operators to split a bracket. */
export function draftableResults(group: ResultGroup): ResultGroup {
  let remaining = 35_000, rows = 120;
  const take = <T,>(items: T[]): T[] => items.filter(item => {
    const size = JSON.stringify(item).length;
    if (rows <= 0 || size > remaining) return false;
    rows--; remaining -= size;
    return true;
  });
  const standings = take(group.standings.slice(0, 40));
  const games = take([...group.games].sort((a, b) =>
    Number(b.homeScore != null && b.awayScore != null) - Number(a.homeScore != null && a.awayScore != null)));
  return { ...group, games, standings, complete: group.complete && games.length + standings.length === group.games.length + group.standings.length };
}
