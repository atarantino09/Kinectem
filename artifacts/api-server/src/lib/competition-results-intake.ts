import { createHash } from "node:crypto";
import type { ResultGroup } from "@workspace/db";
import { z } from "zod";
import { fetchPublicResultsHtml, publicResultsUrl, resultsFetchBudget } from "./public-results-fetch";

const text = z.string().trim().max(200);
const score = z.number().int().min(0).max(1000).nullable();
export const ResultGroupSchema = z.object({
  key: text.min(1), label: text.min(1), gender: text, age: text,
  bracketId: z.string().uuid().nullable(), complete: z.boolean(),
  games: z.array(z.object({
    id: text.min(1), home: text.min(1), away: text.min(1),
    homeScore: score, awayScore: score,
    date: text, group: text,
    homeParticipantId: z.string().uuid().nullable(),
    awayParticipantId: z.string().uuid().nullable(),
  }).strict()).max(500),
  standings: z.array(z.object({
    team: text.min(1), position: z.number().int().min(1).max(1000).nullable(),
    points: z.number().min(0).max(100000).nullable(),
    participantId: z.string().uuid().nullable(),
  }).strict()).max(500),
}).strict();
export interface ResultsIntake {
  status: "ready" | "partial" | "blocked" | "unsupported";
  message: string;
  groups: ResultGroup[];
}
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const aliases = {
  label: ["bracket", "division", "flight", "agegroup", "category"],
  home: ["home", "hometeam", "team1"], away: ["away", "awayteam", "team2"],
  homeScore: ["homescore", "score1", "homegoals"], awayScore: ["awayscore", "score2", "awaygoals"],
  combinedScore: ["score", "result"], date: ["date", "gamedate", "matchdate"],
  gender: ["gender", "sex"], age: ["age", "agegroup"], group: ["group", "round", "stage", "pool"],
  team: ["team", "teamname"], position: ["position", "rank", "place"], points: ["points", "pts"],
};

// RFC4180 quoted commas/newlines plus tab-delimited clipboard tables.
export function readResultsRows(input: string): string[][] {
  if (Buffer.byteLength(input) > 500_000) throw new Error("Results text is limited to 500 KB.");
  const delimiter = input.split(/\r?\n/, 1)[0].includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [], value = "", quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') {
      if (quoted && input[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (c === delimiter || c === "\n")) {
      row.push(value.trim()); value = "";
      if (c === "\n") { if (row.some(Boolean)) rows.push(row); row = []; }
    } else if (c !== "\r") value += c;
    if (rows.length > 1000) throw new Error("Import at most 1,000 results rows at a time.");
  }
  if (quoted) throw new Error("Unclosed quoted cell in results table.");
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  if (rows.some(r => r.length > 40 || r.some(v => v.length > 200))) throw new Error("Results cells must be at most 200 characters, with at most 40 columns.");
  return rows;
}

export function parseResultsTable(input: string, defaultLabel = ""): ResultsIntake {
  const rows = readResultsRows(input.replace(/^\uFEFF/, ""));
  if (rows.length < 2) return { status: "unsupported", groups: [], message: "No results rows found. Include column headers and games or standings." };
  const headers = rows.shift()!.map(normalize);
  const col = (field: keyof typeof aliases) => headers.findIndex(h => aliases[field].includes(h));
  const get = (r: string[], field: keyof typeof aliases) => col(field) < 0 ? "" : (r[col(field)] ?? "");
  const games = col("home") >= 0 && col("away") >= 0;
  const standings = col("team") >= 0 && (col("position") >= 0 || col("points") >= 0);
  if (!games && !standings) return { status: "unsupported", groups: [], message: "Unsupported columns. Games need Home Team, Away Team, Home Score, Away Score; standings need Team and Position or Points. Include Bracket." };
  const groups = new Map<string, ResultGroup>();
  let missing = false;
  let skipped = 0;
  const number = (v: string, max = 1000) => /^\d+$/.test(v) && Number(v) <= max ? Number(v) : null;
  rows.forEach((r, index) => {
    const label = get(r, "label") || defaultLabel || "Unspecified bracket";
    const gender = get(r, "gender"), age = get(r, "age");
    const key = createHash("sha256").update(JSON.stringify([label, gender, age])).digest("hex").slice(0, 24);
    const group = groups.get(key) ?? { key, label, gender, age, bracketId: null, complete: false, games: [], standings: [] };
    if (games) {
      const home = get(r, "home"), away = get(r, "away");
      if (!home || !away) { skipped++; return; }
      const combined = get(r, "combinedScore").match(/^(\d+)\s*[-:–]\s*(\d+)$/);
      const homeScore = number(get(r, "homeScore") || combined?.[1] || "");
      const awayScore = number(get(r, "awayScore") || combined?.[2] || "");
      if (homeScore == null || awayScore == null) missing = true;
      group.games.push({ id: `row-${index + 1}`, home, away, homeScore, awayScore, date: get(r, "date"), group: get(r, "group"), homeParticipantId: null, awayParticipantId: null });
    } else {
      const team = get(r, "team");
      if (!team) { skipped++; return; }
      const position = number(get(r, "position")), points = number(get(r, "points"), 100000);
      if (position == null && points == null) missing = true;
      group.standings.push({ team, position: position === 0 ? null : position, points, participantId: null });
    }
    groups.set(key, group);
  });
  const parsed = [...groups.values()];
  if (parsed.length > 40 || parsed.some(g => g.games.length > 500 || g.standings.length > 500)) throw new Error("Import at most 40 brackets and 500 rows per bracket.");
  if (!parsed.length) return { status: "unsupported", groups: [], message: "No usable results were found. Paste a table with team names and scores." };
  return {
    status: missing || skipped ? "partial" : "ready", groups: parsed,
    message: `${parsed.length} bracket(s) detected.${missing ? " Some scores/standings are missing." : ""}${skipped ? ` ${skipped} incomplete rows were skipped.` : ""} Review identities and confirm whether each bracket is complete; no tournament winner is inferred.`,
  };
}

function htmlText(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/\s+/g, " ").trim();
}
export function extractResultsHtml(html: string, finalUrl = ""): ResultsIntake & { links: string[] } {
  if (/verify_captchas|recaptcha|hcaptcha|g-recaptcha|cf-chl-|captcha|verify (?:you are|you're) human/i.test(html + finalUrl) ||
    /<input\b[^>]*type\s*=\s*["']?password/i.test(html) || /login or verification required/i.test(html)) {
    return { status: "blocked", message: "This website requires verification or sign-in. Kinectem cannot read these results or bypass verification. Upload a results CSV or paste the results table instead.", groups: [], links: [] };
  }
  html = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  const groups: ResultGroup[] = [];
  let tableCount = 0, skipped = 0;
  for (const table of html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)) {
    if (++tableCount > 40) { skipped++; break; }
    const prefix = html.slice(Math.max(0, table.index! - 1500), table.index);
    const headings = [...prefix.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)];
    const label = htmlText(headings.at(-1)?.[1] ?? "");
    const rows = [...table[0].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(r =>
      [...r[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => htmlText(c[1])));
    const csv = rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    try {
      const result = parseResultsTable(csv, label);
      if (!result.groups.length) skipped++;
      groups.push(...result.groups);
    } catch { skipped++; }
  }
  // Consolidate score and standings tables from the same bracket/context.
  const merged = new Map<string, ResultGroup>();
  for (const g of groups) {
    const old = merged.get(g.key);
    if (old) { old.games.push(...g.games); old.standings.push(...g.standings); }
    else merged.set(g.key, g);
  }
  const links = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .filter(m => /bracket|results|scores|standings|flight/i.test(m[1] + htmlText(m[2])))
    .map(m => m[1].replace(/&amp;/g, "&")).slice(0, 40);
  const all = [...merged.values()].slice(0, 40);
  const partial = skipped > 0 || merged.size > 40 || links.length > 0 || all.some(g => g.games.some(x => x.homeScore == null || x.awayScore == null));
  return { groups: all, links, status: all.length ? (partial ? "partial" : "ready") : "unsupported",
    message: all.length ? "Detected HTML results tables. Review completeness and mappings; linked or unsupported tables may contain additional brackets." : "No supported scored-game or standings tables found. Dynamic/unsupported layouts need CSV or pasted results." };
}

export async function ingestResultsUrl(raw: string): Promise<ResultsIntake & { sourceUrl: string }> {
  const root = publicResultsUrl(raw);
  const budget = resultsFetchBudget();
  const visited = new Set<string>();
  const queue = [root.toString()];
  const groups = new Map<string, ResultGroup>();
  let partial = false;
  while (queue.length && budget.requests < 5 && Date.now() < budget.deadline) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);
    try {
      const page = await fetchPublicResultsHtml(url, budget);
      const extracted = extractResultsHtml(page.html, page.finalUrl);
      if (extracted.status === "blocked") {
        if (!groups.size) return { ...extracted, sourceUrl: root.toString() };
        partial = true; continue;
      }
      if (!extracted.groups.length || extracted.status === "partial") partial = true;
      for (const g of extracted.groups) {
        const old = groups.get(g.key);
        if (old) {
          old.games.push(...g.games);
          old.standings.push(...g.standings);
        } else groups.set(g.key, g);
      }
      for (const link of extracted.links) {
        try {
          const next = publicResultsUrl(new URL(link, page.finalUrl).toString());
          if (next.origin !== root.origin) { partial = true; continue; }
          if (!visited.has(next.toString()) && !queue.includes(next.toString())) queue.push(next.toString());
        } catch { partial = true; }
      }
    } catch (err) {
      if (!groups.size) return { status: "unsupported", groups: [], sourceUrl: root.toString(), message: `${err instanceof Error ? err.message : "Could not fetch results."} Use CSV or pasted results.` };
      partial = true;
    }
  }
  if (queue.length) partial = true;
  if (groups.size > 40 || [...groups.values()].some(g => g.games.length > 500 || g.standings.length > 500)) partial = true;
  const data = [...groups.values()].slice(0, 40).map(g => ({
    ...g,
    games: [...new Map(g.games.map(x => [JSON.stringify([x.home, x.away, x.date, x.group, x.homeScore, x.awayScore]), x])).values()].slice(0, 500).map((x, i) => ({ ...x, id: `game-${i + 1}` })),
    standings: [...new Map(g.standings.map(x => [JSON.stringify(x), x])).values()].slice(0, 500),
  }));
  return { sourceUrl: root.toString(), groups: data, status: data.length ? (partial ? "partial" : "ready") : "unsupported",
    message: data.length ? `${data.length} bracket(s) discovered.${partial ? " Discovery is partial: linked, blocked, or unsupported pages may contain more results." : ""} Review before drafting; tournament completion is not inferred.` : "No readable results tables found. Use CSV or pasted results; this may be a dynamic or unsupported website." };
}
